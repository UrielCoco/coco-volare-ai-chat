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

/** Helpers compatibles con SDK moderno/antiguo */
async function createThread(metadata?: Record<string, any>) {
  try { return await (client.beta.threads as any).create({ metadata }); }
  catch { return await (client.beta.threads as any).create(); }
}
async function appendUserMessage(threadId: string, content: string) {
  try {
    return await (client.beta.threads.messages as any).create({
      thread_id: threadId, role: "user", content
    });
  } catch {
    return await (client.beta.threads.messages as any).create(threadId, {
      role: "user", content
    });
  }
}
async function createRun(threadId: string, assistantId: string) {
  try {
    return await (client.beta.threads.runs as any).create({
      assistant_id: assistantId, thread_id: threadId
    });
  } catch {
    return await (client.beta.threads.runs as any).create(threadId, {
      assistant_id: assistantId
    });
  }
}
async function retrieveRun(threadId: string, runId: string) {
  try { return await (client.beta.threads.runs as any).retrieve(runId, { thread_id: threadId }); }
  catch { return await (client.beta.threads.runs as any).retrieve(threadId, runId); }
}
async function listMessages(threadId: string) {
  try { return await (client.beta.threads.messages as any).list({ thread_id: threadId, order: "desc", limit: 10 }); }
  catch { return await (client.beta.threads.messages as any).list(threadId, { order: "desc", limit: 10 }); }
}

export async function runAssistantOnce({
  input,
  threadId,
  metadata = {},
}: RunOnceParams): Promise<{ reply: string; threadId: string }> {
  if (!ASSISTANT_ID) throw new Error("OPENAI_ASSISTANT_ID is not set");

  // 1) Garantizar threadId como string SIEMPRE
  let ensuredThreadId: string;
  if (threadId && typeof threadId === "string" && threadId.trim().length > 0) {
    ensuredThreadId = threadId;
  } else {
    const t = await createThread(metadata);
    ensuredThreadId = String((t as any).id);
  }
  log("info", "thread.ready", { threadId: ensuredThreadId });

  // 2) Mensaje del usuario
  await appendUserMessage(ensuredThreadId, input);
  log("info", "message.user.appended", { preview: input.slice(0, 160) });

  // 3) Run
  const run = await createRun(ensuredThreadId, ASSISTANT_ID);
  log("info", "run.created", { runId: run.id, status: run.status });

  // 4) Poll
  const start = Date.now();
  const DEADLINE = 90_000;
  while (true) {
    if (Date.now() - start > DEADLINE) {
      log("error", "run.timeout", { runId: run.id });
      throw new Error("Run timeout");
    }
    const cur = await retrieveRun(ensuredThreadId, run.id);
    if (cur.status === "completed") break;
    if (["failed","expired","cancelled","incomplete","requires_action"].includes(cur.status as string)) {
      log("error", "run.failed", { status: cur.status, last_error: (cur as any)?.last_error });
      throw new Error(`Run status: ${cur.status}`);
    }
    await new Promise(r => setTimeout(r, 900));
  }

  // 5) Mensaje del asistente
  const msgs = await listMessages(ensuredThreadId);
  let reply = "";
  for (const m of msgs.data) {
    if (m.role !== "assistant") continue;
    for (const c of m.content) if (c.type === "text") reply += (c.text?.value || "") + "\n";
    if (reply.trim()) break;
  }
  reply = reply.trim() || "Ocurrió un error, lamentamos los inconvenientes. / An error occurred, we apologize for the inconvenience.";

  log("info", "reply.ready", {
    ms: Date.now() - start,
    replyPreview: reply.slice(0, 160),
    threadId: ensuredThreadId,
  });

  return { reply, threadId: ensuredThreadId };
}
