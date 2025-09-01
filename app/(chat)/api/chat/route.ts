import { NextRequest } from 'next/server';
import OpenAI from 'openai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
const ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID!;

// ---------- Logs (una sola salida para evitar duplicados en Vercel) ----------
function log(event: string, meta: Record<string, any> = {}) {
  try { console.info(JSON.stringify({ tag: '[CV][server]', event, ...meta })); } catch {}
}

// ---------- SSE helper (IMPORTANTE: incluye cabecera event:) ----------
function sse(event: string, data: any) {
  return `event:${event}\n` + `data:${JSON.stringify(data)}\n\n`;
}

// ---------- OpenAI helpers ----------
function flattenAssistantTextFromMessage(m: any): string {
  const out: string[] = [];
  for (const c of (m?.content || [])) {
    if (c.type === 'text' && c.text?.value) out.push(c.text.value);
  }
  return out.join('\n');
}

function extractDeltaTextFromEvent(e: any): string {
  try {
    const content = e?.data?.delta?.content;
    if (Array.isArray(content)) {
      const parts: string[] = [];
      for (const it of content) {
        if (it?.type === 'text' && it?.text?.value) parts.push(it.text.value);
        if (it?.type === 'output_text' && it?.text?.value) parts.push(it.text.value);
      }
      return parts.join('');
    }
  } catch {}
  return '';
}

