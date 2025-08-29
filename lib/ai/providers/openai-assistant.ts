// lib/ai/providers/openai-assistant.ts
// Provider robusto que:
// - Fuerza tool_choice: "none" para evitar requires_action si el Assistant tiene tools activas.
// - Loguea estado del run, last_error y required_action.
// - Siempre devuelve el ÚLTIMO mensaje del asistente creado después de lanzar el run;
//   si no hay "fresh", cae al ÚLTIMO mensaje de asistente del thread (no al primero/saludo).

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
  const payload = { assistant_id: assistantId, tool_choice: "none" as const };
  try {
    return await api.create(threadId, payload);
  } catch {
    return await api.create({ thread_id: threadId, ...payload });
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
  const startTs = Date.now(); // para filtrar mensajes nuevos
  try {
    // 1) thread
    const threadId = opts.threadId || (await createThread(opts.metadata));
    console.log(JSON.stringify({ level: "info", tag: "[CV][ast]", traceId, msg: "thread.ready", meta: { threadId } }));

    // 2) user msg
    await addUserMessage(threadId, opts.input);
    console.log(JSON.stringify({ level: "info", tag: "[CV][ast]", traceId, msg: "message.user.appended", meta: { preview: opts.input.slice(0, 120) } }));

    // 3) run
    const run: any = await createRun(threadId, OPENAI_ASSISTANT_ID);
    console.log(JSON.stringify({ level: "info", tag: "[CV][ast]", traceId, msg: "run.created", meta: { runId: run.id, status: run.status } }));

    // 4) poll hasta estado terminal o requires_action; loguear last_error/required_action
    const terminal = new Set(["completed", "failed", "cancelled", "expired"]);
    let status: string = run.status;
    let guard = 0;
    let last: any = run;

    while (!terminal.has(status) && status !== "requires_action") {
      await new Promise((r) => setTimeout(r, 800));
      last = await retrieveRun(threadId, run.id) as any;
      status = last.status;
      const ra = last?.required_action?.submit_tool_outputs?.tool_calls?.map((t: any) => t?.function?.name);
      console.log(JSON.stringify({ level: "info", tag: "[CV][ast]", traceId, msg: "run.poll", meta: { status, ra, last_error: last?.last_error } }));
      guard++;
      if (guard > 120) { console.warn("[CV][ast] run timeout"); break; }
    }

    // 5) listar mensajes y elegir el NUEVO o el ÚLTIMO
    const msgs: any = await listMessages(threadId, 50);
    const data: any[] = Array.isArray(msgs?.data) ? msgs.data : Array.isArray(msgs?.body?.data) ? msgs.body.data : [];
    const assistants = data.filter((m: any) => m.role === "assistant");
    const fresh = assistants.filter((m: any) => (m.created_at ? m.created_at * 1000 >= startTs : true))
                            .sort((a: any, b: any) => (a.created_at || 0) - (b.created_at || 0));

    const chosen = fresh.length ? fresh[fresh.length - 1]
                                : assistants.sort((a: any, b: any) => (a.created_at || 0) - (b.created_at || 0))[assistants.length - 1];

    let reply = "";
    if (chosen?.content?.length) {
      for (const c of chosen.content) {
        if (c.type === "text") reply += c.text?.value ?? "";
      }
    }

    // Fallback ultra-defensivo si de plano no vino nada
    if (!reply) {
      const lastError = last?.last_error?.message || last?.last_error || null;
      reply = lastError
        ? `Perdón, tuve un problema técnico: ${String(lastError).slice(0, 300)}`
        : "Gracias, sigo aquí. ¿Podrías repetir lo último para continuar?";
    }

    console.log(JSON.stringify({
      level: "info",
      tag: "[CV][ast]",
      traceId,
      msg: "reply.ready",
      meta: { status, replyPreview: reply.slice(0, 140), totalMsgs: data?.length ?? 0, assistants: assistants.length }
    }));

    return { reply, threadId };
  } catch (e: any) {
    console.error(JSON.stringify({ level: "error", tag: "[CV][ast]", traceId, msg: "exception", meta: { error: String(e?.message || e) } }));
    return { reply: "Se me cruzó un problema técnico. Dime de nuevo y lo retomamos al vuelo.", threadId: opts.threadId || "" };
  }
}
