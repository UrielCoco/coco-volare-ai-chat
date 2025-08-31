// Fuerza runtime Node y evita caché/edge
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

import { NextRequest } from 'next/server';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
const ASSISTANT_ID = process.env.CV_ASSISTANT_ID!;

// ---------- Utils básicos ----------
function sseLine(event: string, data: any) {
  return `event: ${event}\n` + `data: ${JSON.stringify(data)}\n\n`;
}
function hasVisibleBlock(text: string): boolean {
  return /```cv:(itinerary|quote)\b/.test(text || '');
}

// Señales “dame un momento / estoy preparándolo” (multi-idioma)
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

// Extraer cv:kommo desde texto (por si llega embebido)
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

// Compat para distintas versiones del SDK en runs.retrieve
// - Firma A: runs.retrieve(threadId: string, runId: string)
// - Firma B: runs.retrieve(threadId: string, params: { run_id: string })
async function retrieveRunCompat(threadId: string, runId: string) {
  const runs: any = (openai as any).beta.threads.runs;
  try {
    if (typeof runs.retrieve === 'function' && runs.retrieve.length === 2) {
      return await runs.retrieve(threadId, runId);
    }
  } catch {
    // fallthrough
  }
  return await runs.retrieve(threadId, { run_id: runId });
}

// Fallback sin streaming: 1 run normal + poll corto y emitir último mensaje del assistant
async function runNoStreamAndEmit(args: {
  threadId: string;
  safeEmit: (event: string, data: any) => void;
}) {
  const { threadId, safeEmit } = args;

  const run = await openai.beta.threads.runs.create(threadId, { assistant_id: ASSISTANT_ID });

  // Poll corto (hasta ~12s)
  for (let i = 0; i < 24; i++) {
    const r = await retrieveRunCompat(threadId, run.id);
    const st = String(r.status);
    if (['completed', 'failed', 'cancelled', 'expired', 'incomplete'].includes(st)) break;
    await new Promise((res) => setTimeout(res, 500));
  }

  // Tomar último mensaje del assistant
  const msgs = await openai.beta.threads.messages.list(threadId, { limit: 10 } as any);
  const arr = (msgs?.data || []) as any[];
  const lastAssistant = arr
    .filter((m) => m.role === 'assistant')
    .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))[0];

  let txt = '';
  const content = (lastAssistant?.content || []) as any[];
  if (content.length) {
    txt = content
      .filter((p) => p.type === 'output_text' || p.type === 'text')
      .map((p: any) => p.text?.value || p.text || '')
      .join('');
  }

  if (txt) {
    safeEmit('final', { text: txt });
    const kommo = extractKommoBlocksFromText(txt);
    for (const b of kommo) safeEmit('kommo', { ops: b.json.ops });
  } else {
    safeEmit('error', { message: 'No text returned on non-stream path.' });
  }
  return txt;
}

async function runAndStreamOnce(args: {
  threadId: string;
  controller: ReadableStreamDefaultController<Uint8Array>;
  encoder: TextEncoder;
  tag: string;
  isClosedRef: { v: boolean };
}) {
  const { threadId, controller, encoder, tag, isClosedRef } = args;

  const safeEnqueue = (chunk: Uint8Array) => {
    if (isClosedRef.v) return;
    try { controller.enqueue(chunk); } catch {}
  };
  const safeEmit = (event: string, data: any) => {
    safeEnqueue(encoder.encode(sseLine(event, data)));
  };

  let fullText = '';
  let kommoSent = 0;

  // 1) Intento con streaming
  try {
    const stream: any = await openai.beta.threads.runs.stream(threadId, {
      assistant_id: ASSISTANT_ID,
      // temperature: 0.3,
    });

    stream
      .on('run.created', (e: any) => {
        safeEmit('run.created', { runId: e.id });
        console.log(JSON.stringify({ tag, event: 'run.created', runId: e.id, threadId }));
      })
      .on('text.delta', (d: any) => {
        if (d?.value) {
          fullText += d.value;
          safeEmit('delta', { value: d.value });
          const blocks = extractKommoBlocksFromText(fullText);
          if (blocks.length) {
            for (const b of blocks) {
              safeEmit('kommo', { ops: b.json.ops });
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
          safeEmit('final', { text: txt });
          const blocks = extractKommoBlocksFromText(txt);
          if (blocks.length) {
            for (const b of blocks) {
              safeEmit('kommo', { ops: b.json.ops });
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
        safeEmit('stream.end', { deltaChars: fullText.length, sawText: !!fullText });
      })
      .on('error', (e: any) => {
        safeEmit('warn', { message: e?.message || 'stream error' });
      });

    try {
      await stream.done();
    } catch (e: any) {
      safeEmit('warn', { message: e?.message || 'stream.done error' });
    }
  } catch (err: any) {
    // 2) Fallback si el stream ni siquiera inicia
    safeEmit('warn', { message: 'stream.create failed; falling back to non-stream run' });
    const txt = await runNoStreamAndEmit({ threadId, safeEmit });
    fullText += txt || '';
  }

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

    // Garantizar threadId string
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
        let isClosedRef = { v: false };
        const safeEnqueue = (chunk: Uint8Array) => {
          if (isClosedRef.v) return;
          try { controller.enqueue(chunk); } catch {}
        };
        const safeEmit = (event: string, data: any) => {
          safeEnqueue(encoder.encode(sseLine(event, data)));
        };
        const safeClose = () => {
          if (isClosedRef.v) return;
          isClosedRef.v = true;
          try { controller.close(); } catch {}
        };

        // meta para que el cliente guarde el threadId
        safeEmit('meta', { threadId });

        // 1) Guardar mensaje del usuario
        await appendUserMessage(threadId, userText);
        console.log(JSON.stringify({ tag, event: 'message.append.ok', threadId }));

        // 2) Primer run
        const r1 = await runAndStreamOnce({ threadId, controller, encoder, tag, isClosedRef });

        const r1HasBlock = hasVisibleBlock(r1.fullText);
        const r1IsQuestion = isJustQuestion(r1.fullText);
        const r1HasWait = assistantHasWaitPhrase(r1.fullText);

        // 3) Si terminó con “espera tantito” y sin bloque, reprompt “?”
        const shouldReprompt = !r1HasBlock && !r1IsQuestion && r1HasWait;

        if (!shouldReprompt) {
          safeEmit('done', { reason: 'ended-first-run', r1HasBlock, r1IsQuestion, r1HasWait });
          safeClose();
          return;
        }

        // 4) Mandar “?” y segundo run
        await continueWithQuestion(threadId);
        console.log(JSON.stringify({ tag, event: 'message.append.ok', info: 'auto-reprompt-?', threadId }));

        const r2 = await runAndStreamOnce({ threadId, controller, encoder, tag, isClosedRef });

        safeEmit('done', {
          reason: 'after-reprompt-?',
          appendedChars: (r1.fullText.length + r2.fullText.length),
        });
        safeClose();
      },
      cancel() {
        // Si el cliente corta la conexión, simplemente dejamos de emitir.
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
