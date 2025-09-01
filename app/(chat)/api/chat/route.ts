// app/(chat)/api/chat/route.ts
import { NextRequest } from 'next/server';
import OpenAI from 'openai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function log(event: string, data: Record<string, unknown> = {}) {
  try { console.log(JSON.stringify({ tag: "[CV][server]", event, ...data })); } catch {}
}

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
const ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID!;

type Fence = { type: string; raw: string; hash: string };
const fenceRegex = /```([a-zA-Z0-9_-]*)(?:\\s+[\\w-]+)?\\s*\\n([\\s\\S]*?)\\n```/g;
function extractFences(text: string): Fence[] {
  const out: Fence[] = [];
  let m: RegExpExecArray | null;
  while ((m = fenceRegex.exec(text)) !== null) {
    const lang = (m[1] || "").trim().toLowerCase();
    const body = (m[2] || "").trim();
    const hash = Array.from(new TextEncoder().encode(body))
      .reduce((a, b) => ((a << 5) - a + b) | 0, 0)
      .toString(16);
    out.push({ type: lang || "code", raw: body, hash });
  }
  return out;
}

function encodeSSE(line: string) { return new TextEncoder().encode(line); }
function sseJSON(event: string, payload: any) {
  return `event: ${event}\\n` + `data: ${JSON.stringify(payload)}\\n\\n`;
}

async function ensureThreadId(threadId?: string | null) {
  if (threadId) { log("thread.reuse", { threadId }); return threadId; }
  const t = await client.beta.threads.create();
  log("thread.created", { threadId: t.id });
  return t.id;
}

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch { return new Response("Bad JSON", { status: 400 }); }
  const userText: string = (body?.text ?? "").toString();
  const incomingThreadId: string | null = body?.threadId ?? null;

  log("request.in", { hasThreadId: !!incomingThreadId, userTextLen: userText.length });

  const threadId = await ensureThreadId(incomingThreadId);
  await client.beta.threads.messages.create(threadId, { role: "user", content: userText || "…" });
  log("message.append.ok", { threadId });

  const rs = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: any) => controller.enqueue(encodeSSE(sseJSON(event, data)));

      let full = "";
      let deltaChars = 0;
      let fenceSeenInDelta = false;
      const fenceHashes = new Set<string>();
      const fenceTypes = new Set<string>();
      let currentRunId: string | undefined;

      try {
        const stream = await client.beta.threads.runs.stream(threadId, { assistant_id: ASSISTANT_ID });

        for await (const ev of stream) {
          switch (ev.type) {
            case "run.created": {
              currentRunId = ev.data.id;
              log("run.created", { runId: currentRunId, threadId });
              break;
            }
            case "thread.message.delta": {
              const parts = ev.data.delta?.content ?? [];
              for (const p of parts) {
                if (p.type === "text_delta") {
                  const chunk = p.text?.value ?? "";
                  if (!chunk) continue;
                  full += chunk;
                  deltaChars += chunk.length;
                  if (deltaChars % 600 < chunk.length) {
                    log("stream.delta.tick", { deltaChars, runId: currentRunId, threadId });
                  }
                  const fences = extractFences(chunk);
                  if (fences.length) {
                    fenceSeenInDelta = true;
                    fences.forEach(f => { fenceHashes.add(f.hash); fenceTypes.add(f.type); });
                    log("diag.fence.delta", {
                      count: fences.length,
                      types: fences.map(f => f.type),
                      hashes: fences.map(f => f.hash),
                    });
                  }
                  send("delta", { value: chunk });
                }
              }
              break;
            }
            case "run.step.completed": {
              // Si el asistente llamó una función, aparecerá aquí
              const step = ev.data;
              const details: any = (step as any).step_details;
              if (details?.type === "tool_calls" && Array.isArray(details.tool_calls)) {
                for (const tc of details.tool_calls) {
                  if (tc?.type === "function" && tc.function?.name === "emit_itinerary") {
                    try {
                      const args = JSON.parse(tc.function.arguments ?? "{}");
                      if (args?.title && Array.isArray(args?.days)) {
                        send("itinerary", { payload: args });
                      }
                    } catch {}
                  }
                }
              }
              break;
            }
            case "run.failed": {
              log("stream.error", { runId: currentRunId, threadId, error: "run_failed" });
              send("error", { error: "run_failed" });
              break;
            }
            case "run.completed": {
              const finalFences = extractFences(full);
              finalFences.forEach(f => { fenceHashes.add(f.hash); fenceTypes.add(f.type); });
              log("diag.fence.final", {
                fenceCount: finalFences.length,
                fenceTypes: Array.from(fenceTypes),
                hashes: Array.from(fenceHashes),
                unique: Array.from(fenceHashes).length,
                fenceSeenInDelta,
              });
              log("message.completed", { fullLen: full.length, kommoOps: 0, runId: currentRunId, threadId });
              log("stream.end", { deltaChars, sawText: full.length > 0, runId: currentRunId, threadId });
              send("done", { ok: true });
              controller.close();
              break;
            }
            case "error": {
              log("stream.error", { runId: currentRunId, threadId, error: "stream_error" });
              send("error", { error: "stream_error" });
              controller.close();
              break;
            }
          }
        }
      } catch (e: any) {
        log("stream.error", { error: "exception", detail: String(e?.message || e) });
        send("error", { error: String(e?.message || e) });
        controller.close();
      }
    },
  });

  return new Response(rs, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
    },
  });
}
