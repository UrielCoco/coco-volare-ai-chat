// app/(chat)/api/chat/route.ts
import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
const ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID!;

const IDLE_FALLBACK_MS = 25_000;
const now = () => Date.now();
const rid = () => `cv_${Math.random().toString(36).slice(2, 8)}_${Date.now().toString(36)}`;

function jlog(event: string, meta: any = {}, traceId?: string) {
  try {
    console.log(JSON.stringify({ tag: '[CV][server]', event, traceId, ...meta }));
  } catch {}
}

// ---------- UTIL: append con reintento breve ----------
async function appendUserMessageWithMinimalRetry(threadId: string, userText: string, traceId: string) {
  try {
    await client.beta.threads.messages.create(threadId, { role: 'user', content: userText });
    jlog('message.append.ok', {}, traceId);
  } catch (e: any) {
    jlog('message.append.retry', { error: e?.message }, traceId);
    await new Promise((r) => setTimeout(r, 250));
    await client.beta.threads.messages.create(threadId, { role: 'user', content: userText });
    jlog('message.append.ok.retry', {}, traceId);
  }
}

// ---------- Tool: emit_itinerary (schema) ----------
const itineraryParameters = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    days: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          day: { type: 'integer' },
          date: { type: 'string' },
          meals: {
            type: 'object',
            properties: {
              breakfast: { type: 'string' },
              lunch: { type: 'string' },
              dinner: { type: 'string' }
            }
          },
          activities: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                time: { type: 'string' },
                title: { type: 'string' },
                location: { type: 'string' },
                notes: { type: 'string' }
              },
              required: ['time', 'title']
            }
          },
          hotelPickup: { type: 'boolean' },
          hotelDropoff: { type: 'boolean' }
        },
        required: ['day', 'activities']
      }
    },
    currency: { type: 'string' },
    notes: { type: 'string' }
  },
  required: ['title', 'days']
} as const;

