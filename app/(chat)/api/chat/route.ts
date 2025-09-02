import OpenAI from 'openai';

export const runtime = 'nodejs'; // Streaming en Node

// Helper para emitir eventos SSE
function sse(event: string, data?: any) {
  const payload = data === undefined ? '' : `data: ${JSON.stringify(data)}\n`;
  return new TextEncoder().encode(`event: ${event}\n${payload}\n`);
}

export async function POST(req: Request) {
  const { searchParams } = new URL(req.url);
  const wantStream = searchParams.get('stream') === '1';

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const assistantId = process.env.OPENAI_ASSISTANT_ID;
  if (!assistantId) return new Response('Missing OPENAI_ASSISTANT_ID', { status: 500 });

  // Parse del body
  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response('Bad JSON', { status: 400 });
  }

  const userText: string =
    body?.message?.parts?.[0]?.text ??
    body?.message?.text ??
    body?.text ??
    '';

  if (!userText) return new Response('Missing message text', { status: 400 });

  // 1) Thread (reusar si viene)
  let threadId: string = body?.threadId;
  if (!threadId) {
    const t = await openai.beta.threads.create({});
    threadId = t.id;
  }

  // 2) Agregar el mensaje del usuario
  await openai.beta.threads.messages.create(threadId, {
    role: 'user',
    content: userText,
  });

  // 3) Si no pidieron stream, devuelve ids y listo
  if (!wantStream) {
    const run = await openai.beta.threads.runs.create(threadId, {
      assistant_id: assistantId,
    });
    return Response.json({ threadId, runId: run.id });
  }

  // 4) Stream SSE
  const stream = new ReadableStream({
    async start(controller) {
      // Envía meta con el thread id para que la UI lo guarde
      controller.enqueue(sse('meta', { threadId }));

      // Inicia el run en modo streaming
      const asstStream = await openai.beta.threads.runs.stream(threadId, {
        assistant_id: assistantId,
      });

      // ÚNICO listener tipado como 'event' para ser compatible con varias versiones del SDK
      asstStream.on('event', (evt: any) => {
        try {
          const name: string = evt?.event || evt?.type || '';
          // --- DELTAS DE TEXTO ---
          // nombres que hemos visto según versión: "message.delta" o "thread.message.delta"
          if (name.includes('message.delta')) {
            const items = evt?.data?.delta?.content ?? evt?.data?.content ?? [];
            for (const it of items) {
              const piece =
                it?.text?.value ??
                it?.text?.content ??
                it?.[ 'output_text' ] ??
                '';
              if (typeof piece === 'string' && piece.length) {
                controller.enqueue(sse('delta', { value: piece }));
              }
            }
            return;
          }

          // --- MENSAJE COMPLETADO ---
          if (name.includes('message.completed')) {
            const parts: string[] = [];
            for (const c of evt?.data?.content ?? []) {
              if (c?.type === 'text' && c?.text?.value) parts.push(c.text.value);
              // variantes
              else if (typeof c === 'string') parts.push(c);
              else if (c?.output_text) parts.push(String(c.output_text));
            }
            const text = parts.join('');
            if (text) controller.enqueue(sse('final', { text }));
            return;
          }

          // --- RUN COMPLETADO / FALLIDO ---
          if (name.includes('run.completed')) {
            controller.enqueue(sse('done', {}));
            return;
          }
          if (name.includes('run.failed')) {
            controller.enqueue(sse('error', {
              error: evt?.data?.error?.message || 'run.failed',
            }));
            return;
          }
        } catch (e: any) {
          controller.enqueue(sse('error', { error: e?.message || String(e) }));
        }
      });

      asstStream.on('error', (e: any) => {
        controller.enqueue(sse('error', { error: e?.message || String(e) }));
      });

      asstStream.on('end', () => {
        controller.enqueue(sse('done', {}));
      });

      // Si el cliente cierra la conexión
      const abort = () => {
        try { asstStream.abort(); } catch {}
      };
      req.signal.addEventListener('abort', abort);

      // Espera a que termine el stream del SDK
      await asstStream.done();

      // Cierra el SSE
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
