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
const __DIAG = process.env.CHAT_DIAGNOSTIC_MODE === 'true';
function slog(event: string, meta: Record<string, any> = {}) {
  if (!__DIAG) return;
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
    if (c.type === 'output_text' && c.text?.value) out.push(c.text.value);
  }
  return out.join('');
}

function findFirstAssistantText(messages?: any[]): string {
  if (!messages?.length) return '';
  for (const m of messages) {
    if (m?.role === 'assistant') {
      const flat = flattenAssistantTextFromMessage(m);
      if (flat) return flat;
    }
  }
  return '';
}

function pickLatestAssistantTextFull(list: any) {
  try {
    const m = list?.data?.find((d: any) => d?.role === 'assistant');
    if (!m) return '';
    return flattenAssistantTextFromMessage(m);
  } catch {}
  return '';
}

function pickLatestAssistantTextShort(list: any) {
  try {
    const m = list?.data?.find((d: any) => d?.role === 'assistant');
    if (!m) return '';
    const content = m?.content || [];
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

// ---------- Detección de disparador “te lo preparo / un momento” ----------
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
  const t = text || '';
  for (const rx of WAIT_PATTERNS) if (rx.test(t)) return true;
  return false;
}

/**
 * Ejecuta UN run con createAndStream y resuelve cuando termina.
 * Emite los mismos eventos que ya consume tu UI.
 * Devuelve el texto completo recibido en ese run.
 * (AHORA con logs de diagnóstico de fences).
 */
async function runOnceWithStream(
  tid: string,
  send: (event: string, data: any) => void,
): Promise<{ fullText: string; sawText: boolean }> {
  // --- helpers locales de diagnóstico ---
  const saw = { text: false, deltaChars: 0, fenceSeenInDelta: false };
  const fenceStartRx = /```cv:(itinerary|quote)\b/i;
  const allFencesRx = /```cv:(itinerary|quote)\s*([\s\S]*?)```/g;

  function emitDiag(phase: 'delta' | 'final', extra: Record<string, any> = {}) {
    // SSE opcional para inspección en cliente
    send('diag', { phase, threadId: tid, ...extra });
    // Log persistente en Vercel
    slog(
      phase === 'delta' ? 'diag.fence.delta' : 'diag.fence.final',
      { threadId: tid, ...extra },
    );
  }

  let fullText = '';
  let runId: string | null = null;

  const stream = await client.beta.threads.runs.createAndStream(tid, {
    assistant_id: ASSISTANT_ID,
  })
  .on('event', (e: any) => {
    const type = e?.event;

    if (type === 'thread.run.created') {
      runId = e?.data?.id || null;
      slog('run.created', { runId, threadId: tid });
      return;
    }

    if (type === 'thread.message.delta') {
      try {
        const delta = findFirstAssistantText(e?.data?.delta?.content || []);
        if (delta) {
          fullText += delta;
          saw.text = true;
          saw.deltaChars += delta.length;

          // En delta: detectar si inicia fence
          if (!saw.fenceSeenInDelta && fenceStartRx.test(delta)) {
            saw.fenceSeenInDelta = true;
            emitDiag('delta', { runId, hint: 'fence-start-detected' });
          }

          // Stream out hacia la UI (sin cambios)
          // (Tu UI ya escucha "delta")
        }
        if (saw.deltaChars % 300 === 0) {
          slog('stream.delta.tick', { deltaChars: saw.deltaChars, runId, threadId: tid });
        }
      } catch {}
      return;
    }

    if (type === 'thread.message.completed') {
      const complete = flattenAssistantTextFromMessage(e?.data);
      if (complete) {
        saw.text = true;
        fullText += complete;

        // DIAG final: contar fences y generar huellas
        const fences = [...fullText.matchAll(allFencesRx)];
        const fenceCount = fences.length;
        const fenceTypes = fences.map(m => m[1]);
        const hashes = fences.map(m => {
          const raw = m[0]; // fence completo
          let hash = 0;
          for (let i = 0; i < raw.length; i++) hash = (hash * 31 + raw.charCodeAt(i)) >>> 0;
          return hash.toString(16);
        });
        const unique = Array.from(new Set(hashes)).length;
        emitDiag('final', {
          runId,
          fenceCount,
          fenceTypes,
          hashes,
          unique,
          textLen: fullText.length,
          sawText: saw.text,
        });

        // Stream out final (sin cambios)
      }
      return;
    }

    if (type === 'thread.run.failed') {
      slog('run.failed', { runId, threadId: tid, last_error: String(e?.data?.last_error?.message || e?.data?.last_error || 'unknown') });
      return;
    }

    if (type === 'error') {
      slog('stream.error', { runId, threadId: tid, error: String(e?.data || 'unknown') });
      send('error', { error: String(e?.data || 'unknown') });
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
      send('error', { error: String(err?.message || err) });
      resolve();
    });
  });

  return { fullText, sawText: saw.text };
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
  }

  // 2) Adjuntar mensaje del usuario (en el MISMO hilo)
  await client.beta.threads.messages.create(tid, {
    role: 'user',
    content: userText,
  });
  slog('user.message.created', { threadId: tid, len: userText.length });

  // 3) Iniciar stream SSE hacia el cliente (sin tocar nombres de eventos)
  const encoder = new TextEncoder();
  const rs = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: any) => {
        controller.enqueue(encoder.encode(sse(event, data)));
      };

      try {
        // ---- Run 1
        const r1 = await runOnceWithStream(tid, send);

        // ¿El assistant prometió “te lo preparo” pero no devolvió bloque?
        const shouldReprompt =
          !r1.sawText ||
          (!/```cv:(itinerary|quote)\b/i.test(r1.fullText) && hasWaitPhrase(r1.fullText));

        if (shouldReprompt) {
          slog('auto.reprompt', { reason: 'wait-no-block', threadId: tid });
          // Enviar "?" oculto en el MISMO hilo
          await client.beta.threads.messages.create(tid, { role: 'user', content: '?' });
          slog('message.append.ok', { threadId: tid, info: 'auto-?' });

          // ---- Run 2
          await runOnceWithStream(tid, send);
        }

        send('done', {});
        controller.close();
      } catch (e: any) {
        slog('exception.createStream', { error: String(e?.message || e) });
        send('error', { error: String(e?.message || e) });
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
