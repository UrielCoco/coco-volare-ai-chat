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

  // tiempos
  const t0 = Date.now();
  let tFirstDelta: number | null = null;

  function emitDiag(phase: 'delta' | 'final', extra: Record<string, any> = {}) {
    // SSE opcional para inspección en cliente (no afecta UI si no lo consumes)
    try { send('diag', { phase, threadId: tid, ...extra }); } catch {}
    // Log persistente en Vercel
    slog(phase === 'delta' ? 'diag.fence.delta' : 'diag.fence.final', { threadId: tid, ...extra });
  }

  let fullText = '';
  let runId: string | null = null;

  // Abrimos el stream como ya lo haces (mismo comportamiento)
  // @ts-ignore - tipos del stream varían entre versiones del SDK
  const stream: any = await client.beta.threads.runs.createAndStream(tid, {
    assistant_id: ASSISTANT_ID,
  });

  stream.on('event', (e: any) => {
    const type = e?.event as string;

    // ---- creación de run
    if (type === 'thread.run.created') {
      runId = e?.data?.id ?? null;
      slog('run.created', { runId, threadId: tid });
      return;
    }

    // ---- delta de mensaje
    if (type === 'thread.message.delta') {
      const content = e?.data?.delta?.content ?? [];
      // extrae texto (tu versión original lo hacía así):
      let deltaText = '';
      if (Array.isArray(content)) {
        for (const item of content) {
          if (item?.type === 'text' && item?.text?.value) deltaText += item.text.value;
          if (item?.type === 'output_text_delta' && item?.value) deltaText += item.value;
        }
      }
      if (deltaText) {
        saw.text = true;
        saw.deltaChars += deltaText.length;
        fullText += deltaText;
        send('delta', { value: deltaText });

        // primera delta: tiempo a primer chunk
        if (tFirstDelta == null) {
          tFirstDelta = Date.now();
          slog('stream.first_delta', {
            runId, threadId: tid,
            firstDeltaMs: tFirstDelta - t0,
          });
        }

        // DIAG: ¿apareció fence ya en delta?
        if (!saw.fenceSeenInDelta && fenceStartRx.test(deltaText)) {
          saw.fenceSeenInDelta = true;
          emitDiag('delta', {
            runId,
            fenceSeenInDelta: true,
            sample: deltaText.slice(0, 160),
          });
        }

        if (saw.deltaChars % 300 === 0) {
          slog('stream.delta.tick', { deltaChars: saw.deltaChars, runId, threadId: tid });
        }
      }
      return;
    }

    // ---- mensaje completado (texto adicional fuera de delta)
    if (type === 'thread.message.completed') {
      // aplanado de texto (ya lo tenías):
      const m = e?.data;
      let complete = '';
      try {
        const out: string[] = [];
        if (m?.content) {
          for (const c of m.content) {
            if (c?.type === 'text' && c?.text?.value) out.push(c.text.value);
          }
        }
        complete = out.join('\n');
      } catch {}
      if (complete) {
        saw.text = true;
        fullText += complete;

        // DIAG final: contar fences y generar huellas (con type guards)
        const fences = [...fullText.matchAll(allFencesRx)];
        const fenceCount = fences.length;

        const fenceTypes: string[] = fences
          .map((mm) => (mm?.[1] ?? '').trim())
          .filter((s): s is string => s.length > 0);

        const hashes: string[] = fences.map((mm) => {
          const raw = String(mm?.[0] ?? '');
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
          fenceSeenInDelta: saw.fenceSeenInDelta,
        });

        // Emitimos lo que ya usas
        send('final', { text: complete });

        // Extra: ¿mandó operaciones Kommo en el texto?
        const ops: any[] = (() => {
          const rxFence = /```\s*cv:kommo\s*([\s\S]*?)```/gi;
          const found: any[] = [];
          let m: RegExpExecArray | null;
          while ((m = rxFence.exec(complete))) {
            try {
              const j = JSON.parse((m[1] || '').trim());
              if (j && Array.isArray(j.ops)) found.push(...j.ops);
            } catch {}
          }
          return found;
        })();

        slog('message.completed', {
          fullLen: complete.length,
          kommoOps: ops.length,
          runId,
          threadId: tid,
        });
        if (ops.length) send('kommo', { ops });
      }
      return;
    }

    // ---- steps/tools (solo logs, NO cambiamos SSE)
    if (type === 'thread.run.step.delta' || type === 'thread.run.step.completed') {
      try {
        const d = e?.data;
        const details = d?.step_details || d?.delta?.step_details;
        let toolCalls = 0;
        let names: string[] = [];
        if (details?.type === 'tool_calls') {
          const list = details?.tool_calls ?? details?.delta?.tool_calls ?? [];
          toolCalls = Array.isArray(list) ? list.length : 0;
          names = (Array.isArray(list) ? list : [])
            .map((tc: any) => (tc?.function?.name ?? '').toString().trim())
            .filter((s: string): s is string => s.length > 0);
        }
        slog(type === 'thread.run.step.delta' ? 'run.step.delta' : 'run.step.completed', {
          runId, threadId: tid, toolCalls, names,
        });
      } catch {}
      return;
    }

    // ---- requires_action / cancel / otros (solo logs)
    if (type === 'thread.run.requires_action' || type === 'thread.run.cancelling' || type === 'thread.run.cancelled') {
      slog('run.state', { type, runId, threadId: tid });
      return;
    }

    // ---- error del stream
    if (type === 'error') {
      slog('stream.error', { runId, threadId: tid, error: String(e?.data || 'unknown') });
      send('error', { error: String(e?.data || 'unknown') });
      return;
    }

    // Cualquier otro evento que no hayamos clasificado (solo diagnóstico)
    try {
      slog('stream.event.other', { type, runId, threadId: tid });
    } catch {}
  });

  await new Promise<void>((resolve) => {
    stream.on('end', () => {
      slog('stream.end', {
        deltaChars: saw.deltaChars,
        sawText: saw.text,
        runId,
        threadId: tid,
      });
      // tiempos
      slog('stream.timing', {
        runId, threadId: tid,
        firstDeltaMs: tFirstDelta == null ? null : (tFirstDelta - t0),
        totalMs: Date.now() - t0,
      });
      // cerrar SSE del caller
      try { send('done', { ok: true }); } catch {}
      resolve();
    });
    stream.on('error', (err: any) => {
      slog('exception.stream', { runId, threadId: tid, error: String(err?.message || err) });
      try { send('error', { error: String(err?.message || err) }); } catch {}
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
