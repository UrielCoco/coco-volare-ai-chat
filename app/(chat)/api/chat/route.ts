import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
const ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID!;

const now = () => Date.now();
const IDLE_FALLBACK_MS = 25_000;

async function appendUserMessageWithMinimalRetry(threadId: string, userText: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await client.beta.threads.messages.create(threadId, { role: 'user', content: userText });
      return;
    } catch (e: any) {
      const msg = e?.message || String(e);
      if (msg.includes('run is active') || msg.includes("Can't add messages")) {
        await new Promise((r) => setTimeout(r, 400 + attempt * 250));
        continue;
      }
      throw e;
    }
  }
  throw new Error('Thread ocupado: hay un run activo cerrando.');
}

async function handleStream(req: NextRequest) {
  const t0 = now();
  const body = await req.json().catch(() => ({}));
  const incoming = body?.message as { role: 'user' | 'assistant'; parts: { type: 'text'; text: string }[] } | undefined;
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
        controller.enqueue(`event: ${event}\n`);
        controller.enqueue(`data: ${JSON.stringify(data)}\n\n`);
      };

      try {
        if (!threadId) {
          const t = await client.beta.threads.create({ metadata: { channel: 'web-embed' } });
          threadId = t.id;
        }
        send('meta', { threadId });

        await appendUserMessageWithMinimalRetry(threadId!, userText);

        // Stream con Assistants — sin polling adicional
        // @ts-ignore
        const runStream: any = await client.beta.threads.runs.stream(threadId!, {
          assistant_id: ASSISTANT_ID,
          metadata: { channel: 'web-embed' },
        });

        let lastTokenAt = now();
        let firstDeltaMs: number | null = null;

        const watchdog = setInterval(() => {
          if (now() - lastTokenAt > IDLE_FALLBACK_MS) {
            clearInterval(watchdog);
            try { runStream.close(); } catch {}
            try { send('done', { ms: now() - t0, first_delta_ms: firstDeltaMs, idleFallback: true }); } catch {}
            try { controller.close(); } catch {}
          }
        }, 3000);

        runStream
          .on('textDelta', (d: any) => {
            lastTokenAt = now();
            if (firstDeltaMs == null) firstDeltaMs = now() - t0;
            send('delta', { value: d?.value || '' });
          })
          .on('error', (err: any) => {
            send('error', { message: String(err?.message || err) });
          })
          .on('end', async () => {
            try {
              const msgs = await client.beta.threads.messages.list(threadId!, { order: 'desc', limit: 12 });
              // Construye el texto final del último assistant
              let finalText = '';
              for (const m of msgs.data) {
                if (m.role !== 'assistant') continue;
                for (const c of m.content) {
                  if (c.type === 'text') finalText += (c.text?.value || '') + '\n';
                }
                if (finalText.trim()) break;
              }
              send('final', { text: (finalText || '').trim() });
            } catch (e: any) {
              send('error', { message: String(e?.message || e) });
            } finally {
              clearInterval(watchdog);
              send('done', { ms: now() - t0, first_delta_ms: firstDeltaMs, idleFallback: false });
              try { controller.close(); } catch {}
            }
          });
      } catch (err: any) {
        controller.enqueue(`event: error\ndata: ${JSON.stringify({ message: String(err?.message || err) })}\n\n`);
        controller.enqueue(`event: done\ndata: ${JSON.stringify({ ms: now() - t0 })}\n\n`);
        try { controller.close(); } catch {}
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

async function handleJson(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const incoming = body?.message as { role: 'user' | 'assistant'; parts: { type: 'text'; text: string }[] } | undefined;
  let threadId: string | undefined = body?.threadId;
  const userText = incoming?.parts?.[0]?.text?.trim() || '';

  if (!userText) return NextResponse.json({ ok: true, skipped: 'empty' });

  try {
    if (!threadId) {
      const t = await client.beta.threads.create({ metadata: { channel: 'web-embed' } });
      threadId = t.id;
    }
    await appendUserMessageWithMinimalRetry(threadId!, userText);

    const run = await client.beta.threads.runs.createAndPoll(threadId!, {
      assistant_id: ASSISTANT_ID,
      metadata: { channel: 'web-embed' },
    });

    const msgs = await client.beta.threads.messages.list(threadId!, { order: 'desc', limit: 12 });
    let reply = '';
    for (const m of msgs.data) {
      if (m.role !== 'assistant') continue;
      for (const c of m.content) {
        if (c.type === 'text') reply += (c.text?.value || '') + '\n';
      }
      if (reply.trim()) break;
    }

    return NextResponse.json({ threadId, reply: reply.trim(), runStatus: run?.status });
  } catch (err: any) {
    return NextResponse.json({ error: String(err?.message || err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (req.nextUrl.searchParams.get('stream') === '1') return handleStream(req);
  return handleJson(req);
}
