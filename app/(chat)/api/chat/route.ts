import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

/**
 * Coco Volare · Chat Stream (NO POLLING)
 * - Streaming SSE limpio, sin "pulling" ni pre-chequeos de runs.list()
 * - Un turno = 1 mensaje de usuario + 1 respuesta del asistente en UI
 * - Si el usuario pide itinerario y ya hay datos, el assistant responde SOLO con bloque JSON entre fences ```cv:itinerary
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
const ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID!;

// Timers (solo para watchdog de inactividad del stream; no hace llamadas al API)
const IDLE_FALLBACK_MS = 25_000;

// ===== Helpers (sin llamadas a OpenAI) =====
type UiPart = { type: 'text'; text: string };

const now = () => Date.now();
const rid = () => `cv_${Math.random().toString(36).slice(2, 8)}_${Date.now().toString(36)}`;

function jlog(event: string, meta: any = {}) {
  try { console.log(JSON.stringify({ tag: '[CV][server]', event, ...meta })); } catch { console.log('[CV][server]', event, meta); }
}

function askedForItinerary(s: string) {
  return /\b(itinerar(?:io|y)|itinerary|cv:itinerary|dame\s+.*itinerario|itinerario\s+detallado)\b/i.test(s || '');
}
function isConfirmation(s: string) {
  return /\b(s[ií]|va|ok|okay|de acuerdo|perfecto|claro|hazlo|adelante|proced[e|e]|ármalo|haz el itinerario)\b/i.test(s || '');
}
function extractAssistantText(list: any[]): string {
  // Une texto de los mensajes del assistant (arriba-abajo)
  for (const m of list) {
    if (m.role !== 'assistant') continue;
    let txt = '';
    for (const c of m.content) if (c.type === 'text') txt += (c.text?.value || '') + '\n';
    txt = txt.trim();
    if (txt) return txt;
  }
  return '';
}

async function appendUserMessageWithMinimalRetry(threadId: string, userText: string) {
  // Evita hacer runs.list(); solo reintenta si el error indica run activo.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await client.beta.threads.messages.create(threadId, { role: 'user', content: userText });
      return;
    } catch (e: any) {
      const msg = e?.message || String(e);
      if (msg.includes("Can't add messages") || msg.includes('run is active')) {
        await new Promise((r) => setTimeout(r, 350 + attempt * 200));
        continue;
      }
      throw e;
    }
  }
  // Si de plano no pudimos en 3 intentos, avisamos hacia arriba:
  throw new Error("Busy thread: an active run is still closing");
}

/* =========================
   SSE (stream=1)
   ========================= */
