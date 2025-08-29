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

/* ------------ helpers compatibles (SDK nuevo/antiguo) ------------- */
async function createThread(metadata?: Record<string, any>) {
  try { return await (client.beta.threads as any).create({ metadata }); }
  catch { return await (client.beta.threads as any).create(); }
}
async function messagesCreate(threadId: string, body: any) {
  try { return await (client.beta.threads.messages as any).create({ thread_id: threadId, ...body }); }
  catch { return await (client.beta.threads.messages as any).create(threadId, body); }
}
async function runsCreate(threadId: string, body: any) {
  try { return await (client.beta.threads.runs as any).create({ thread_id: threadId, ...body }); }
  catch { return await (client.beta.threads.runs as any).create(threadId, body); }
}
async function runsRetrieve(threadId: string, runId: string) {
  try { return await (client.beta.threads.runs as any).retrieve(runId, { thread_id: threadId }); }
  catch { return await (client.beta.threads.runs as any).retrieve(threadId, runId); }
}
async function runsSubmitToolOutputs(threadId: string, runId: string, tool_outputs: any[]) {
  // nuevo
  try { return await (client.beta.threads.runs as any).submitToolOutputs(runId, { thread_id: threadId, tool_outputs }); }
  // viejo
  catch { return await (client.beta.threads.runs as any).submitToolOutputs(threadId, runId, { tool_outputs }); }
}
async function messagesList(threadId: string, params: any) {
  try { return await (client.beta.threads.messages as any).list({ thread_id: threadId, ...params }); }
  catch { return await (client.beta.threads.messages as any).list(threadId, params); }
}
/* ------------------------------------------------------------------ */

export async function runAssistantOnce({
  input,
  threadId,
  metadata = {},
}: RunOnceParams): Promise<{ reply: string; threadId: string }> {
  if (!ASSISTANT_ID) throw new Error("OPENAI_ASSISTANT_ID is not set");

  // Garantiza threadId
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

  // Run
  let run = await runsCreate(ensuredThreadId, { assistant_id: ASSISTANT_ID });
  log("info", "run.created", { runId: run.id, status: run.status });

  const start = Date.now();
  const DEADLINE = 90_000;

  while (true) {
    if (Date.now() - start > DEADLINE) {
      log("error", "run.timeout", { runId: run.id });
      throw new Error("Run timeout");
    }

    const cur = await runsRetrieve(ensuredThreadId, run.id);

    // 🔧 Si el Assistant aún trae herramientas → responder tool_calls con NO-OP
    if (cur.status === "requires_action" && (cur as any)?.required_action?.submit_tool_outputs?.tool_calls) {
      const calls: any[] = (cur as any).required_action.submit_tool_outputs.tool_calls;
      log("info", "run.requires_action", { runId: run.id, toolCalls: calls.map(c => c.function?.name) });

      const tool_outputs = calls.map((c: any) => ({
        tool_call_id: c.id,
        // devolvemos un output universal para “saltar” la herramienta
        output: JSON.stringify({
          ok: true,
          skipped: true,
          note: "Tool disabled in this deployment. Continue the conversation and render itinerary with cv:itinerary."
        }),
      }));

      await runsSubmitToolOutputs(ensuredThreadId, run.id, tool_outputs);
      // seguimos el loop hasta “completed”
      await new Promise(r => setTimeout(r, 600));
      continue;
    }

    if (cur.status === "completed") break;

    if (["failed","expired","cancelled","incomplete"].includes(cur.status as string)) {
      log("error", "run.failed", { status: cur.status, last_error: (cur as any)?.last_error });
      throw new Error(`Run status: ${cur.status}`);
    }

    log("info", "run.poll", { status: cur.status });
    await new Promise(r => setTimeout(r, 900));
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
    threadId: ensuredThreadId,
  });

  return { reply, threadId: ensuredThreadId };
}
