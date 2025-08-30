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
  } catch {
    console.log('[CV][server]', event, meta);
  }
}

async function appendUserMessageWithMinimalRetry(threadId: string, userText: string, traceId: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      jlog('message.append.start', { attempt }, traceId);
      await client.beta.threads.messages.create(threadId, { role: 'user', content: userText });
      jlog('message.append.ok', { attempt }, traceId);
      return;
    } catch (e: any) {
      const msg = e?.message || String(e);
      jlog('message.append.err', { attempt, error: msg }, traceId);
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

        // @ts-ignore (stream events)
        const runStream: any = await client.beta.threads.runs.stream(threadId!, {
          assistant_id: ASSISTANT_ID,
          metadata: { channel: 'web-embed' },
        });

        let lastTokenAt = now();
        let firstDeltaMs: number | null = null;
        let deltaCount = 0;

        const watchdog = setInterval(() => {
          const idle = now() - lastTokenAt;
          if (idle > IDLE_FALLBACK_MS) {
            jlog('idle.fallback', { idleMs: idle, deltaCount }, traceId);
            clearInterval(watchdog);
            try { runStream.close(); } catch {}
            try { send('done', { ms: now() - t0, first_delta_ms: firstDeltaMs, idleFallback: true, deltaCount }); } catch {}
            try { controller.close(); } catch {}
          }
        }, 3000);

        runStream
          .on('textCreated', () => {
            jlog('stream.textCreated', {}, traceId);
          })
          .on('textDelta', (d: any) => {
            deltaCount++;
            if (firstDeltaMs == null) firstDeltaMs = now() - t0;
            lastTokenAt = now();
            const value = d?.value || '';
            // No loggear cada token para no saturar, solo cada 60
            if (deltaCount % 60 === 0) {
              jlog('stream.delta.tick', { deltaCount, firstDeltaMs }, traceId);
            }
            send('delta', { value });
          })
          .on('messageCompleted', (m: any) => {
            jlog('stream.messageCompleted', { role: m?.role, contentLen: JSON.stringify(m?.content || '').length }, traceId);
          })
          .on('error', (err: any) => {
            jlog('stream.error', { error: String(err?.message || err) }, traceId);
            send('error', { message: String(err?.message || err) });
          })
          .on('end', async () => {
            try {
              const msgs = await client.beta.threads.messages.list(threadId!, { order: 'desc', limit: 12 });
              let finalText = '';
              for (const m of msgs.data) {
                if (m.role !== 'assistant') continue;
                for (const c of m.content) {
                  if (c.type === 'text') finalText += (c.text?.value || '') + '\n';
                }
                if (finalText.trim()) break;
              }
              finalText = finalText.trim();
              jlog('stream.end', { deltaCount, firstDeltaMs, finalLen: finalText.length }, traceId);
              send('final', { text: finalText });
            } catch (e: any) {
              jlog('final.fetch.err', { error: String(e?.message || e) }, traceId);
              send('error', { message: String(e?.message || e) });
            } finally {
              clearInterval(watchdog);
              send('done', { ms: now() - t0, first_delta_ms: firstDeltaMs, idleFallback: false, deltaCount });
              try { controller.close(); } catch {}
              jlog('request.out', { totalMs: now() - t0 }, traceId);
            }
          });
      } catch (err: any) {
        jlog('exception', { error: String(err?.message || err) }, traceId);
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
