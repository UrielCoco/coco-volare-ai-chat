import { NextRequest } from 'next/server';
import OpenAI from 'openai';

export const runtime = 'nodejs';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
const ASST_ID = process.env.OPENAI_ASSISTANT_ID!;

// ---- helpers ----
function sse(ctrl: ReadableStreamDefaultController, event: string, data: any) {
  ctrl.enqueue(`event: ${event}\n` + `data: ${JSON.stringify(data)}\n\n`);
}

function toTextFromMessage(msg: any): string {
  const parts = (msg?.content ?? [])
    .map((c: any) => {
      if (c.type === 'text' && c.text?.value) return c.text.value;
      if (c.type === 'output_text' && c.output_text?.content?.[0]?.text) {
        return c.output_text.content[0].text;
      }
      if (c.type === 'input_text' && c.input_text?.text) return c.input_text.text;
      return '';
    })
    .filter(Boolean);
  return parts.join('');
}

// ---- route ----
export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const wantStream = searchParams.get('stream') === '1';
  const debug = searchParams.get('debug') === '1';

  if (!wantStream) {
    return new Response(JSON.stringify({ error: 'stream=1 required' }), { status: 400 });
  }

  const body = await req.json();
  const userMsg = body?.message;
  let threadId: string | null = body?.threadId || null;

  const stream = new ReadableStream({
    start: async (controller) => {
      try {
        // 1) thread
        if (!threadId) {
          const t = await client.beta.threads.create({});
          threadId = t.id;
        }
        console.log('[CV][api] thread', threadId);
        sse(controller, 'meta', { threadId });

        // 2) user message
        await client.beta.threads.messages.create(threadId!, {
          role: 'user',
          content: userMsg?.parts?.[0]?.text ?? '',
        });

        // 3) run (STREAM)
        const runStream = await client.beta.threads.runs.stream(threadId!, {
          assistant_id: ASST_ID,
        });

        // ÚNICO listener: event aggregator (tipos seguros)
        runStream.on('event', (evt: any) => {
          const name: string = evt?.event || '';
          const data: any = evt?.data;
          if (debug) sse(controller, 'log', { event: name, id: data?.id });

          // deltas de texto (acepta message.delta o thread.message.delta)
          if (name.endsWith('message.delta') || name === 'message.delta') {
            try {
              const chunks =
                data?.delta?.content?.map((c: any) => c?.text?.value || '') ?? [];
              const text = chunks.join('');
              if (text) sse(controller, 'delta', { value: text });
            } catch (e) {
              console.log('[CV][api] delta.parse.error', e);
            }
            return;
          }

          // mensaje final (acepta message.completed o thread.message.completed)
          if (name.endsWith('message.completed') || name === 'message.completed') {
            try {
              const text = toTextFromMessage(data);
              if (text) {
                sse(controller, 'final', { text });

                // bonus: si dentro del texto viene ```cv:kommo{...}``` reemítelo por canal propio
                const m = text.match(/```cv:kommo([\s\S]*?)```/i);
                if (m) {
                  try {
                    const payload = JSON.parse(m[1]);
                    if (payload?.ops?.length) sse(controller, 'kommo', { ops: payload.ops });
                  } catch {}
                }
              }
            } catch (e) {
              console.log('[CV][api] final.parse.error', e);
            }
            return;
          }

          // fin de run
          if (name.endsWith('run.completed') || name === 'run.completed') {
            sse(controller, 'done', {});
            controller.close();
            return;
          }

          if (name.endsWith('run.failed') || name === 'run.failed') {
            const errMsg =
              data?.last_error?.message ||
              data?.last_error ||
              'run failed';
            console.log('[CV][api] run.failed', errMsg);
            sse(controller, 'error', { error: errMsg });
            controller.close();
            return;
          }
        });

        // Mantén la función viva hasta que termine el stream del SDK
        await runStream.done();
      } catch (err: any) {
        console.error('[CV][api] fatal', err);
        try { sse(controller, 'error', { error: String(err?.message || err) }); } catch {}
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
