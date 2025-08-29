// lib/ai/providers/openai-assistant.ts
// Provider limpio SIN tools, maneja fallos con fallback bilingüe
// y devuelve siempre la última respuesta del Assistant.

import OpenAI from "openai";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_ASSISTANT_ID =
  process.env.OPENAI_ASSISTANT_ID || process.env.NEXT_PUBLIC_OPENAI_ASSISTANT_ID || "";

if (!OPENAI_API_KEY) console.warn("⚠️ OPENAI_API_KEY no está definido");
if (!OPENAI_ASSISTANT_ID) console.warn("⚠️ OPENAI_ASSISTANT_ID no está definido");

const client = new OpenAI({ apiKey: OPENAI_API_KEY });

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
  const payload = { assistant_id: assistantId };
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
  const startTs = Date.now();
  try {
    const threadId = opts.threadId || (await createThread(opts.metadata));
    console.log(JSON.stringify({ level: "info", tag: "[CV][ast]", traceId, msg: "thread.ready", meta: { threadId } }));

    await addUserMessage(threadId, opts.input);
    console.log(JSON.stringify({ level: "info", tag: "[CV][ast]", traceId, msg: "message.user.appended", meta: { preview: opts.input.slice(0, 120) } }));

    const run: any = await createRun(threadId, OPENAI_ASSISTANT_ID);
    console.log(JSON.stringify({ level: "info", tag: "[CV][ast]", traceId, msg: "run.created", meta: { runId: run.id, status: run.status } }));

    const terminal = new Set(["completed", "failed", "cancelled", "expired"]);
    let status: string = run.status;
    let guard = 0;

    while (!terminal.has(status)) {
      await new Promise((r) => setTimeout(r, 800));
      const last = await retrieveRun(threadId, run.id) as any;
      status = last.status;
      console.log(JSON.stringify({ level: "info", tag: "[CV][ast]", traceId, msg: "run.poll", meta: { status, last_error: last?.last_error } }));
      guard++;
      if (guard > 120) { console.warn("[CV][ast] run timeout"); break; }
    }

    const msgs: any = await listMessages(threadId, 50);
    const data: any[] = Array.isArray(msgs?.data) ? msgs.data : Array.isArray(msgs?.body?.data) ? msgs.body.data : [];
    const assistants = data.filter((m: any) => m.role === "assistant");

    const fresh = assistants.filter((m: any) => (m.created_at ? m.created_at * 1000 >= startTs : true))
                            .sort((a: any, b: any) => (a.created_at || 0) - (b.created_at || 0));

    const chosen = fresh.length ? fresh[fresh.length - 1] : assistants[assistants.length - 1];
    let reply = "";

    if (chosen?.content?.length) {
      for (const c of chosen.content) {
        if (c.type === "text") reply += c.text?.value ?? "";
      }
    }

    if (!reply) {
      reply = opts.input.match(/[a-zA-Z]/)
        ? "An error occurred, we apologize for the inconvenience."
        : "Ocurrió un error, lamentamos los inconvenientes.";
    }

    console.log(JSON.stringify({
      level: "info",
      tag: "[CV][ast]",
      traceId,
      msg: "reply.ready",
      meta: { status, replyPreview: reply.slice(0, 140), totalMsgs: data?.length ?? 0 }
    }));

    return { reply, threadId };
  } catch (e: any) {
    console.error(JSON.stringify({ level: "error", tag: "[CV][ast]", traceId, msg: "exception", meta: { error: String(e?.message || e) } }));
    const reply = opts.input.match(/[a-zA-Z]/)
      ? "An error occurred, we apologize for the inconvenience."
      : "Ocurrió un error, lamentamos los inconvenientes.";
    return { reply, threadId: opts.threadId || "" };
  }
}
