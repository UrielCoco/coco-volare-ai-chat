// Fuerza runtime Node y evita caché/edge para SSE
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

import { NextRequest } from "next/server";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
const ASSISTANT_ID = process.env.CV_ASSISTANT_ID!;

/* =========================
   Utilidades SSE / parsing
   ========================= */
function sse(event: string, data: any) {
  return `event: ${event}\n` + `data: ${JSON.stringify(data)}\n\n`;
}

function splitForDelta(s: string, size = 120) {
  const out: string[] = [];
  let i = 0;
  while (i < s.length) {
    out.push(s.slice(i, i + size));
    i += size;
  }
  return out.length ? out : [s];
}

function hasVisibleBlock(text: string): boolean {
  return /```cv:(itinerary|quote)\b/.test(text || "");
}

// Señales “dame un momento / estoy preparándolo” (multi-idioma)
const WAIT_PATTERNS = [
  // ES
  /dame un momento/i, /un momento/i, /perm[ií]teme/i, /en breve/i,
  /lo preparo/i, /te preparo/i, /voy a preparar/i, /estoy preparando/i,
  // EN
  /give me a moment/i, /one moment/i, /hold on/i, /let me/i,
  /i('|’)ll prepare/i, /i will prepare/i, /i('|’)m preparing/i, /working on it/i,
  // IT
  /un attimo/i, /lascia(mi)? che/i, /preparo/i, /sto preparando/i,
  // PT
  /um momento/i, /deixa eu/i, /vou preparar/i, /estou preparando/i,
  // FR
  /un instant/i, /laisse(-|\s)?moi/i, /je vais pr[eé]parer/i, /je pr[eé]pare/i,
  // DE
  /einen moment/i, /lass mich/i, /ich werde vorbereiten/i, /ich bereite vor/i,
];
function hasWaitPhrase(text: string) {
  const t = text || "";
  return WAIT_PATTERNS.some((rx) => rx.test(t));
}

function extractBalancedJson(src: string, startIdx: number): string | null {
  let inString = false, esc = false, depth = 0, first = -1;
  for (let i = startIdx; i < src.length; i++) {
    const ch = src[i];
    if (inString) {
      if (esc) { esc = false; continue; }
      if (ch === "\\") { esc = true; continue; }
      if (ch === '"') { inString = false; continue; }
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === "{") { if (depth === 0) first = i; depth++; continue; }
    if (ch === "}") { depth--; if (depth === 0 && first >= 0) return src.slice(first, i + 1); }
  }
  return null;
}

function extractKommoBlocksFromText(text: string): Array<{ raw: string; json: any }> {
  const blocks: Array<{ raw: string; json: any }> = [];
  if (!text) return blocks;

  // fence preferido
  const rxFence = /```\s*cv:kommo\s*([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  while ((m = rxFence.exec(text))) {
    const candidate = (m[1] || "").trim();
    try {
      const json = JSON.parse(candidate);
      if (json && Array.isArray(json.ops)) blocks.push({ raw: candidate, json });
    } catch {}
  }
  if (blocks.length) return blocks;

  // rescate sin fence
  const at = text.toLowerCase().indexOf("```cv:kommo");
  if (at >= 0) {
    const o = text.indexOf("{", at);
    if (o >= 0) {
      const js = extractBalancedJson(text, o);
      if (js) {
        try {
          const json = JSON.parse(js);
          if (json && Array.isArray(json.ops)) blocks.push({ raw: js, json });
        } catch {}
      }
    }
  }
  return blocks;
}

/* =========================
   Helpers OpenAI (compat)
   ========================= */
async function appendUserMessage(threadId: string, text: string) {
  await openai.beta.threads.messages.create(threadId, { role: "user", content: text });
}

// Compat para distintas versiones del SDK en runs.retrieve
async function retrieveRunCompat(threadId: string, runId: string) {
  const runs: any = (openai as any).beta.threads.runs;
  try {
    if (typeof runs.retrieve === "function" && runs.retrieve.length === 2) {
      return await runs.retrieve(threadId, runId);
    }
  } catch {}
  return await runs.retrieve(threadId, { run_id: runId });
}

/* =========================
   Ejecución sin stream real
   (SSE propio + poll corto)
   ========================= */
async function executeOneRunSSE(args: {
  threadId: string;
  emit: (event: string, data: any) => void;
  keepAlive?: () => void;
}) {
  const { threadId, emit, keepAlive } = args;

  // Arranca run
  const run = await openai.beta.threads.runs.create(threadId, { assistant_id: ASSISTANT_ID });
  emit("run.created", { runId: run.id });

  // Poll: máx ~20s (25 * 800ms)
  for (let i = 0; i < 25; i++) {
    const r = await retrieveRunCompat(threadId, run.id);
    const st = String(r.status);
    if (["completed", "failed", "cancelled", "expired", "incomplete"].includes(st)) break;
    if (keepAlive) keepAlive();
    await new Promise((res) => setTimeout(res, 800));
  }

  // Toma el último mensaje del assistant
  const msgs = await openai.beta.threads.messages.list(threadId, { limit: 10 } as any);
  const arr = (msgs?.data || []) as any[];
  const lastAssistant = arr
    .filter((m) => m.role === "assistant")
    .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))[0];

  let text = "";
  const content = (lastAssistant?.content || []) as any[];
  if (content.length) {
    text = content
      .filter((p) => p.type === "output_text" || p.type === "text")
      .map((p: any) => p.text?.value || p.text || "")
      .join("");
  }

  // Emitir en “deltas” simuladas para no romper UI
  if (text) {
    emit("textCreated", { text: "" });
    for (const chunk of splitForDelta(text)) emit("textDelta", { value: chunk });

    // Emitir cv:kommo si viene embebido
    const kommoBlocks = extractKommoBlocksFromText(text);
    for (const b of kommoBlocks) emit("kommo", { ops: b.json.ops });

    emit("messageCompleted", { text });
  } else {
    emit("messageCompleted", { text: "" });
  }

  return text;
}

