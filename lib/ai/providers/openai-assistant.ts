// lib/ai/providers/openai-assistant.ts
// Provider robusto, compatible con múltiples versiones del SDK, y que
// siempre devuelve el ÚLTIMO mensaje del asistente generado DESPUÉS de iniciar el run.

import OpenAI from "openai";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_ASSISTANT_ID =
  process.env.OPENAI_ASSISTANT_ID || process.env.NEXT_PUBLIC_OPENAI_ASSISTANT_ID || "";

if (!OPENAI_API_KEY) console.warn("⚠️ OPENAI_API_KEY no está definido");
if (!OPENAI_ASSISTANT_ID) console.warn("⚠️ OPENAI_ASSISTANT_ID no está definido");

const client = new OpenAI({ apiKey: OPENAI_API_KEY });

// ---------- helpers (firmas duales) ----------
async function createThread(meta?: Record<string, any>): Promise<string> {
  const created = await (client as any).beta.threads.create({
    metadata: { source: "webchat", ...(meta || {}) },
  } as any);
  return (created as any).id as string;
}
async function addUserMessage(threadId: string, content: string) {
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
    return await api.create(threadId, { assistant_id: assistantId });
  } catch {
    return await api.create({ thread_id: threadId, assistant_id: assistantId });
  }
}
async function retrieveRun(threadId: string, runId: string) {
  const api: any = (client as any).beta.threads.runs;
  try {
    return await api.retrieve({ thread_id: threadId, run_id: runId });
  } catch {
    return await api.retrieve(threadId, runId);
  }
}
async function listMessages(threadId: string, limit = 50) {
  const api: any = (client as any).beta.threads.messages;
  try { return await api.list({ thread_id: threadId, limit }); }
  catch { return await api.list(threadId, { limit }); }
}

export async function runAssistantOnce(opts: {
  input: string;
  threadId?: string;
  metadata?: Record<string, any>;
}): Promise<{ reply: string; threadId: string }> {
  const traceId = `ast_${Math.random().toString(36).slice(2)}`;
  // marca temporal en ms para filtrar mensajes nuevos
  const startTs = Date.now();
  try {
    // 1) thread
    const threadId = opts.threadId || (await createThread(opts.metadata));
    // 2) user msg
    await addUserMessage(threadId, opts.input);
    // 3) run
    const run: any = await createRun(threadId, OPENAI_ASSISTANT_ID);
    console.log(JSON.stringify({ level: "info", traceId, msg: "assistant.run.created", meta: { runId: run.id, threadId } }));

    // 4) poll (aceptamos completed o failed/requires_action; en todos los casos leeremos los mensajes nuevos)
    const terminal = new Set(["completed", "failed", "cancelled", "expired"]);
    let status: string = run.status;
    let guard = 0;
    while (!terminal.has(status) && status !== "requires_action") {
      await new Promise((r) => setTimeout(r, 800));
      const r = (await retrieveRun(threadId, run.id)) as any;
      status = r.status;
      console.log(JSON.stringify({ level: "info", traceId, msg: "assistant.poll", meta: { status } }));
      guard++;
      if (guard > 120) { console.warn("⚠️ assistant.run timeout"); break; }
    }

    // 5) leer SOLO los mensajes de asistente NUEVOS
    const msgs: any = await listMessages(threadId, 50);
    const data: any[] = Array.isArray(msgs?.data) ? msgs.data : Array.isArray(msgs?.body?.data) ? msgs.body.data : [];

    // filtra mensajes de asistente cuyo created_at >= startTs (SDK da seconds)
    const fresh = data
      .filter((m: any) => m.role === "assistant" && (m.created_at ? m.created_at * 1000 >= startTs : true))
      .sort((a: any, b: any) => (a.created_at || 0) - (b.created_at || 0));

    const chosen = fresh.length ? fresh[fresh.length - 1] : data.find((m) => m.role === "assistant");
    let reply = "";
    if (chosen?.content?.length) {
      for (const c of chosen.content) {
        if (c.type === "text") reply += c.text?.value ?? "";
      }
    }
    reply = reply || "(sin respuesta)";

    console.log(JSON.stringify({ level: "info", traceId, msg: "assistant.reply", meta: { status, replyPreview: reply.slice(0, 140) } }));
    return { reply, threadId };
  } catch (e: any) {
    console.error(JSON.stringify({ level: "error", msg: "assistant.error", meta: { traceId, error: String(e?.message || e) } }));
    // último intento: no rompemos el chat
    return { reply: "Lo siento, tuve un problema técnico. ¿Me repites lo último para continuar?", threadId: opts.threadId || "" };
  }
}
