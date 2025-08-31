import { NextRequest } from 'next/server';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
const ASSISTANT_ID = process.env.CV_ASSISTANT_ID!;

// ---------- Utils ----------
function sseLine(event: string, data: any) {
  return `event: ${event}\n` + `data: ${JSON.stringify(data)}\n\n`;
}
function hasVisibleBlock(text: string): boolean {
  return /```cv:(itinerary|quote)\b/.test(text || '');
}

// Señales “dame un momento / estoy preparándolo” en varios idiomas
const WAIT_PATTERNS = [
  // ES
  /dame un momento/i, /un momento/i, /perm[ií]teme/i, /en breve/i, /lo preparo/i, /te preparo/i, /voy a preparar/i, /estoy preparando/i,
  // EN
  /give me a moment/i, /one moment/i, /hold on/i, /let me/i, /i('|’)ll prepare/i, /i will prepare/i, /i('|’)m preparing/i, /working on it/i,
  // IT
  /un attimo/i, /lascia(mi)? che/i, /preparo/i, /sto preparando/i,
  // PT
  /um momento/i, /deixa eu/i, /vou preparar/i, /estou preparando/i,
  // FR
  /un instant/i, /laisse(-|\s)?moi/i, /je vais pr[eé]parer/i, /je pr[eé]pare/i,
  // DE
  /einen moment/i, /lass mich/i, /ich werde vorbereiten/i, /ich bereite vor/i,
];
function assistantHasWaitPhrase(text: string): boolean {
  const t = text || '';
  return WAIT_PATTERNS.some((rx) => rx.test(t));
}
function isJustQuestion(text: string): boolean {
  const t = (text || '').trim();
  if (!t) return false;
  if (hasVisibleBlock(t)) return false;
  const qm = t.includes('?') || t.includes('¿') || t.includes('？');
  const endsQ = /[?？]\s*$/.test(t);
  if (assistantHasWaitPhrase(t)) return false;
  return qm || endsQ;
}

// Extraer cv:kommo desde texto (por si viene embebido)
function extractBalancedJson(src: string, startIdx: number): string | null {
  let inString = false, escape = false, depth = 0, first = -1;
  for (let i = startIdx; i < src.length; i++) {
    const ch = src[i];
    if (inString) {
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === '"') { inString = false; continue; }
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{') { if (depth === 0) first = i; depth++; continue; }
    if (ch === '}') { depth--; if (depth === 0 && first >= 0) return src.slice(first, i + 1); }
  }
  return null;
}
function extractKommoBlocksFromText(text: string): Array<{ raw: string; json: any }> {
  const blocks: Array<{ raw: string; json: any }> = [];
  if (!text) return blocks;

  const rxFence = /```\s*cv:kommo\s*([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  while ((m = rxFence.exec(text))) {
    const candidate = (m[1] || '').trim();
    try {
      const json = JSON.parse(candidate);
      if (json && Array.isArray(json.ops)) blocks.push({ raw: candidate, json });
    } catch {}
  }
  if (blocks.length) return blocks;

  const at = text.toLowerCase().indexOf('```cv:kommo');
  if (at >= 0) {
    const openBrace = text.indexOf('{', at);
    if (openBrace >= 0) {
      const jsonSlice = extractBalancedJson(text, openBrace);
      if (jsonSlice) {
        try {
          const json = JSON.parse(jsonSlice);
          if (json && Array.isArray(json.ops)) blocks.push({ raw: jsonSlice, json });
        } catch {}
      }
    }
  }
  return blocks;
}

// ---------- OpenAI helpers ----------
async function appendUserMessage(threadId: string, text: string) {
  await openai.beta.threads.messages.create(threadId, { role: 'user', content: text });
}

async function runAndStreamOnce(args: {
  threadId: string;
  controller: ReadableStreamDefaultController<Uint8Array>;
  encoder: TextEncoder;
  tag: string;
}) {
  const { threadId, controller, encoder, tag } = args;

  // OJO: sin max_output_tokens para evitar TS error en tu SDK
  const stream: any = await openai.beta.threads.runs.stream(threadId, {
    assistant_id: ASSISTANT_ID,
    // temperature: 0.3,
  });

  let fullText = '';
  let kommoSent = 0;

  stream
    .on('run.created', (e: any) => {
      controller.enqueue(encoder.encode(sseLine('run.created', { runId: e.id })));
      console.log(JSON.stringify({ tag, event: 'run.created', runId: e.id, threadId }));
    })
    .on('text.delta', (d: any) => {
      if (d?.value) {
        fullText += d.value;
        controller.enqueue(encoder.encode(sseLine('delta', { value: d.value })));
        const blocks = extractKommoBlocksFromText(fullText);
        if (blocks.length) {
          for (const b of blocks) {
            controller.enqueue(encoder.encode(sseLine('kommo', { ops: b.json.ops })));
            kommoSent += b.json.ops?.length || 0;
          }
        }
      }
    })
    .on('message.completed', (msg: any) => {
      const txt = (msg?.content || [])
        .filter((p: any) => p.type === 'output_text' || p.type === 'text')
        .map((p: any) => p.text?.value || p.text || '')
        .join('');

      if (txt) {
        fullText += txt;
        controller.enqueue(encoder.encode(sseLine('final', { text: txt })));
        const blocks = extractKommoBlocksFromText(txt);
        if (blocks.length) {
          for (const b of blocks) {
            controller.enqueue(encoder.encode(sseLine('kommo', { ops: b.json.ops })));
            kommoSent += b.json.ops?.length || 0;
          }
        }
      }

      console.log(JSON.stringify({
        tag, event: 'message.completed', fullLen: fullText.length,
        kommoOps: kommoSent, threadId, runId: stream?.current?.id,
      }));
    })
    .on('end', () => {
      controller.enqueue(encoder.encode(sseLine('stream.end', { deltaChars: fullText.length, sawText: !!fullText })));
    })
    .on('error', (e: any) => {
      controller.enqueue(encoder.encode(sseLine('error', { message: e?.message || 'stream error' })));
      controller.close();
    });

  await stream.done();
  return { fullText, kommoSent };
}

// Reprompt minimalista: mandar "?" UNA sola vez
async function continueWithQuestion(threadId: string) {
  await openai.beta.threads.messages.create(threadId, { role: 'user', content: '?' });
}

export async function POST(req: NextRequest) {
  const tag = '[CV][server]';
  try {
    const body = (await req.json()) as {
      message: { role: 'user'; parts: Array<{ type: 'text'; text: string }> };
      threadId?: string | null;
    };

    const userText: string = body?.message?.parts?.[0]?.text ?? '';
    console.log(JSON.stringify({ tag, event: 'request.in', hasThreadId: !!body?.threadId, userTextLen: userText.length }));

    // Asegurar threadId como string (evita union types)
    let threadId: string;
    if (body?.threadId && body.threadId.length > 0) {
      threadId = body.threadId;
      console.log(JSON.stringify({ tag, event: 'thread.reuse', threadId }));
    } else {
      const t = await openai.beta.threads.create();
      threadId = t.id;
      console.log(JSON.stringify({ tag, event: 'thread.created', threadId }));
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(encoder.encode(sseLine('meta', { threadId })));

        // 1) Guardar mensaje del usuario
        await appendUserMessage(threadId, userText);
        console.log(JSON.stringify({ tag, event: 'message.append.ok', threadId }));

        // 2) Primer run
        const r1 = await runAndStreamOnce({ threadId, controller, encoder, tag });

        const r1HasBlock = hasVisibleBlock(r1.fullText);
        const r1IsQuestion = isJustQuestion(r1.fullText);
        const r1HasWait = assistantHasWaitPhrase(r1.fullText);

        // 3) Si terminó con “espera tantito” y sin bloque, reprompt “?”
        const shouldReprompt = !r1HasBlock && !r1IsQuestion && r1HasWait;

        if (!shouldReprompt) {
          controller.enqueue(encoder.encode(sseLine('done', {
            reason: 'ended-first-run',
            r1HasBlock, r1IsQuestion, r1HasWait
          })));
          controller.close();
          return;
        }

        // 4) Mandar “?” y segundo run
        await continueWithQuestion(threadId);
        console.log(JSON.stringify({ tag, event: 'message.append.ok', info: 'auto-reprompt-?', threadId }));

        const r2 = await runAndStreamOnce({ threadId, controller, encoder, tag });

        controller.enqueue(encoder.encode(sseLine('done', {
          reason: 'after-reprompt-?',
          appendedChars: (r1.fullText.length + r2.fullText.length),
        })));
        controller.close();
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (err: any) {
    console.error(tag, 'route.error', err?.message || err);
    return new Response(JSON.stringify({ error: err?.message || 'unknown' }), { status: 500 });
  }
}
