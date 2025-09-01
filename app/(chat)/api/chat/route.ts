import { NextRequest } from 'next/server';
import OpenAI from 'openai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
const ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID!;

/** ----------------- logging (compacto) ----------------- */
function log(event: string, meta: Record<string, any> = {}) {
  try { console.info(JSON.stringify({ tag: '[CV][server]', event, ...meta })); } catch {}
}

/** ----------------- SSE helpers ----------------- */
const sse = (event: string, data: any) => `event:${event}\n` + `data:${JSON.stringify(data)}\n\n`;

/** ----------------- text helpers ----------------- */
function extractDeltaTextFromEvent(e: any): string {
  try {
    const arr = e?.data?.delta?.content;
    if (!Array.isArray(arr)) return '';
    let out = '';
    for (const it of arr) {
      if (it?.type === 'text' && it?.text?.value) out += it.text.value;
      if (it?.type === 'output_text' && it?.text?.value) out += it.text.value; // algunos modelos
    }
    return out;
  } catch { return ''; }
}
function flattenAssistantTextFromMessage(m: any): string {
  const out: string[] = [];
  for (const c of (m?.content || [])) {
    if (c.type === 'text' && c.text?.value) out.push(c.text.value);
  }
  return out.join('\n');
}

// fences: ```cv:itinerary ...``` y ```cv:quote ...```
const FENCE_RX = /```cv:(itinerary|quote)\s*([\s\S]*?)```/gi;
type Block = { type: 'itinerary' | 'quote', json: any, raw: string };

function parseBlocksAndClean(text: string): { cleanText: string; blocks: Block[] } {
  const blocks: Block[] = [];
  let clean = text || '';
  // colecta
  const matches = [...clean.matchAll(FENCE_RX)];
  for (const m of matches) {
    const type = (m[1] as 'itinerary' | 'quote');
    const rawJson = (m[2] || '').trim();
    let parsed: any = null;
    try { parsed = JSON.parse(rawJson); } catch { /* si viene incompleto, lo ignoramos */ }
    if (parsed) blocks.push({ type, json: parsed, raw: m[0] });
  }
  // elimina del texto todos los fences
  clean = clean.replace(FENCE_RX, '').trim();
  // dedupe por contenido JSON
  const seen = new Set<string>();
  const deduped: Block[] = [];
  for (let i = blocks.length - 1; i >= 0; i--) {
    const key = `${blocks[i].type}:${JSON.stringify(blocks[i].json)}`;
    if (!seen.has(key)) { seen.add(key); deduped.push(blocks[i]); }
  }
  deduped.reverse();
  return { cleanText: clean, blocks: deduped };
}

const WAIT_PATTERNS = [
  /dame un momento/i, /un momento/i, /perm[ií]teme/i, /en breve/i,
  /lo preparo/i, /te preparo/i, /voy a preparar/i, /estoy preparando/i, /déjame preparar/i,
  /give me a moment/i, /one moment/i, /hold on/i, /let me.*prepare/i,
  /i('|’)ll prepare/i, /i will prepare/i, /i('|’)m preparing/i, /working on it/i,
];
const hasWaitPhrase = (t: string) => WAIT_PATTERNS.some(r => r.test(t || ''));

const ITINERARY_TRIGGER = /\b(itinerario|plan de viaje|route|hazlo|dale|ok\b|procede|armarlo|listo|sí adelante|si adelante|adelante|go ahead|do it)\b/i;
const QUOTE_TRIGGER = /\b(cotizaci(?:ón|on)|cotiza|presupuesto|precio|precios|costo|costos|quote|pricing|how much|cu[aá]nto)\b/i;
const wants = (userText: string) => ({
  it: ITINERARY_TRIGGER.test(userText || ''),
  qu: QUOTE_TRIGGER.test(userText || ''),
});

