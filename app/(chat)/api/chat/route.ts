// app/(chat)/api/chat/route.ts
import { NextRequest } from 'next/server';
import OpenAI from 'openai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
const ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID!;

type UiMessage = {
  role: 'user' | 'assistant';
  parts: Array<{ type: 'text'; text: string }>;
};

function asText(msg?: UiMessage) {
  if (!msg?.parts?.length) return '';
  return msg.parts.map((p) => (p.type === 'text' ? p.text : '')).join('');
}

function sse(event: string, data: any) {
  return `event: ${event}\n` + `data: ${JSON.stringify(data)}\n\n`;
}

// ---------- Logs server ----------
function slog(event: string, meta: Record<string, any> = {}) {
  try {
    console.info(JSON.stringify({ tag: '[CV][server]', event, ...meta }));
  } catch {}
}

// ---------- Helpers OpenAI ----------
function flattenAssistantTextFromMessage(message: any): string {
  const out: string[] = [];
  if (!message?.content) return '';
  for (const c of message.content) {
    if (c.type === 'text' && c.text?.value) out.push(c.text.value);
  }
  return out.join('\n');
}

function extractDeltaTextFromEvent(e: any): string {
  try {
    const content = e?.data?.delta?.content;
    if (Array.isArray(content)) {
      const parts: string[] = [];
      for (const item of content) {
        if (item?.type === 'text' && item?.text?.value) parts.push(item.text.value);
        if (item?.type === 'output_text' && item?.text?.value) parts.push(item.text.value);
      }
      return parts.join('');
    }
  } catch {}
  return '';
}