/* =========================
   Reprompt mínimo “?”
   ========================= */
function needsRepromptWaitNoBlock(text: string) {
  return !!text && !hasVisibleBlock(text) && hasWaitPhrase(text);
}

export async function POST(req: NextRequest) {
  const TAG = "[CV][server]";
  try {
    const body = (await req.json()) as {
      message: { role: "user"; parts: Array<{ type: "text"; text: string }> };
      threadId?: string | null;
    };

    const userText: string = body?.message?.parts?.[0]?.text ?? "";
    console.log(JSON.stringify({ tag: TAG, event: "request.in", hasThreadId: !!body?.threadId, userTextLen: userText.length }));

    // thread
    let threadId: string;
    if (body?.threadId && body.threadId.length > 0) {
      threadId = body.threadId;
      console.log(JSON.stringify({ tag: TAG, event: "thread.reuse", threadId }));
    } else {
      const t = await openai.beta.threads.create();
      threadId = t.id;
      console.log(JSON.stringify({ tag: TAG, event: "thread.created", threadId }));
    }

    // SSE stream
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let closed = false;
        const safeEnqueue = (s: string) => {
          if (closed) return;
          try { controller.enqueue(encoder.encode(s)); } catch {}
        };
        const emit = (event: string, data: any) => safeEnqueue(sse(event, data));
        const keepAlive = () => safeEnqueue(sse("ping", { t: Date.now() }));
        const close = () => { if (!closed) { closed = true; try { controller.close(); } catch {} } };

        // meta para UI
        emit("meta", { threadId });

        // guardar mensaje del usuario
        await appendUserMessage(threadId, userText);
        console.log(JSON.stringify({ tag: TAG, event: "message.append.ok", threadId }));

        // Run 1
        const text1 = await executeOneRunSSE({ threadId, emit, keepAlive });
        const reprompt = needsRepromptWaitNoBlock(text1);

        if (!reprompt) {
          emit("done", { reason: "ended-first-run" });
          close();
          return;
        }

        // Reprompt “?”
        await appendUserMessage(threadId, "?");
        console.log(JSON.stringify({ tag: TAG, event: "message.append.ok", info: "auto-reprompt-?", threadId }));

        const text2 = await executeOneRunSSE({ threadId, emit, keepAlive });

        emit("done", { reason: "after-reprompt-?", len: (text1.length + text2.length) });
        close();
      },
      cancel() { /* noop */ },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err: any) {
    console.error(TAG, "route.error", err?.message || err);
    return new Response(JSON.stringify({ error: err?.message || "unknown" }), { status: 500 });
  }
}