// ---------- STREAM ----------
async function handleStream(req: NextRequest) {
  const traceId = rid();
  const t0 = now();

  const body = await req.json().catch(() => ({}));
  const incoming = body?.message as { role: 'user' | 'assistant'; parts: { type: 'text'; text: string }[] } | undefined;
  let threadId: string | undefined = body?.threadId;
  const userText = incoming?.parts?.[0]?.text?.trim() || '';

  jlog('request.in', { hasThreadId: Boolean(threadId), userTextLen: userText.length }, traceId);

  if (!userText) {
    jlog('request.empty', {}, traceId);
    return new Response('event: error\ndata: {"message":"empty message"}\n\n', {
      headers: { 'Content-Type': 'text/event-stream', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' },
    });
  }

  const stream = new ReadableStream({
    start: async (controller) => {
      const send = (event: string, data: any) => {
        controller.enqueue(`event: ${event}\n`);
        controller.enqueue(`data: ${JSON.stringify(data)}\n\n`);
      };

      try {
        if (!threadId) {
          const t = await client.beta.threads.create({ metadata: { channel: 'web-embed' } });
          threadId = t.id;
          jlog('thread.created', { threadId }, traceId);
        } else {
          jlog('thread.reuse', { threadId }, traceId);
        }

        send('meta', { threadId });

        await appendUserMessageWithMinimalRetry(threadId!, userText, traceId);

        // Create+Stream el run (SDK v4) — event emitter
        // @ts-ignore tipos del stream varían por versión del SDK
        const runStream: any = await client.beta.threads.runs.stream(threadId!, {
          assistant_id: ASSISTANT_ID,
          metadata: { channel: 'web-embed' },
          tools: [
            {
              type: 'function',
              function: {
                name: 'emit_itinerary',
                description: 'Emite un itinerario estructurado para renderizar tarjeta en el front.',
                parameters: itineraryParameters
              }
            }
          ]
        });

        // >>> Intentamos obtener el runId para poder cancelar desde el front
        (async () => {
          try {
            // poll cortito hasta ver el run activo más reciente
            const tStart = Date.now();
            let announced = false;
            while (!announced && Date.now() - tStart < 4000) {
              const list = await client.beta.threads.runs.list(threadId!, { order: 'desc', limit: 3 });
              const active = list.data.find(r => ['queued','in_progress','requires_action','cancelling'].includes(String(r.status)));
              if (active) {
                send('run', { runId: active.id });
                announced = true;
                break;
              }
              await new Promise(r => setTimeout(r, 200));
            }
          } catch {}
        })();

        let lastTokenAt = now();
        let firstDeltaMs: number | null = null;
        let deltaCount = 0;
        let hadDelta = false;

        // Watchdog: si el stream “se queda mudo”, hacemos fallback
        const watchdog = setInterval(async () => {
          const gap = now() - lastTokenAt;
          if (gap > IDLE_FALLBACK_MS) {
            clearInterval(watchdog);
            jlog('stream.idle', { gap }, traceId);
            try { runStream.close(); } catch {}
            // Fallback: traer último mensaje del asistente
            try {
              const msgs = await client.beta.threads.messages.list(threadId!, { order: 'desc', limit: 12 });
              let finalText = '';
              for (const m of msgs.data) {
                if (m.role !== 'assistant') continue;
                for (const c of m.content) if (c.type === 'text') finalText += (c.text?.value || '') + '\n';
                if (finalText.trim()) break;
              }
              finalText = finalText.trim();
              send('final', { text: finalText, idleFallback: true });
            } catch (e: any) {
              send('error', { message: e?.message || 'idle fallback error' });
            }
            try { send('done', { ms: now() - t0, first_delta_ms: firstDeltaMs, deltaCount }); } catch {}
            try { controller.close(); } catch {}
          }
        }, 3000);

        runStream
          .on('textCreated', () => {
            jlog('stream.textCreated', {}, traceId);
          })
          .on('textDelta', (d: any) => {
            hadDelta = true;
            deltaCount++;
            if (firstDeltaMs == null) firstDeltaMs = now() - t0;
            lastTokenAt = now();
            const value = d?.value || '';
            if (deltaCount % 60 === 0) {
              jlog('stream.delta.tick', { deltaCount, firstDeltaMs }, traceId);
            }
            send('delta', { value });
          })
          .on('messageCompleted', (m: any) => {
            jlog('stream.messageCompleted', { role: m?.role, contentLen: JSON.stringify(m?.content || '').length }, traceId);
          })
          // Tool-calls (itinerario)
          .on('toolCallCreated', (ev: any) => {
            // opcional: puedes loggear
          })
          .on('toolCallDelta', async (ev: any) => {
            // si quisieras streamear args, aquí
          })
          .on('toolCallCompleted', async (ev: any) => {
            try {
              if (ev?.toolCall?.function?.name === 'emit_itinerary') {
                const argsRaw = ev.toolCall.function.arguments ?? '{}';
                const data = JSON.parse(argsRaw);
                if (data?.title && Array.isArray(data?.days)) {
                  send('itinerary', { payload: data });
                }
              }
            } catch {}
          })
          .on('error', (err: any) => {
            jlog('stream.error', { error: String(err?.message || err) }, traceId);
            send('error', { message: String(err?.message || err) });
          })
          .on('end', async () => {
            try {
              clearInterval(watchdog);
            } catch {}
            try {
              // Si no hubo deltas, hacemos fallback a messages.list (para no dejar colgado)
              if (!hadDelta) {
                const msgs = await client.beta.threads.messages.list(threadId!, { order: 'desc', limit: 12 });
                let finalText = '';
                for (const m of msgs.data) {
                  if (m.role !== 'assistant') continue;
                  for (const c of m.content) if (c.type === 'text') finalText += (c.text?.value || '') + '\n';
                  if (finalText.trim()) break;
                }
                finalText = finalText.trim();
                jlog('stream.end.nodeltas', { finalLen: finalText.length }, traceId);
                send('final', { text: finalText, nodeltas: true });
              } else {
                // caso normal: el front ya juntó los deltas
                send('final', { ok: true });
              }
            } catch (e: any) {
              send('error', { message: e?.message || 'finalize error' });
            } finally {
              send('done', { ms: now() - t0, first_delta_ms: firstDeltaMs, deltaCount });
              controller.close();
            }
          });

      } catch (err: any) {
        jlog('exception.stream', { error: String(err?.message || err) }, traceId);
        controller.enqueue(`event: error\ndata: ${JSON.stringify({ message: String(err?.message || err) })}\n\n`);
        controller.enqueue(`event: done\ndata: ${JSON.stringify({ ms: now() - t0, error: true })}\n\n`);
        controller.close();
      }
    }
  });

  return new NextResponse(stream as any, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

// ---------- JSON (por si alguien llama sin streaming) ----------
async function handleJson(req: NextRequest) {
  const traceId = rid();
  const t0 = now();
  const body = await req.json().catch(() => ({}));
  const incoming = body?.message as { role: 'user' | 'assistant'; parts: { type: 'text'; text: string }[] } | undefined;
  let threadId: string | undefined = body?.threadId;
  const userText = incoming?.parts?.[0]?.text?.trim() || '';

  jlog('request.in.json', { hasThreadId: Boolean(threadId), userTextLen: userText.length }, traceId);

  if (!userText) return NextResponse.json({ ok: true, skipped: 'empty' });

  try {
    if (!threadId) {
      const t = await client.beta.threads.create({ metadata: { channel: 'web-embed' } });
      threadId = t.id;
      jlog('thread.created', { threadId }, traceId);
    } else {
      jlog('thread.reuse', { threadId }, traceId);
    }

    await appendUserMessageWithMinimalRetry(threadId!, userText, traceId);

    // create & poll
    const run = await client.beta.threads.runs.createAndPoll(threadId!, {
      assistant_id: ASSISTANT_ID,
      metadata: { channel: 'web-embed' },
      tools: [
        {
          type: 'function',
          function: { name: 'emit_itinerary', description: 'Itinerary', parameters: itineraryParameters }
        }
      ]
    });

    const msgs = await client.beta.threads.messages.list(threadId!, { order: 'desc', limit: 12 });
    let reply = '';
    for (const m of msgs.data) {
      if (m.role !== 'assistant') continue;
      for (const c of m.content) if (c.type === 'text') reply += (c.text?.value || '') + '\n';
      if (reply.trim()) break;
    }
    reply = reply.trim();

    jlog('json.out', { status: run?.status, finalLen: reply.length, ms: now() - t0 }, traceId);
    return NextResponse.json({ threadId, reply, runStatus: run?.status });
  } catch (err: any) {
    jlog('exception.json', { error: String(err?.message || err) }, traceId);
    return NextResponse.json({ error: String(err?.message || err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (req.nextUrl.searchParams.get('stream') === '1') return handleStream(req);
  return handleJson(req);
}