// ---------- Detección de “un momento / preparando…” ----------
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
const hasWaitPhrase = (t: string) => WAIT_PATTERNS.some((rx) => rx.test(t || ''));
const hasVisibleBlock = (t: string) => /```cv:(itinerary|quote)\b/.test(t || '');

// ---------- Extrae ops de bloques ```cv:kommo ...``` ----------
function extractKommoOps(text: string): Array<any> {
  const ops: any[] = [];
  if (!text) return ops;
  const rxFence = /```\s*cv:kommo\s*([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  while ((m = rxFence.exec(text))) {
    try {
      const json = JSON.parse((m[1] || '').trim());
      if (json && Array.isArray(json.ops)) ops.push(...json.ops);
    } catch {}
  }
  return ops;
}

/**
 * Ejecuta UN run con createAndStream y resuelve cuando termina.
 * Emite: meta/delta/final/kommo + diag.fence.final (para auditoría).
 */
async function runOnceWithStream(
  tid: string,
  send: (event: string, data: any) => void,
): Promise<{ fullText: string; sawText: boolean; runId: string | null }> {
  const saw = { text: false, deltaChars: 0, fenceSeenInDelta: false };
  const fenceStartRx = /```cv:(itinerary|quote)\b/i;
  const allFencesRx = /```cv:(itinerary|quote)\s*([\s\S]*?)```/g;

  let fullText = '';
  let runId: string | null = null;

  const stream: any = await client.beta.threads.runs.createAndStream(tid, {
    assistant_id: ASSISTANT_ID,
  });

  stream.on('event', (e: any) => {
    const type = e?.event as string;

    if (type === 'thread.run.created') {
      runId = e?.data?.id ?? null;
      slog('run.created', { runId, threadId: tid });
      return;
    }

    if (type === 'thread.message.delta') {
      const deltaText = extractDeltaTextFromEvent(e);
      if (deltaText) {
        saw.text = true;
        saw.deltaChars += deltaText.length;
        fullText += deltaText;
        send('delta', { value: deltaText });

        if (!saw.fenceSeenInDelta && fenceStartRx.test(deltaText)) {
          saw.fenceSeenInDelta = true;
        }

        if (saw.deltaChars % 300 === 0) {
          slog('stream.delta.tick', { deltaChars: saw.deltaChars, runId, threadId: tid });
        }
      }
      return;
    }

    if (type === 'thread.message.completed') {
      const complete = flattenAssistantTextFromMessage(e?.data);
      if (complete) {
        saw.text = true;
        fullText += complete;

        // DIAG final: contar fences visibles y fingerprint simples
        const fences = [...fullText.matchAll(allFencesRx)];
        const fenceCount = fences.length;
        const fenceTypes = fences.map((m) => m[1]);
        const hashes = fences.map((m) => {
          const raw = m[0]; let h = 0; for (let i = 0; i < raw.length; i++) h = (h * 31 + raw.charCodeAt(i)) >>> 0;
          return h.toString(16);
        });
        send('diag.fence.final', {
          runId, threadId: tid, fenceCount, fenceTypes, hashes, unique: new Set(hashes).size,
          fenceSeenInDelta: saw.fenceSeenInDelta,
        });

        send('final', { text: complete });

        const ops = extractKommoOps(complete);
        slog('message.completed', { fullLen: complete.length, kommoOps: ops.length, runId, threadId: tid });
        if (ops.length) send('kommo', { ops });
      }
      return;
    }

    // ⚠️ IMPORTANTE: no propagamos errores intermedios al cliente (para no borrar “pensando…”)
    if (type === 'thread.run.failed') {
      slog('diag.run.failed', { runId, threadId: tid });
      return;
    }
    if (type === 'error') {
      slog('diag.stream.error', { runId, threadId: tid, error: String(e?.data || 'unknown') });
      return;
    }
  });

  await new Promise<void>((resolve) => {
    stream.on('end', () => {
      slog('stream.end', { deltaChars: saw.deltaChars, sawText: saw.text, runId, threadId: tid });
      resolve();
    });
    stream.on('error', (err: any) => {
      slog('exception.stream', { runId, threadId: tid, error: String(err?.message || err) });
      // no enviamos 'error' al cliente aquí: cerramos y que el outer maneje
      resolve();
    });
  });

  return { fullText, sawText: saw.text, runId };
}

export async function POST(req: NextRequest) {
  const { message, threadId } = await req.json();
  const userText = asText(message);
  slog('request.in', { hasThreadId: !!threadId, userTextLen: userText.length });

  // 1) Asegurar thread
  let tid = String(threadId || '');
  if (!tid) {
    const t = await client.beta.threads.create();
    tid = t.id;
    slog('thread.created', { threadId: tid });
  } else {
    slog('thread.reuse', { threadId: tid });
  }

  // 2) Adjuntar mensaje del usuario
  await client.beta.threads.messages.create(tid, { role: 'user', content: userText });
  slog('message.append.ok', { threadId: tid });

  // 3) SSE
  const encoder = new TextEncoder();
  const rs = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: any) =>
        controller.enqueue(encoder.encode(sse(event, data)));

      send('meta', { threadId: tid });

      try {
        // ---- Run 1
        const r1 = await runOnceWithStream(tid, send);

        // ¿Dijo “un momento” y NO entregó bloque visible? → reprompt "?"
        const shouldReprompt =
          !!r1.fullText &&
          !hasVisibleBlock(r1.fullText) &&
          hasWaitPhrase(r1.fullText);

        if (shouldReprompt) {
          slog('auto.reprompt', { reason: 'wait-no-block', threadId: tid });

          await client.beta.threads.messages.create(tid, { role: 'user', content: '?' });
          slog('message.append.ok', { threadId: tid, info: 'auto-?' });

          // ---- Run 2
          await runOnceWithStream(tid, send);
        }

        send('done', {});
        controller.close();
      } catch (e: any) {
        slog('exception.createStream', { error: String(e?.message || e) });
        // Solo si es fatal (no pudimos ni crear stream) avisamos error al cliente.
        try { controller.enqueue(encoder.encode(sse('error', { error: String(e?.message || e) }))); } catch {}
        controller.close();
      }
    },
  });

  return new Response(rs, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