/** ----------------- run (buffered) ----------------- */
async function runBuffered(
  threadId: string,
  send: (event: string, data: any) => void,
): Promise<{ text: string; blocks: Block[]; sawText: boolean }> {

  let bufText = '';
  let accBlocks: Block[] = [];
  let runId: string | null = null;
  let chars = 0;
  let sawText = false;

  const stream: any = await client.beta.threads.runs.createAndStream(threadId, { assistant_id: ASSISTANT_ID });

  stream.on('event', (e: any) => {
    const ev = e?.event as string;

    if (ev === 'thread.run.created') {
      runId = e?.data?.id ?? null;
      log('run.created', { runId, threadId });
      return;
    }

    if (ev === 'thread.message.delta') {
      const d = extractDeltaTextFromEvent(e);
      if (d) {
        bufText += d;
        chars += d.length;
        sawText = true;
        if (chars % 800 === 0) log('stream.delta.tick', { runId, threadId, deltaChars: chars });
      }
      return;
    }

    if (ev === 'thread.message.completed') {
      // asegura recoger texto que venga en el "completed"
      const add = flattenAssistantTextFromMessage(e?.data);
      if (add) { bufText += add; sawText = true; }
      return;
    }

    if (ev === 'thread.run.failed') {
      // dejamos que el flujo cierre; afuera enviaremos un "final" con lo que haya
      log('stream.error', { runId, threadId, error: 'run_failed' });
      send('error', { error: 'run_failed' });
      return;
    }
  });

  await new Promise<void>((resolve) => {
    stream.on('end', resolve);
    stream.on('error', (err: any) => {
      log('exception.stream', { runId, threadId, error: String(err?.message || err) });
      send('error', { error: String(err?.message || err) });
      resolve();
    });
  });

  // al terminar el stream, parseamos y limpiamos
  const { cleanText, blocks } = parseBlocksAndClean(bufText);
  accBlocks = blocks;

  // log compacto del final
  log('message.completed', {
    runId, threadId,
    textLen: cleanText.length,
    blocks: accBlocks.map(b => ({ type: b.type, keys: Object.keys(b.json || {}).slice(0, 6) })),
  });

  // emitimos el único "final" de este run
  send('final', { text: cleanText, blocks: accBlocks });

  return { text: cleanText, blocks: accBlocks, sawText };
}

/** ----------------- route ----------------- */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const queryTid = req.nextUrl.searchParams.get('threadId') || '';
  const bodyTid = body?.threadId || '';
  const userText = typeof body?.message === 'string'
    ? body.message
    : (body?.message?.parts?.[0]?.text || '');

  log('request.in', { hasThreadId: !!(queryTid || bodyTid), userTextLen: (userText || '').length });

  // thread
  let threadId = String(queryTid || bodyTid || '');
  if (!threadId) {
    const t = await client.beta.threads.create();
    threadId = t.id;
    log('thread.created', { threadId });
  } else {
    log('thread.reuse', { threadId });
  }

  // append user message
  await client.beta.threads.messages.create(threadId, { role: 'user', content: userText });
  log('message.append.ok', { threadId });

  const encoder = new TextEncoder();

  const rs = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: any) => {
        // sólo logeamos eventos relevantes para no llenar logs
        if (event === 'final') {
          log('final.emit', {
            threadId,
            textLen: (data?.text || '').length,
            blocks: (data?.blocks || []).map((b: any) => ({ type: b.type })),
          });
        } else if (event === 'error' || event === 'done' || event === 'meta') {
          log(event, { keys: Object.keys(data || {}) });
        }
        controller.enqueue(encoder.encode(sse(event, data)));
      };

      // meta + “pensando”
      send('meta', { threadId });
      // si quieres un heartbeat visual, déjalo; no logea
      const hb = setInterval(() => controller.enqueue(encoder.encode(sse('hb', { t: Date.now() }))), 8000);

      try {
        // run 1 (buffered)
        const r1 = await runBuffered(threadId, send);

        const intent = wants(userText.toLowerCase());
        const expectedBlock = intent.it || intent.qu;
        const gotBlock = (r1.blocks || []).length > 0;
        const promised = hasWaitPhrase(r1.text);

        const needReprompt = (!gotBlock && (expectedBlock || promised));

        if (needReprompt) {
          log('auto.reprompt', { reason: expectedBlock ? 'expected-block-missing' : 'wait-no-block', threadId });
          await client.beta.threads.messages.create(threadId, { role: 'user', content: '?' });
          log('message.append.ok', { threadId, info: 'auto-?' });

          const r2 = await runBuffered(threadId, send);
          if (!r2.sawText) {
            await client.beta.threads.messages.create(threadId, { role: 'user', content: 'continua' });
            log('message.append.ok', { threadId, info: 'auto-continue' });
            await runBuffered(threadId, send);
          }
        } else {
          log('auto.reprompt.skip', { reason: 'no-need', threadId });
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