async function handleStream(req: NextRequest) {
  const t0 = now();
  const traceId = rid();

  const body = await req.json().catch(() => ({}));
  const incoming = body?.message as { role: 'user' | 'assistant'; parts: UiPart[] } | undefined;
  let threadId: string | undefined = body?.threadId;
  const userText = incoming?.parts?.[0]?.text?.trim() || '';

  if (!userText) {
    return new Response('event: error\ndata: {"message":"empty message"}\n\n', {
      headers: { 'Content-Type': 'text/event-stream', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' },
    });
  }

  const stream = new ReadableStream({
    start: async (controller) => {
      const send = (event: string, data: any) => {
        try {
          controller.enqueue(`event: ${event}\n`);
          controller.enqueue(`data: ${JSON.stringify(data)}\n\n`);
        } catch {}
      };
      const keepAlive = () => {
        try { controller.enqueue(`event: ping\ndata: {}\n\n`); } catch {}
      };

      try {
        // Asegura thread
        if (!threadId) {
          const t = await client.beta.threads.create({ metadata: { channel: 'web-embed' } });
          threadId = t.id;
        }
        send('meta', { threadId });
        jlog('thread.ready', { traceId, threadId });

        // Agrega mensaje de usuario, sin runs.list()
        await appendUserMessageWithMinimalRetry(threadId!, userText);
        jlog('message.appended', { traceId });

        // Decide si sugerir al assistant el bloque de itinerario
        const forceItin = askedForItinerary(userText) || isConfirmation(userText);
        const instructions = forceItin
          ? [
              'Si el usuario pide el itinerario explícitamente y ya hay datos suficientes, responde EXCLUSIVAMENTE con:',
              '```cv:itinerary',
              '{ JSON válido y completo según el esquema del sistema }',
              '```',
              'Si aún faltan datos, pregunta puntualmente y conversa normal.',
            ].join('\n')
          : undefined;

        // Stream OpenAI Assistants (sin polling manual)
        // @ts-ignore
        const runStream: any = await client.beta.threads.runs.stream(threadId!, {
          assistant_id: ASSISTANT_ID,
          instructions,
          metadata: { channel: 'web-embed' },
        });

        let lastTokenAt = now();
        let firstDeltaMs: number | null = null;

        const watchdog = setInterval(() => {
          if (now() - lastTokenAt > IDLE_FALLBACK_MS) {
            jlog('idle.fallback', { traceId, idle_ms: now() - lastTokenAt });
            clearInterval(watchdog);
            try { runStream.close(); } catch {}
            try { send('done', { ms: now() - t0, first_delta_ms: firstDeltaMs, idleFallback: true }); } catch {}
            try { controller.close(); } catch {}
          }
        }, 3_000);

        runStream
          .on('textCreated', () => {})
          .on('textDelta', (d: any) => {
            lastTokenAt = now();
            if (firstDeltaMs == null) firstDeltaMs = now() - t0;
            send('delta', { value: d?.value || '' });
          })
          .on('messageCompleted', () => { /* no-op */ })
          .on('error', (err: any) => {
            jlog('stream.error', { traceId, err: String(err?.message || err) });
            send('error', { message: String(err?.message || err) });
          })
          .on('end', async () => {
            try {
              const msgs = await client.beta.threads.messages.list(threadId!, { order: 'desc', limit: 12 });
              const finalText = extractAssistantText(msgs.data);
              send('final', { text: finalText });
            } catch (e: any) {
              send('error', { message: String(e?.message || e) });
            } finally {
              clearInterval(watchdog);
              send('done', { ms: now() - t0, first_delta_ms: firstDeltaMs, idleFallback: false });
              try { controller.close(); } catch {}
            }
          });
      } catch (err: any) {
        jlog('exception', { err: String(err?.message || err) });
        try { controller.enqueue(`event: error\ndata: ${JSON.stringify({ message: String(err?.message || err) })}\n\n`); } catch {}
        try { controller.enqueue(`event: done\ndata: ${JSON.stringify({ ms: now() - t0, first_delta_ms: null, idleFallback: false })}\n\n`); } catch {}
        try { controller.close(); } catch {}
      }
    },
    cancel() {},
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

/* =========================
   JSON (fallback no-stream)
   ========================= */
async function handleJson(req: NextRequest) {
  const t0 = now();
  const body = await req.json().catch(() => ({}));
  const incoming = body?.message as { role: 'user' | 'assistant'; parts: UiPart[] } | undefined;
  let threadId: string | undefined = body?.threadId;
  const userText = incoming?.parts?.[0]?.text?.trim() || '';

  if (!userText) return NextResponse.json({ ok: true, skipped: 'empty' }, { status: 200 });

  try {
    if (!threadId) {
      const t = await client.beta.threads.create({ metadata: { channel: 'web-embed' } });
      threadId = t.id;
    }

    await appendUserMessageWithMinimalRetry(threadId!, userText);

    const forceItin = askedForItinerary(userText) || isConfirmation(userText);
    const instructions = forceItin
      ? [
          'Si el usuario pide el itinerario explícitamente y ya hay datos suficientes, responde EXCLUSIVAMENTE con:',
          '```cv:itinerary',
          '{ JSON válido y completo según el esquema del sistema }',
          '```',
          'Si aún faltan datos, pregunta puntualmente y conversa normal.',
        ].join('\n')
      : undefined;

    // create-and-poll del SDK (sí, hace polling interno SOLO aquí si alguien llama al fallback)
    const run = await client.beta.threads.runs.createAndPoll(threadId!, {
      assistant_id: ASSISTANT_ID,
      instructions,
      metadata: { channel: 'web-embed' },
    });

    const msgs = await client.beta.threads.messages.list(threadId!, { order: 'desc', limit: 12 });
    const reply = extractAssistantText(msgs.data);

    jlog('json.end', {
      ms: now() - t0,
      size: reply.length,
      preview: reply.slice(0, 160),
      status: run?.status,
    });
    return NextResponse.json({ threadId, reply, runStatus: run?.status });
  } catch (err: any) {
    jlog('exception', { err: String(err?.message || err) });
    return NextResponse.json({ error: String(err?.message || err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (req.nextUrl.searchParams.get('stream') === '1') return handleStream(req);
  return handleJson(req);
}
