
import { NextRequest } from 'next/server';
import OpenAI from 'openai';

export const runtime = 'edge';

// --- Util: logging wrapper (shows nicely in Vercel) ---
function log(event: string, meta: Record<string, any> = {}) {
  try {
    // Using console.info to keep a single level in Vercel logs
    console.info(`[CV][api] ${event}`, meta);
  } catch {}
}

// --- Util: send SSE frame ---
function sseFrame(event: string, data: any) {
  const payload = typeof data === 'string' ? data : JSON.stringify(data);
  return `event: ${event}\n` + `data: ${payload}\n\n`;
}

// --- Kommo fence extraction (optional server hint) ---
function extractKommoOps(text: string): any[] {
  if (!text) return [];
  const out: any[] = [];
  const fence = /```\\s*cv:kommo\\s*([\\s\\S]*?)```/gi;
  let m: RegExpExecArray | null;
  while ((m = fence.exec(text))) {
    const raw = (m[1] || '').trim();
    try {
      const json = JSON.parse(raw);
      if (json && Array.isArray(json.ops)) {
        out.push(...json.ops);
      }
    } catch {}
  }
  return out;
}

export async function POST(req: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start: async (controller) => {
      const write = (event: string, data: any) => {
        controller.enqueue(encoder.encode(sseFrame(event, data)));
      };

      try {
        const body = await req.json().catch(() => ({}));
        const { message, threadId } = body || {};

        const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || '' });

        // Ensure thread
        let tId = threadId as string | null;
        if (!tId) {
          const t = await client.beta.threads.create({});
          tId = t.id;
        }
        log('thread', { threadId: tId });
        write('meta', { threadId: tId });

        // Add user message (text-only)
        let userText = '';
        if (message?.parts?.[0]?.text) userText = String(message.parts[0].text);
        else if (typeof message === 'string') userText = message;
        await client.beta.threads.messages.create(tId!, {
          role: 'user',
          content: userText || '',
        });
        log('user.message.created', { len: (userText || '').length });

        // Start streamed run
        const runStream: any = await client.beta.threads.runs.stream(tId!, {
          assistant_id: process.env.OPENAI_ASSISTANT_ID || '',
          // You can add additional_instructions or tool_choice if needed
        });

        // --- Attach event listeners ---
        runStream
          .on('run.created', (ev: any) => log('run.created', { id: ev?.data?.id }))
          .on('run.queued', () => log('run.queued'))
          .on('run.in_progress', () => log('run.in_progress'))
          .on('run.completed', () => log('run.completed'))
          .on('run.failed', (ev: any) => log('run.failed', { error: ev?.data?.last_error }))
          .on('run.step.created', (ev: any) => log('run.step.created', { id: ev?.data?.id }))
          .on('run.step.in_progress', (ev: any) => log('run.step.in_progress', { id: ev?.data?.id }))
          .on('run.step.completed', (ev: any) => log('run.step.completed', { id: ev?.data?.id, type: ev?.data?.type }))
          .on('run.step.failed', (ev: any) => log('run.step.failed', { id: ev?.data?.id }))
          .on('message.delta', (ev: any) => {
            // Stream textual deltas to UI
            try {
              const parts = ev?.data?.delta?.content || [];
              let acc = '';
              for (const p of parts) {
                if (p?.type === 'output_text.delta' && typeof p?.text === 'string') {
                  acc += p.text;
                }
              }
              log('messageDelta', { len: acc.length });
              if (acc.length) write('delta', { value: acc });
              else write('delta', { len: 0 });
            } catch (err) {
              log('message.delta.parse.error', { err: String(err) });
            }
          })
          .on('message.completed', (ev: any) => {
            // Send final full text
            try {
              let text = '';
              const content = ev?.data?.content || [];
              for (const c of content) {
                if (c?.type === 'output_text' && c?.text?.value) text += c.text.value;
              }
              log('message.completed', { len: text.length });

              // Optional: server-side Kommo hint
              const ops = extractKommoOps(text);
              if (ops.length) {
                write('kommo', { ops });
              }

              write('final', { text });
            } catch (err) {
              log('message.completed.parse.error', { err: String(err) });
            }
          })
          .on('end', () => {
            log('stream.end');
            // Ensure client turns off "pensando"
            write('done', { ok: true });
            controller.close();
          })
          .on('error', (err: any) => {
            log('stream.error', { err: String(err?.message || err) });
            write('error', { message: String(err?.message || err) });
            controller.close();
          });

      } catch (err: any) {
        log('fatal', { err: String(err?.message || err) });
        try {
          controller.enqueue(encoder.encode(sseFrame('error', { message: String(err?.message || err) })));
          controller.enqueue(encoder.encode(sseFrame('done', { ok: false })));
        } catch {}
        controller.close();
      }
    },
    cancel() {
      log('stream.cancelled');
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
