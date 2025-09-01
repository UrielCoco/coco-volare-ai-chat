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
  try {
    return msg.parts.map((p) => p?.text || '').join('');
  } catch { return ''; }
}

function sse(event: string, data: any) {
  return `data:${JSON.stringify({ event, ...data })}\n\n`;
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

// ---------- Dedup de fences dentro del MISMO mensaje ----------
function dedupeVisibleFencesKeepLast(text: string) {
  const rx = /```cv:(itinerary|quote)\s*([\s\S]*?)```/g;
  const matches: { start: number; end: number; raw: string; key: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = rx.exec(text))) {
    const raw = m[0];
    const key = `${m[1]}|${m[2].trim()}`;
    matches.push({ start: m.index, end: m.index + raw.length, raw, key });
  }
  if (matches.length <= 1) return text;

  // Agrupa por llave y conserva SOLO el último de cada grupo
  const groups = new Map<string, number[]>();
  matches.forEach((mm, i) => {
    const arr = groups.get(mm.raw) || [];
    arr.push(i);
    groups.set(mm.raw, arr);
  });

  const toDrop = new Set<number>();
  for (const [, idxs] of groups) {
    if (idxs.length > 1) idxs.slice(0, -1).forEach((i) => toDrop.add(i));
  }
  if (!toDrop.size) return text;

  let out = '';
  let cursor = 0;
  matches.forEach((mm, i) => {
    if (toDrop.has(i)) {
      out += text.slice(cursor, mm.start);
      cursor = mm.end;
    }
  });
  out += text.slice(cursor);
  slog('diag.fence.dedup', { total: matches.length, dropped: toDrop.size, kept: matches.length - toDrop.size });
  return out;
}

/**
 * Ejecuta UN run con createAndStream y resuelve cuando termina.
 * Si no llega 'thread.message.completed' pero hubo deltas, sintetiza un 'final'.
 */
async function runOnceWithStream(
  tid: string,
  send: (event: string, data: any) => void,
): Promise<{ fullText: string; sawText: boolean }> {
  const saw = { text: false, deltaChars: 0, fenceSeenInDelta: false };
  const fenceStartRx = /```cv:(itinerary|quote)\b/i;
  const allFencesRx = /```cv:(itinerary|quote)\s*([\s\S]*?)```/g;

  const emitDiag = (phase: 'final' | 'delta' | 'final.synth', extra: Record<string, any> = {}) =>
    send('diag', { phase, threadId: tid, ...extra });

  let fullText = '';
  let runId: string | null = null;
  let finalEmitted = false;

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
          emitDiag('delta', { fenceSeenInDelta: true, runId });
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

        const finalText = dedupeVisibleFencesKeepLast(fullText);
        send('final', { text: finalText });

        // (Opcional) Si llevas Kommo por SSE, aquí puedes extraer y emitir 'kommo'
        // const ops = extractKommoOps(finalText); if (ops.length) send('kommo', { ops });

        finalEmitted = true;
      }
      return;
    }

    if (type === 'thread.run.failed') {
      slog('stream.error', { runId, threadId: tid, error: 'run_failed' });
      send('error', { error: 'run_failed' });
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

  // Si nunca llegó 'message.completed' pero sí hubo deltas, sintetiza un final
  if (!finalEmitted && saw.text && fullText) {
    const finalText = dedupeVisibleFencesKeepLast(fullText);
    send('final', { text: finalText });
  }

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
  } else {
    slog('thread.reuse', { threadId: tid });
  }

  // 2) Adjuntar mensaje del usuario
  await client.beta.threads.messages.create(tid, { role: 'user', content: userText });
  slog('message.append.ok', { threadId: tid });

  const encoder = new TextEncoder();

  const rs = new ReadableStream({
    async start(controller) {
      // ⬇️ DEDUPE ENTRE RUNS (Opción C): evita emitir dos 'final' idénticos
      let __lastFenceKey: string | null = null;
      const send = (event: string, data: any) => {
        try {
          if (event === 'final' && data && typeof data.text === 'string') {
            const m = data.text.match(/```cv:(itinerary|quote)\s*([\s\S]*?)```/i);
            if (m) {
              const key = m[1] + '|' + (m[2] || '').trim();
              if (__lastFenceKey === key) {
                slog('final.skip.dup', { threadId: tid });
                return; // skip duplicado exacto entre runs
              }
              __lastFenceKey = key;
            }
          }
        } catch {}
        controller.enqueue(encoder.encode(sse(event, data)));
      };

      // meta con threadId
      send('meta', { threadId: tid });

      try {
        // ---- Run 1
        const r1 = await runOnceWithStream(tid, send);

        // ¿Dijo “un momento” y NO entregó bloque visible? → reprompt "?"
        const shouldReprompt = !!r1.fullText && !hasVisibleBlock(r1.fullText) && hasWaitPhrase(r1.fullText);

        if (shouldReprompt) {
          slog('auto.reprompt', { reason: 'wait-no-block', threadId: tid });
          await client.beta.threads.messages.create(tid, { role: 'user', content: '?' });
          slog('message.append.ok', { threadId: tid, info: 'auto-?' });

          // ---- Run 2 (reprompt)
          const r2 = await runOnceWithStream(tid, send);

          // Fallback si el reprompt no emitió nada
          if (!r2.sawText) {
            slog('auto.reprompt.retry', { reason: 'r2-no-text', threadId: tid });
            await client.beta.threads.messages.create(tid, { role: 'user', content: 'continua' });
            slog('message.append.ok', { threadId: tid, info: 'auto-continue' });
            await runOnceWithStream(tid, send);
          }
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
