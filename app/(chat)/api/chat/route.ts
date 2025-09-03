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
    const content = e?.data?.delta?.content ?? e?.delta?.content;
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
  return WAIT_PATTERNS.some((rx) => rx.test(t));
}
function hasVisibleBlock(text: string) {
  return /```cv:(itinerary|quote)\b/.test(text || '');
}

// ---------- Extrae ops de bloques ```cv:kommo ...``` en texto ----------
function extractKommoOps(text: string): Array<any> {
  const ops: any[] = [];
  if (!text) return ops;
  const rxFence = /```\s*cv:kommo\s*([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  while ((m = rxFence.exec(text))) {
    try {
      const json = JSON.parse((m[1] || '').trim());
      if (json && Array.isArray(json.ops)) ops.push(...json.ops);
    } catch {
      // ignorar bloque malformado
    }
  }
  return ops;
}

/**
 * Ejecuta UN run y emite eventos SSE:
 *  - delta: trozos de texto
 *  - final: mensaje completo (puede haber varios finales si el asistente emite varios mensajes)
 *  - error: mensaje de error
 *
 * Implementación con `runs.stream` + snapshots locales (lazy-init) para evitar
 * "Received thread message event with no existing snapshot".
 * Mantiene tu instrumentación de fences/diag y tus logs.
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
    send('diag', { phase, threadId: tid, ...extra });
    slog(phase === 'delta' ? 'diag.fence.delta' : 'diag.fence.final', { threadId: tid, ...extra });
  }

  let fullText = '';
  let currentRunId: string | null = null;

  // Snapshots por mensaje dentro de ESTE stream
  const snapshots = new Map<string, { text: string }>();
  const keyFor = (ev: any) => {
    const runId = ev?.run_id || currentRunId || 'run';
    const messageId = ev?.data?.id || ev?.message?.id || ev?.id || 'msg';
    return `${runId}:${messageId}`;
  };

  // ⚠️ Sin tercer parámetro (onEvent) para evitar error de tipos
  const stream: any = await (client as any).beta.threads.runs.stream(
    tid,
    { assistant_id: ASSISTANT_ID },
  );

  // Suscripción genérica y específicas
  if (typeof stream?.on === 'function') {
    stream.on('event', (e: any) => handle(e));
    stream.on('thread.run.created', (e: any) => handle(e));
    stream.on('thread.message.created', (e: any) => handle(e));
    stream.on('thread.message.delta', (e: any) => handle(e));
    stream.on('thread.message.completed', (e: any) => handle(e));
    stream.on('thread.run.completed', (e: any) => handle(e));
    stream.on('thread.run.failed', (e: any) => handle(e));
    stream.on('error', (err: any) => {
      slog('stream.error', { runId: currentRunId, threadId: tid, error: String(err?.message || err) });
      send('error', { error: String(err?.message || err) });
    });
  }

  // Esperar a que concluya
  try {
    if (typeof stream?.final === 'function') {
      await stream.final();
    }
  } catch (err: any) {
    slog('exception.stream', { runId: currentRunId, threadId: tid, error: String(err?.message || err) });
    send('error', { error: String(err?.message || err) });
  } finally {
    slog('stream.end', { deltaChars: saw.deltaChars, sawText: saw.text, runId: currentRunId, threadId: tid });
  }

  return { fullText, sawText: saw.text };

  // ---------- handler de eventos ----------
  function handle(e: any) {
    const type = e?.event || e?.type || e?.name;

    if (type === 'thread.run.created') {
      currentRunId = e?.data?.id ?? currentRunId;
      slog('run.created', { runId: currentRunId, threadId: tid });
      return;
    }

    if (type === 'thread.message.created') {
      const key = keyFor(e);
      if (!snapshots.has(key)) snapshots.set(key, { text: '' });
      return;
    }

    if (type === 'thread.message.delta') {
      const key = keyFor(e);
      // ✅ Lazy-init: si llega delta antes del created, creamos snapshot
      if (!snapshots.has(key)) snapshots.set(key, { text: '' });

      const deltaText = extractDeltaTextFromEvent(e);
      if (deltaText) {
        saw.text = true;
        saw.deltaChars += deltaText.length;
        snapshots.get(key)!.text += deltaText;
        fullText += deltaText;

        send('delta', { value: deltaText });

        if (!saw.fenceSeenInDelta && fenceStartRx.test(deltaText)) {
          saw.fenceSeenInDelta = true;
          emitDiag('delta', {
            runId: currentRunId,
            fenceSeenInDelta: true,
            sample: deltaText.slice(0, 160),
          });
        }
        if (saw.deltaChars % 300 === 0) {
          slog('stream.delta.tick', { deltaChars: saw.deltaChars, runId: currentRunId, threadId: tid });
        }
      }
      return;
    }

    if (type === 'thread.message.completed') {
      const key = keyFor(e);
      // Preferimos lo acumulado; si no existe, aplanamos desde el evento (fallback)
      const msgText = snapshots.get(key)?.text ?? flattenAssistantTextFromMessage(e?.data) ?? '';
      if (msgText) {
        saw.text = true;
        fullText += msgText;

        // DIAG final (conteo de fences y hashes)
        const fences = [...fullText.matchAll(allFencesRx)];
        const fenceCount = fences.length;
        const fenceTypes = fences.map((m) => m[1]);
        const hashes = fences.map((m) => {
          const raw = m[0];
          let h = 0;
          for (let i = 0; i < raw.length; i++) h = (h * 31 + raw.charCodeAt(i)) >>> 0;
          return h.toString(16);
        });
        const unique = Array.from(new Set(hashes)).length;
        emitDiag('final', {
          runId: currentRunId,
          fenceCount,
          fenceTypes,
          hashes,
          unique,
          fenceSeenInDelta: saw.fenceSeenInDelta,
        });

        send('final', { text: msgText });

        const ops = extractKommoOps(msgText);
        slog('message.completed', {
          fullLen: msgText.length,
          kommoOps: ops.length,
          runId: currentRunId,
          threadId: tid,
        });
        if (ops.length) send('kommo', { ops });
      }
      return;
    }

    if (type === 'thread.run.failed') {
      const err = e?.data?.last_error?.message || 'run_failed';
      slog('stream.error', { runId: currentRunId, threadId: tid, error: err });
      send('error', { error: err });
      return;
    }

    // thread.run.completed → no-op (el caller manda 'done' al final)
  }
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

  // 3) Abrir SSE
  const encoder = new TextEncoder();
  const rs = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: any) =>
        controller.enqueue(encoder.encode(sse(event, data)));

      // meta con threadId (cliente lo guarda)
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
