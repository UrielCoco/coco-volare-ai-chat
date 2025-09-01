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

function slog(event: string, meta: Record<string, any> = {}) {
  try { console.info(JSON.stringify({ tag: '[CV][server]', event, ...meta })); } catch {}
}

// --- helpers OpenAI / streaming ---
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

const WAIT_PATTERNS = [
  /dame un momento/i, /un momento/i, /perm[ií]teme/i, /en breve/i,
  /lo preparo/i, /te preparo/i, /voy a preparar/i, /estoy preparando/i,
  /give me a moment/i, /one moment/i, /hold on/i, /let me/i,
  /i('|’)ll prepare/i, /i will prepare/i, /i('|’)m preparing/i, /working on it/i,
  /un attimo/i, /lascia(mi)? che/i, /preparo/i, /sto preparando/i,
  /um momento/i, /deixa eu/i, /vou preparar/i, /estou preparando/i,
  /un instant/i, /laisse(-|\s)?moi/i, /je vais pr[eé]parer/i, /je pr[eé]pare/i,
  /einen moment/i, /lass mich/i, /ich werde vorbereiten/i, /ich bereite vor/i,
];
const hasWaitPhrase = (t: string) => WAIT_PATTERNS.some((rx) => rx.test(t || ''));
const hasVisibleBlock = (t: string) => /```cv:(itinerary|quote)\b/.test(t || '');

function dedupeVisibleFencesKeepLast(text: string) {
  const rx = /```cv:(itinerary|quote)\s*([\s\S]*?)```/g;
  const matches: { start: number; end: number; raw: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = rx.exec(text))) {
    const raw = m[0];
    matches.push({ start: m.index, end: m.index + raw.length, raw });
  }
  if (matches.length <= 1) return text;

  const seen = new Set<string>();
  const keep = new Array(matches.length).fill(false);
  for (let i = matches.length - 1; i >= 0; i--) {
    const key = matches[i].raw;
    if (!seen.has(key)) { seen.add(key); keep[i] = true; }
  }
  let out = '';
  let cursor = 0;
  for (let i = 0; i < matches.length; i++) {
    const mm = matches[i];
    out += text.slice(cursor, mm.start);
    if (keep[i]) out += mm.raw;
    cursor = mm.end;
  }
  out += text.slice(cursor);
  return out;
}

async function runOnceWithStream(
  tid: string,
  send: (event: string, data: any) => void,
): Promise<{ fullText: string; sawText: boolean }> {
  const saw = { text: false, deltaChars: 0 };
  let fullText = '';
  let runId: string | null = null;
  let finalEmitted = false;

  const stream: any = await client.beta.threads.runs.createAndStream(tid, { assistant_id: ASSISTANT_ID });

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
    stream.on('end', () => { slog('stream.end', { deltaChars: saw.deltaChars, sawText: saw.text, runId, threadId: tid }); resolve(); });
    stream.on('error', (err: any) => { slog('exception.stream', { runId, threadId: tid, error: String(err?.message || err) }); send('error', { error: String(err?.message || err) }); resolve(); });
  });

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

  let tid = String(threadId || '');
  if (!tid) {
    const t = await client.beta.threads.create();
    tid = t.id;
    slog('thread.created', { threadId: tid });
  } else {
    slog('thread.reuse', { threadId: tid });
  }

  await client.beta.threads.messages.create(tid, { role: 'user', content: userText });
  slog('message.append.ok', { threadId: tid });

  const encoder = new TextEncoder();

  const rs = new ReadableStream({
    async start(controller) {
      let __lastFenceKey: string | null = null;
      const send = (event: string, data: any) => {
        try {
          if (event === 'final' && data && typeof data.text === 'string') {
            const m = data.text.match(/```cv:(itinerary|quote)\s*([\s\S]*?)```/i);
            if (m) {
              const key = m[1] + '|' + (m[2] || '').trim();
              if (__lastFenceKey === key) { slog('final.skip.dup', { threadId: tid }); return; }
              __lastFenceKey = key;
            }
          }
        } catch {}
        controller.enqueue(encoder.encode(`data:${JSON.stringify({ event, ...data })}\n\n`));
      };

      send('meta', { threadId: tid });

      try {
        const r1 = await runOnceWithStream(tid, send);
        const shouldReprompt = !!r1.fullText && !hasVisibleBlock(r1.fullText) && hasWaitPhrase(r1.fullText);

        if (shouldReprompt) {
          slog('auto.reprompt', { reason: 'wait-no-block', threadId: tid });
          await client.beta.threads.messages.create(tid, { role: 'user', content: '?' });
          slog('message.append.ok', { threadId: tid, info: 'auto-?' });
          const r2 = await runOnceWithStream(tid, send);

          if (!r2.sawText) {
            slog('auto.reprompt.retry', { reason: 'r2-no-text', threadId: tid });
            await client.beta.threads.messages.create(tid, { role: 'user', content: 'continua' });
            slog('message.append.ok', { threadId: tid, info: 'auto-continue' });
            await runOnceWithStream(tid, send);
          }
        }

        controller.enqueue(encoder.encode(`data:${JSON.stringify({ event: 'done' })}\n\n`));
        controller.close();
      } catch (e: any) {
        slog('exception.createStream', { error: String(e?.message || e) });
        controller.enqueue(encoder.encode(`data:${JSON.stringify({ event: 'error', error: String(e?.message || e) })}\n\n`));
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
