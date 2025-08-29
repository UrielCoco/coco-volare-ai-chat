// lib/ai/providers/openai-assistant.ts
// Provider robusto y compatible con múltiples versiones del SDK de OpenAI.
// Evita el error "No se puede asignar un argumento de tipo 'string' al parámetro de tipo 'RunRetrieveParams'"
// usando llamadas duales (objeto o posicional) con 'as any'.

import OpenAI from "openai";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_ASSISTANT_ID =
  process.env.OPENAI_ASSISTANT_ID || process.env.NEXT_PUBLIC_OPENAI_ASSISTANT_ID || "";

if (!OPENAI_API_KEY) {
  console.warn("⚠️ OPENAI_API_KEY no está definido");
}
if (!OPENAI_ASSISTANT_ID) {
  console.warn("⚠️ OPENAI_ASSISTANT_ID no está definido");
}

const client = new OpenAI({ apiKey: OPENAI_API_KEY });

// ---- Helpers para compatibilidad de firmas ----
async function createThread(meta?: Record<string, any>): Promise<string> {
  const traceId = `thr_${Math.random().toString(36).slice(2)}`;
  // Firma estable (body-only)
  const created = await client.beta.threads.create({
    metadata: { source: "webchat", ...(meta || {}) },
  } as any);
  const threadId = (created as any).id as string;
  console.log(JSON.stringify({ level: "info", traceId, msg: "assistant.thread.create", meta: { threadId } }));
  return threadId;
}

async function addUserMessage(threadId: string, content: string) {
  // v4 admite: messages.create(threadId, { role, content })
  // En algunas builds: messages.create({ thread_id, role, content })
  const api: any = (client as any).beta.threads.messages;
  try {
    return await api.create(threadId, { role: "user", content });
  } catch {
    return await api.create({ thread_id: threadId, role: "user", content });
  }
}

async function createRun(threadId: string, assistantId: string) {
  const api: any = (client as any).beta.threads.runs;
  try {
    // firma posicional
    return await api.create(threadId, { assistant_id: assistantId });
  } catch {
    // firma por objeto
    return await api.create({ thread_id: threadId, assistant_id: assistantId });
  }
}

async function retrieveRun(threadId: string, runId: string) {
  const api: any = (client as any).beta.threads.runs;
  try {
    // firma por objeto (tu caso actual)
    return await api.retrieve({ thread_id: threadId, run_id: runId });
  } catch {
    // firma posicional (otras versiones)
    return await api.retrieve(threadId, runId);
  }
}

async function listMessages(threadId: string, limit = 10) {
  const api: any = (client as any).beta.threads.messages;
  try {
    // firma por objeto
    return await api.list({ thread_id: threadId, limit });
  } catch {
    // firma posicional
    return await api.list(threadId, { limit });
  }
}

// ---- API pública ----
export async function runAssistantOnce(opts: {
  input: string;
  threadId?: string;
  metadata?: Record<string, any>;
}): Promise<{ reply: string; threadId: string }> {
  const traceId = `ast_${Math.random().toString(36).slice(2)}`;
  try {
    // 1) Asegurar thread
    const threadId = opts.threadId || (await createThread(opts.metadata));

    // 2) Añadir mensaje de usuario
    await addUserMessage(threadId, opts.input);

    // 3) Correr el assistant
    const run: any = await createRun(threadId, OPENAI_ASSISTANT_ID);
    console.log(
      JSON.stringify({
        level: "info",
        traceId,
        msg: "assistant.run.created",
        meta: { runId: run.id, threadId },
      })
    );

    // 4) Polling hasta completar
    let status: string = run.status;
    let guard = 0;
    while (status === "queued" || status === "in_progress" || status === "requires_action") {
      await new Promise((r) => setTimeout(r, 800));
      const r = (await retrieveRun(threadId, run.id)) as any;
      status = r.status;
      guard++;
      if (guard > 120) {
        console.warn("⚠️ assistant.run timeout");
        break; // ~96s
      }
    }

    // 5) Leer el último mensaje del asistente
    const msgs: any = await listMessages(threadId, 10);
    // En algunas versiones, msgs.data ya viene listo; en otras, es msgs.body.data
    const data: any[] = Array.isArray(msgs?.data) ? msgs.data : Array.isArray(msgs?.body?.data) ? msgs.body.data : [];
    const firstAssistant = data.find((m) => m.role === "assistant");
    let reply = "";
    if (firstAssistant?.content?.length) {
      for (const c of firstAssistant.content) {
        if (c.type === "text") reply += c.text?.value ?? "";
      }
    }
    reply = reply || "(sin respuesta)";

    console.log(
      JSON.stringify({
        level: "info",
        traceId,
        msg: "assistant.reply",
        meta: { replyPreview: reply.slice(0, 140) },
      })
    );

    return { reply, threadId };
  } catch (e: any) {
    console.error(
      JSON.stringify({
        level: "error",
        msg: "assistant.error",
        meta: { traceId, error: String(e?.message || e) },
      })
    );
    throw e;
  }
}
