import 'server-only';
import OpenAI from 'openai';
import type { NextRequest } from 'next/server';

export const runtime = 'nodejs';

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

// ---------------------------- utils SSE ------------------------------------

function sse(event: string, data?: unknown) {
  return `event: ${event}\n` + (data !== undefined ? `data: ${JSON.stringify(data)}\n` : '') + `\n`;
}

function findFences(src: string) {
  const fences: Array<{ label: string; json: string }> = [];
  // nuestros fences principales
  const re = /```cv:(itinerary|quote)\s*([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) fences.push({ label: m[1], json: m[2].trim() });

  // tolerancia a ```json
  const reJson = /```json\s*([\s\S]*?)```/g;
  while ((m = reJson.exec(src))) fences.push({ label: 'json', json: m[1].trim() });

  return fences;
}

// extrae texto robustamente de un evento message.* del SDK
function extractTextFromMessageContent(content: any[]): string {
  if (!Array.isArray(content)) return '';
  let out = '';
  for (const part of content) {
    // formatos posibles según el tipo de evento
    // completed => { type: 'output_text', text: { value } }
    // delta     => { type: 'output_text', text: { value } }  ó  { type: 'output_text.delta', text: { value } }
    // fallback  => { type: 'text', text: { value } } ó { type:'text', text:'...' }
    const val =
      part?.text?.value ??
      part?.delta?.text?.value ??
      (typeof part?.text === 'string' ? part.text : '');
    if (typeof val === 'string') out += val;
  }
  return out;
}

// ---------------------------- route ----------------------------------------

export async function POST(req: NextRequest) {
  const { message, threadId: incomingThreadId } = await req.json();

  const encoder = new TextEncoder();

  const streamBody = new ReadableStream({
    async start(controller) {
      const write = (event: string, data?: unknown) => {
        controller.enqueue(encoder.encode(sse(event, data)));
      };

      let threadId = incomingThreadId as string | undefined;
      let closed = false;
      const safeClose = () => {
        if (!closed) {
          closed = true;
          controller.close();
        }
      };

      try {
        if (!client.apiKey) throw new Error('Missing OPENAI_API_KEY');
        if (!process.env.OPENAI_ASSISTANT_ID) throw new Error('Missing OPENAI_ASSISTANT_ID');

        // crear thread si hace falta
        if (!threadId) {
          const thread = await client.beta.threads.create();
          threadId = thread.id;
          write('meta', { threadId });
        }

        // agregar mensaje del usuario
        await client.beta.threads.messages.create(threadId!, {
          role: 'user',
          content: message?.content ?? (typeof message === 'string' ? message : ''),
        });

        // lanzar run con streaming de eventos
        const runStream = await client.beta.threads.runs.stream(threadId!, {
          assistant_id: process.env.OPENAI_ASSISTANT_ID!,
          instructions:
            'Cuando devuelvas un itinerario o una cotización, incluye un bloque de código con ```cv:itinerary``` o ```cv:quote``` que contenga SOLO JSON válido. No repitas ese JSON fuera del bloque.',
        });

        let currentMessageText = '';
        let lastDeltaEcho = '';

        runStream.on('event', (ev: any) => {
          const type = ev?.event || ev?.type;
          if (!type) return;

          // Recibimos deltas de texto
          if (type === 'thread.message.delta') {
            const deltaContent = ev?.data?.delta?.content ?? [];
            const value = extractTextFromMessageContent(deltaContent);
            if (value && value !== lastDeltaEcho) {
              lastDeltaEcho = value;
              currentMessageText += value;
              write('delta', { value }); // el cliente mantiene el "pensando…"
            }
          }

          // Un mensaje del assistant terminó: emitimos un final con el texto completo
          if (type === 'thread.message.completed') {
            // priorizamos el texto consolidado que trae el evento
            const msgContent = ev?.data?.message?.content ?? [];
            const fullTextFromEvent = extractTextFromMessageContent(msgContent);
            const fullText = fullTextFromEvent || currentMessageText;
            currentMessageText = '';

            if (fullText && fullText.trim()) {
              write('final', {
                text: fullText,
                fences: findFences(fullText),
              });
            }
          }

          // Run finalizado con éxito
          if (type === 'thread.run.completed') {
            write('done', { ok: true });
            safeClose();
          }

          // Errores (fallo del run o paso)
          if (
            type === 'thread.run.failed' ||
            type === 'thread.run.step.failed' ||
            type === 'error'
          ) {
            const msg =
              ev?.data?.last_error?.message ??
              ev?.data?.error?.message ??
              ev?.error ??
              'Run failed';
            write('error', { message: msg });
            write('done', { ok: false });
            safeClose();
          }
        });

        // Esperamos a que termine el stream (método correcto del SDK)
        await runStream.done();

        // por si no recibimos eventos de cierre explícitos
        write('done', { ok: true });
        safeClose();
      } catch (err: any) {
        write('error', { message: String(err?.message || err) });
        write('done', { ok: false });
        safeClose();
      }
    },
  });

  return new Response(streamBody, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
