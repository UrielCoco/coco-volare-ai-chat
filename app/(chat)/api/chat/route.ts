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

// ---------- Dedupe de fences visibles (conserva el ÚLTIMO idéntico) ----------
function dedupeVisibleFencesKeepLast(text: string): string {
  if (!text) return text;
  const rx = /```cv:(itinerary|quote)\s*([\s\S]*?)```/gi;
  const matches: Array<{ start: number; end: number; raw: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = rx.exec(text))) {
    matches.push({ start: m.index, end: m.index + m[0].length, raw: m[0] });
  }
  if (matches.length <= 1) return text;

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

  slog('diag.fence.dedup', {
    total: matches.length,
    dropped: toDrop.size,
    kept: matches.length - toDrop.size,
  });

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

        // conteo de fences + huellas
        const fences = [...fullText.matchAll(allFencesRx)];
        const fenceCount = fences.length;
        const fenceTypes = fences.map((m) => m[1]);
        const hashes = fences.map((m) => {
          const raw = m[0];
          let h = 0;
          for (let i = 0; i < raw.length; i++) h = (h * 31 + raw.charCodeAt(i)) >>> 0;
          return h.toString(16);
        });

        emitDiag('final', {
          runId,
          fenceCount,
          fenceTypes,
          hashes,
          unique: new Set(hashes).size,
          fenceSeenInDelta: saw.fenceSeenInDelta,
        });

        const finalText = dedupeVisibleFencesKeepLast(complete);
        send('final', { text: finalText });

        const ops = extractKommoOps(finalText);
        slog('message.completed', {
          fullLen: finalText.length,
          kommoOps: ops.length,
          runId,
          threadId: tid,
        });
        if (ops.length) send('kommo', { ops });

        finalEmitted = true;
      }
      return;
    }

    if (type === 'thread.run.completed') {
      // Por si el proveedor no envió 'thread.message.completed', cerramos nosotros
      if (saw.text && !finalEmitted) {
        const fences = [...fullText.matchAll(allFencesRx)];
        const fenceCount = fences.length;
        const fenceTypes = fences.map((m) => m[1]);
        const hashes = fences.map((m) => {
          const raw = m[0];
          let h = 0;
          for (let i = 0; i < raw.length; i++) h = (h * 31 + raw.charCodeAt(i)) >>> 0;
          return h.toString(16);
        });

        emitDiag('final.synth', {
          runId,
          fenceCount,
          fenceTypes,
          hashes,
          unique: new Set(hashes).size,
          fenceSeenInDelta: saw.fenceSeenInDelta,
        });

        const finalText = dedupeVisibleFencesKeepLast(fullText);
        send('final', { text: finalText });

        const ops = extractKommoOps(finalText);
        slog('message.completed', {
          fullLen: finalText.length,
          kommoOps: ops.length,
          runId,
          threadId: tid,
        });
        if (ops.length) send('kommo', { ops });

        finalEmitted = true;
      }
      return;
    }

    if (type === 'thread.run.failed') {
      slog('stream.error', { runId, threadId: tid, error: 'run_failed' });
      send('error', { error: 'run_failed' });
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
      // Último salvavidas: si hubo texto pero no se emitió final,
      // lo sintetizamos aquí antes de cerrar el stream.
      if (saw.text && !finalEmitted) {
        const fences = [...fullText.matchAll(/```cv:(itinerary|quote)\s*([\s\S]*?)```/g)];
        const fenceCount = fences.length;
        const fenceTypes = fences.map((m) => m[1]);
        const hashes = fences.map((m) => {
          const raw = m[0];
          let h = 0;
          for (let i = 0; i < raw.length; i++) h = (h * 31 + raw.charCodeAt(i)) >>> 0;
          return h.toString(16);
        });

        slog('diag.fence.final.synth.end', {
          runId,
          threadId: tid,
          fenceCount,
          fenceTypes,
          hashes,
          unique: new Set(hashes).size,
          fenceSeenInDelta: saw.fenceSeenInDelta,
        });

        const finalText = dedupeVisibleFencesKeepLast(fullText);
        send('final', { text: finalText });

        const ops = extractKommoOps(finalText);
        if (ops.length) send('kommo', { ops });

        finalEmitted = true;
      }

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