const hasVisibleBlock = (t: string) => /```cv:(itinerary|quote)\b/.test(t || '');
const WAIT_PATTERNS = [
  /dame un momento/i, /un momento/i, /perm[ií]teme/i, /en breve/i,
  /lo preparo/i, /te preparo/i, /voy a preparar/i, /estoy preparando/i,
  /d[eé]jame\b/i, /d[eé]jame preparar/i, /deja que/i,
  /give me a moment/i, /one moment/i, /hold on/i, /let me/i,
  /i('|’)ll prepare/i, /i will prepare/i, /i('|’)m preparing/i, /working on it/i,
];
const hasWaitPhrase = (t: string) => WAIT_PATTERNS.some((rx) => rx.test(t || ''));

function findFences(text: string) {
  const rx = /```cv:(itinerary|quote)\s*([\s\S]*?)```/g;
  const arr: { label: string; json: string; len: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = rx.exec(text || ''))) {
    const json = (m[2] || '').trim();
    arr.push({ label: m[1], json, len: json.length });
  }
  return arr;
}

function dedupeVisibleFencesKeepLast(text: string) {
  const rx = /```cv:(itinerary|quote)\s*([\s\S]*?)```/g;
  const matches: { start: number; end: number; raw: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = rx.exec(text))) matches.push({ start: m.index, end: m.index + m[0].length, raw: m[0] });
  if (matches.length <= 1) return text;

  const seen = new Set<string>();
  const keep = new Array(matches.length).fill(false);
  for (let i = matches.length - 1; i >= 0; i--) {
    if (!seen.has(matches[i].raw)) { seen.add(matches[i].raw); keep[i] = true; }
  }
  let out = '', cursor = 0;
  for (let i = 0; i < matches.length; i++) {
    const mm = matches[i];
    out += text.slice(cursor, mm.start);
    if (keep[i]) out += mm.raw;
    cursor = mm.end;
  }
  out += text.slice(cursor);
  log('diag.fence.dedup', { total: matches.length, dropped: matches.length - keep.filter(Boolean).length });
  return out;
}

// ---------- Run (single) ----------
async function runOnceWithStream(
  threadId: string,
  send: (event: string, data: any) => void,
): Promise<{ fullText: string; sawText: boolean }> {
  let fullText = '';
  let finalEmitted = false;
  let runId: string | null = null;
  const seen = { text: false, deltaChars: 0 };

  const stream: any = await client.beta.threads.runs.createAndStream(threadId, { assistant_id: ASSISTANT_ID });

  stream.on('event', (e: any) => {
    const type = e?.event as string;

    if (type === 'thread.run.created') {
      runId = e?.data?.id ?? null;
      log('run.created', { runId, threadId });
      return;
    }

    if (type === 'thread.message.delta') {
      const delta = extractDeltaTextFromEvent(e);
      if (delta) {
        seen.text = true;
        seen.deltaChars += delta.length;
        fullText += delta;
        send('delta', { value: delta });
        if (seen.deltaChars % 300 === 0) log('stream.delta.tick', { runId, threadId, deltaChars: seen.deltaChars });
      }
      return;
    }

    if (type === 'thread.message.completed') {
      const add = flattenAssistantTextFromMessage(e?.data);
      if (add) {
        seen.text = true;
        fullText += add;

        const finalText = dedupeVisibleFencesKeepLast(fullText);
        const fences = findFences(finalText);
        log('message.completed', {
          runId, threadId,
          textLen: finalText.length,
          fences: fences.map(f => ({ label: f.label, len: f.len, preview: f.json.slice(0, 160) })),
          hasVisibleBlock: hasVisibleBlock(finalText),
        });

        send('final', { text: finalText });
        finalEmitted = true;
      }
      return;
    }

    if (type === 'thread.run.failed') {
      log('stream.error', { runId, threadId, error: 'run_failed' });
      send('error', { error: 'run_failed' });
      return;
    }
  });

  await new Promise<void>((resolve) => {
    stream.on('end', () => { log('stream.end', { runId, threadId, deltaChars: seen.deltaChars, sawText: seen.text }); resolve(); });
    stream.on('error', (err: any) => { log('exception.stream', { runId, threadId, error: String(err?.message || err) }); send('error', { error: String(err?.message || err) }); resolve(); });
  });

  if (!finalEmitted && seen.text && fullText) {
    const finalText = dedupeVisibleFencesKeepLast(fullText);
    const fences = findFences(finalText);
    log('message.completed.synthetic', {
      threadId, textLen: finalText.length,
      fences: fences.map(f => ({ label: f.label, len: f.len, preview: f.json.slice(0, 160) })),
      hasVisibleBlock: hasVisibleBlock(finalText),
    });
    send('final', { text: finalText });
  }

  return { fullText, sawText: seen.text };
}

// ---------- Route ----------
export async function POST(req: NextRequest) {
  const body = await req.json();
  const queryTid = req.nextUrl.searchParams.get('threadId') || '';
  const bodyTid = body?.threadId || '';
  const msg = body?.message;

  const userText = typeof msg === 'string' ? msg : (msg?.parts?.[0]?.text || '');
  log('request.in', { hasThreadId: !!(queryTid || bodyTid), userTextLen: (userText || '').length });

  // Thread
  let threadId = String(queryTid || bodyTid || '');
  if (!threadId) {
    const t = await client.beta.threads.create();
    threadId = t.id;
    log('thread.created', { threadId });
  } else {
    log('thread.reuse', { threadId });
  }

  // Append user message
  await client.beta.threads.messages.create(threadId, { role: 'user', content: userText });
  log('message.append.ok', { threadId });

  const encoder = new TextEncoder();

  const rs = new ReadableStream({
    async start(controller) {
      // Dedupe entre runs en este MISMO request
      let lastFenceKey: string | null = null;

      const send = (event: string, data: any) => {
        if (event === 'final' && data && typeof data.text === 'string') {
          const fences = findFences(data.text);
          if (fences.length) {
            const key = `${fences[0].label}|${fences[0].json}`;
            if (lastFenceKey === key) { log('final.skip.dup', { threadId }); return; }
            lastFenceKey = key;
          }
          log('final.emit', {
            threadId,
            textLen: data.text.length,
            fences: fences.map(f => ({ label: f.label, len: f.len, preview: f.json.slice(0, 160) })),
            hasVisibleBlock: hasVisibleBlock(data.text),
          });
        } else {
          log('sse.emit', { event, keys: Object.keys(data || {}) });
        }

        controller.enqueue(encoder.encode(sse(event, data)));
      };

      // meta: thread id
      send('meta', { threadId });

      // Heartbeat
      const hb = setInterval(() => {
        try { controller.enqueue(encoder.encode(sse('hb', { t: Date.now() }))); } catch {}
      }, 8000);

      try {
        // Run 1
        const r1 = await runOnceWithStream(threadId, send);

        // Reprompt SI:
        //  - no hay bloque visible, y (a) hay frase de espera o (b) simplemente no hubo bloque (fallback único)
        const shouldReprompt =
          !!r1.fullText &&
          !hasVisibleBlock(r1.fullText) &&
          (hasWaitPhrase(r1.fullText) || true); // fallback único

        if (shouldReprompt) {
          log('auto.reprompt', { reason: hasWaitPhrase(r1.fullText) ? 'wait-no-block' : 'no-block-fallback', threadId });
          await client.beta.threads.messages.create(threadId, { role: 'user', content: '?' });
          log('message.append.ok', { threadId, info: 'auto-?' });

          // Run 2
          const r2 = await runOnceWithStream(threadId, send);

          // Fallback si aún no hubo texto
          if (!r2.sawText) {
            log('auto.reprompt.retry', { reason: 'r2-no-text', threadId });
            await client.beta.threads.messages.create(threadId, { role: 'user', content: 'continua' });
            log('message.append.ok', { threadId, info: 'auto-continue' });
            await runOnceWithStream(threadId, send);
          }
        } else {
          log('auto.reprompt.skip', { reason: 'has-visible-block-or-empty', threadId });
        }

        clearInterval(hb);
        controller.enqueue(encoder.encode(sse('done', {})));
        controller.close();
      } catch (e: any) {
        clearInterval(hb);
        log('exception.createStream', { error: String(e?.message || e) });
        controller.enqueue(encoder.encode(sse('error', { error: String(e?.message || e) })));
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
