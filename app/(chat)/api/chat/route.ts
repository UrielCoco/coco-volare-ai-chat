/* eslint-disable no-console */
import OpenAI from 'openai';

export const runtime = 'nodejs'; // en Vercel, usa Node runtime para SSE estables

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
const ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID!;

function log(event: string, meta: any = {}) {
  try {
    // usa console.info para que se vea en Vercel Logs (nivel info)
    console.info(`[CV][api] ${event}`, meta);
  } catch {}
}

function sseChunk(event: string, data?: unknown) {
  const payload = data === undefined ? '' : `data: ${JSON.stringify(data)}\n`;
  return `event: ${event}\n${payload}\n`;
}

async function* streamRun({ threadId }: { threadId: string }) {
  // El SDK devuelve un objeto de stream (EventEmitter + AsyncIterable).
  // Lo tipamos como any para evitar los errores TS de unions.
  const stream: any = await client.beta.threads.runs.stream(threadId, {
    assistant_id: ASSISTANT_ID,
  });

  // Notifica el threadId al cliente apenas abrimos el stream
  yield sseChunk('meta', { threadId });

  let accForMessage = '';

  const flushFinal = () => {
    if (!accForMessage) return '';
    const out = sseChunk('final', { text: accForMessage });
    log('final.flush', { len: accForMessage.length });
    accForMessage = '';
    return out;
  };

  // logging no intrusivo
  stream.on('event', (e: any) => {
    if (e?.event === 'message.delta') {
      const parts: any[] = e?.data?.delta?.content ?? [];
      const txt = parts
        .filter((p) => p?.type === 'output_text' || p?.type === 'text')
        .map((p) => p?.text?.value || '')
        .join('');
      log('messageDelta', { len: txt.length });
    } else {
      // no satures logs: solo nombre del evento
      log(String(e?.event || 'unknown'));
    }
  });

  try {
    for await (const e of stream as AsyncIterable<any>) {
      const ev = e?.event as string;

      if (ev === 'message.created') {
        // empezará un nuevo mensaje del assistant
        accForMessage = '';
      }

      if (ev === 'message.delta') {
        const parts: any[] = e?.data?.delta?.content ?? [];
        const chunk =
          parts
            ?.filter((p) => p?.type === 'output_text' || p?.type === 'text')
            ?.map((p) => p?.text?.value || '')
            ?.join('') || '';

        if (chunk) {
          accForMessage += chunk;
          yield sseChunk('delta', { value: chunk });
        } else {
          log('messageDelta', { len: 0 });
        }
      }

      if (ev === 'message.completed') {
        const toSend = flushFinal();
        if (toSend) yield toSend;
      }

      if (ev === 'thread.run.completed') {
        const toSend = flushFinal();
        if (toSend) yield toSend;
        yield sseChunk('done');
      }

      if (ev === 'thread.run.failed') {
        const toSend = flushFinal();
        if (toSend) yield toSend;
        yield sseChunk('error', { message: e?.data?.last_error?.message || 'run failed' });
        yield sseChunk('done');
      }
    }
  } catch (err: any) {
    log('stream.exception', { msg: err?.message });
    yield sseChunk('error', { message: err?.message || 'stream exception' });
    yield sseChunk('done');
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { message, threadId } = (body ?? {}) as {
      message?: { role: 'user'; parts?: Array<{ type: 'text'; text: string }> };
      threadId?: string | null;
    };

    const userText = message?.parts?.[0]?.text ?? '';
    if (!userText) {
      return new Response('Missing message text', { status: 400 });
    }

    // crea/recupera thread
    let tid = threadId || null;
    if (!tid) {
      const t = await client.beta.threads.create();
      tid = t.id;
    }
    log('thread', { threadId: tid });

    // agrega mensaje del usuario
    await client.beta.threads.messages.create(tid!, {
      role: 'user',
      content: userText,
    });
    log('user.message.created', { len: userText.length });

    // stream SSE
    const encoder = new TextEncoder();
    const rs = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of streamRun({ threadId: tid! })) {
            controller.enqueue(encoder.encode(chunk));
          }
        } finally {
          controller.close();
          log('stream.end');
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
  } catch (err: any) {
    log('handler.error', { msg: err?.message });
    return new Response(
      JSON.stringify({ error: 'bad-request', message: err?.message || '' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }
}
