// lib/ai/providers/openai-assistant.ts
import OpenAI from "openai";

type RunOnceParams = {
  input: string;
  threadId?: string | null;
  metadata?: Record<string, string>;
};

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
const ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID!;

function log(level: "info" | "error", msg: string, meta: any = {}) {
  try { console.log(JSON.stringify({ level, tag: "[CV][ast]", msg, meta })); } catch {}
}

/** --------- Helpers tolerantes a cambios menores del SDK ---------- */
async function createThread(metadata: any) {
  try { return await (client.beta.threads as any).create({ metadata }); }
  catch { return await (client.beta.threads as any).create({ metadata }); }
}
async function messagesCreate(threadId: string, body: any) {
  try { return await (client.beta.threads.messages as any).create(threadId, body); }
  catch { return await (client.beta.threads.messages as any).create({ thread_id: threadId, ...body }); }
}
async function runsCreate(threadId: string, body: any) {
  try { return await (client.beta.threads.runs as any).create(threadId, body); }
  catch { return await (client.beta.threads.runs as any).create({ thread_id: threadId, ...body }); }
}
async function runsRetrieve(runId: string, params: any) {
  try { return await (client.beta.threads.runs as any).retrieve(runId, params); }
  catch { return await (client.beta.threads.runs as any).retrieve({ run_id: runId, ...params }); }
}
async function runsCancel(runId: string, params: any) {
  try { return await (client.beta.threads.runs as any).cancel(runId, params); }
  catch { return await (client.beta.threads.runs as any).cancel({ run_id: runId, ...params }); }
}
async function messagesList(threadId: string, params: any) {
  try { return await (client.beta.threads.messages as any).list(threadId, params); }
  catch { return await (client.beta.threads.messages as any).list({ thread_id: threadId, ...params }); }
}
/* ------------------------------------------------------------------ */

export async function runAssistantOnce({
  input,
  threadId,
  metadata = {},
}: RunOnceParams): Promise<{ reply: string; threadId: string }> {
  if (!ASSISTANT_ID) throw new Error("OPENAI_ASSISTANT_ID is not set");

  const start = Date.now();

  // Garantiza thread
  let ensuredThreadId: string;
  if (threadId && typeof threadId === "string" && threadId.trim()) {
    ensuredThreadId = threadId;
  } else {
    const t = await createThread(metadata);
    ensuredThreadId = String(t.id);
  }
  log("info", "thread.ready", { threadId: ensuredThreadId });

  // Mensaje de usuario
  await messagesCreate(ensuredThreadId, { role: "user", content: input });
  log("info", "message.user.appended", { preview: input.slice(0, 140) });

  // Run (sin instrucciones: no forzamos itinerario)
  let run = await runsCreate(ensuredThreadId, { assistant_id: ASSISTANT_ID, metadata });
  let status = run.status;

  const POLL_MS = 300;
  const MAX_WAIT_MS = 120_000;
  const ACTIVE = new Set(["queued","in_progress","requires_action","cancelling"]);

  // Poll simple
  const t0 = Date.now();
  while (ACTIVE.has(status as any)) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    run = await runsRetrieve(String(run.id), { thread_id: ensuredThreadId });
    status = run.status;
    if (Date.now() - t0 > MAX_WAIT_MS) {
      try { await runsCancel(String(run.id), { thread_id: ensuredThreadId }); } catch {}
      log("error", "run.timeout.cancelled", { threadId: ensuredThreadId });
      break;
    }
  }

  // Mensaje del assistant
  const msgs = await messagesList(ensuredThreadId, { order: "desc", limit: 10 });
  let reply = "";
  for (const m of msgs.data) {
    if (m.role !== "assistant") continue;
    for (const c of m.content) if (c.type === "text") reply += (c.text?.value || "") + "\n";
    if (reply.trim()) break;
  }
  reply = reply.trim() ||
    "Ocurrió un error, lamentamos los inconvenientes. / An error occurred, we apologize for the inconvenience.";

  log("info", "reply.ready", {
    ms: Date.now() - start,
    replyPreview: reply.slice(0, 160),
    status,
  });

  return { reply, threadId: ensuredThreadId };
}
