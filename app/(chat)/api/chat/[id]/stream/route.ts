// app/(chat)/api/chat/[tid]/stream/route.ts
import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
const ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID!;
const IDLE_FALLBACK_MS = 25_000;

const enc = (s: string) => new TextEncoder().encode(s);

// Esquema mínimo para la tool del itinerario (si la usas)
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
          activities: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                time: { type: 'string' },
                title: { type: 'string' },
                location: { type: 'string' },
                notes: { type: 'string' },
              },
              required: ['time', 'title']
            }
          },
          meals: {
            type: 'object',
            properties: {
              breakfast: { type: 'string' },
              lunch: { type: 'string' },
              dinner: { type: 'string' }
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

export async function POST(req: NextRequest, ctx: { params: { tid: string } }) {
  const threadId = ctx?.params?.tid;
  const body = await req.json().catch(() => ({}));
  const userText: string = body?.message?.parts?.[0]?.text?.trim() || '';

  if (!threadId || !userText) {
    return new NextResponse('event: error\ndata: {"message":"threadId y userText requeridos"}\n\n', {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  }

  const stream = new ReadableStream({
    start: async (controller) => {
      const send = (event: string, data: any) => {
        controller.enqueue(enc(`event: ${event}\n`));
        controller.enqueue(enc(`data: ${JSON.stringify(data)}\n\n`));
      };

      let hadDelta = false;
      let firstDeltaAt: number | null = null;
      let deltaCount = 0;
      const t0 = Date.now();

      try {
        // 1) Append del usuario (posicional)
        await client.beta.threads.messages.create(threadId, {
          role: 'user',
          content: userText,
        });

        // 2) Crear run (posicional). ¡Ojo! nada de run.reply / run.threadId
        const run = await client.beta.threads.runs.create(threadId, {
          assistant_id: ASSISTANT_ID,
          metadata: { channel: 'web-embed' },
          tools: [
            {
              type: 'function',
              function: {
                name: 'emit_itinerary',
                description: 'Emite itinerario estructurado para tarjeta.',
                parameters: itineraryParameters
              }
            }
          ]
        });

        // Dile al front el runId para poder cancelar
        send('run', { runId: run.id });

        // 3) Stream del run (posicional)
        // @ts-ignore: el tipo exacto del stream varía un poco entre versiones
        const emitter: any = await client.beta.threads.runs.stream(threadId, run.id, {
          onRunCreated: (_ev: any) => send('meta', { threadId }),
          onRunQueued: (_ev: any) => send('meta', { queued: true }),
          onRunInProgress: (_ev: any) => send('meta', { inProgress: true }),
          onRunCompleted: (_ev: any) => send('meta', { completed: true }),
          onRunCancelled: (_ev: any) => send('meta', { cancelled: true }),
          onRunFailed: (ev: any) => send('error', { message: ev?.error?.message || 'run failed' }),

          onTextCreated: (_ev: any) => {},

          onMessageDelta: (ev: any) => {
            const value = ev?.delta?.content?.[0]?.text?.value;
            if (!value) return;
            hadDelta = true;
            if (firstDeltaAt == null) firstDeltaAt = Date.now();
            deltaCount++;
            send('delta', { value });
          },

          onMessageCompleted: (_m: any) => {},

          // Tool-calls → responder con submitToolOutputs (posicional)
          onRunRequiresAction: async (ev: any) => {
            const toolCalls = ev?.required_action?.submit_tool_outputs?.tool_calls || [];
            const outs: { tool_call_id: string; output: string }[] = [];

            for (const call of toolCalls) {
              if (call.function?.name === 'emit_itinerary') {
                try {
                  const args = JSON.parse(call.function.arguments || '{}');
                  if (args?.title && Array.isArray(args?.days)) {
                    send('itinerary', { payload: args });
                    outs.push({ tool_call_id: call.id!, output: JSON.stringify({ ok: true }) });
                  } else {
                    outs.push({ tool_call_id: call.id!, output: JSON.stringify({ ok: false, error: 'schema error' }) });
                  }
                } catch (e: any) {
                  outs.push({ tool_call_id: call.id!, output: JSON.stringify({ ok: false, error: e?.message || 'parse' }) });
                }
              } else {
                outs.push({ tool_call_id: call.id!, output: JSON.stringify({ ok: false, error: 'tool not supported' }) });
              }
            }

            await (client.beta.threads.runs as any).submitToolOutputs(threadId, run.id, {
              tool_outputs: outs as any
            });
          },
        });

        // Watchdog: si se queda mudo, fallback a messages.list
        let lastTick = Date.now();
        const watchdog = setInterval(async () => {
          if (Date.now() - lastTick > IDLE_FALLBACK_MS) {
            clearInterval(watchdog);
            try { emitter.close(); } catch {}
            const msgs = await client.beta.threads.messages.list(threadId, { order: 'desc', limit: 12 });
            let finalText = '';
            for (const m of msgs.data) {
              if (m.role !== 'assistant') continue;
              for (const c of m.content) if (c.type === 'text') finalText += (c.text?.value || '') + '\n';
              if (finalText.trim()) break;
            }
            send('final', { text: finalText.trim(), idleFallback: true });
            send('done', {
              ms: Date.now() - t0,
              first_delta_ms: firstDeltaAt ? firstDeltaAt - t0 : null,
              deltaCount
            });
            controller.close();
          }
        }, 3000);

        emitter
          .on('textDelta', (d: any) => {
            lastTick = Date.now();
            const value = d?.value || '';
            if (value) {
              hadDelta = true;
              if (firstDeltaAt == null) firstDeltaAt = Date.now();
              deltaCount++;
              send('delta', { value });
            }
          })
          .on('end', async () => {
            clearInterval(watchdog);
            if (!hadDelta) {
              const msgs = await client.beta.threads.messages.list(threadId, { order: 'desc', limit: 12 });
              let finalText = '';
              for (const m of msgs.data) {
                if (m.role !== 'assistant') continue;
                for (const c of m.content) if (c.type === 'text') finalText += (c.text?.value || '') + '\n';
                if (finalText.trim()) break;
              }
              send('final', { text: finalText.trim(), nodeltas: true });
            } else {
              send('final', { ok: true });
            }
            send('done', {
              ms: Date.now() - t0,
              first_delta_ms: firstDeltaAt ? firstDeltaAt - t0 : null,
              deltaCount
            });
            controller.close();
          })
          .on('error', (err: any) => {
            clearInterval(watchdog);
            send('error', { message: String(err?.message || err) });
            send('done', { ms: Date.now() - t0, error: true });
            controller.close();
          });

        for await (const _ of emitter) { /* noop */ }
      } catch (err: any) {
        controller.enqueue(enc(`event: error\n`));
        controller.enqueue(enc(`data: ${JSON.stringify({ message: err?.message || 'stream error' })}\n\n`));
        controller.enqueue(enc(`event: done\n`));
        controller.enqueue(enc(`data: ${JSON.stringify({ error: true })}\n\n`));
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
