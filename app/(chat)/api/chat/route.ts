// app/(chat)/api/chat/route.ts
import { NextRequest } from 'next/server';
import OpenAI from 'openai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
const ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID!;

type UiMessage = {
  role: 'user' | 'assistant';
  parts: Array<{ type: 'text'; text: string }>;
};

function asText(msg?: UiMessage) {
  if (!msg) return '';
  const p = msg.parts?.[0]?.text ?? '';
  return typeof p === 'string' ? p : '';
}

function ulog(event: string, meta: any = {}) {
  try {
    console.info(JSON.stringify({ tag: '[CV][server]', event, ...meta }));
  } catch {}
}

// ---------- Helpers OpenAI ----------
function flattenAssistantTextFromMessage(message: any): string {
  const out: string[] = [];
  if (!message?.content) return '';
  for (const c of message.content) {
    if (c.type === 'text' && c.text?.value) out.push(c.text.value);
  }
  return out.join('\n');
}

function extractDeltaTextFromEventStream(chunk: any): string {
  const out: string[] = [];
  try {
    const items = chunk?.delta?.content || [];
    for (const it of items) {
      if (it.type === 'output_text' && it.text) out.push(it.text);
      if (it.type === 'input_text' && it.text) out.push(it.text);
    }
  } catch {}
  return out.join('');
}

function sse(event: string, data: any) {
  return `data:${JSON.stringify({ event, ...data })}\n\n`;
}

async function runOnceWithStream(threadId: string, send: (e: string, d: any) => void) {
  const stream = await client.beta.threads.runs.stream(threadId, { assistant_id: ASSISTANT_ID });

  let finalText = '';

  return await new Promise<{ finalText: string }>((resolve, reject) => {
    stream
      // Deltas de texto “puros” (este sí existe tipado)
      .on('textDelta', (delta: { value?: string }) => {
        if (delta?.value) send('delta', { value: delta.value });
      })
      // Evento genérico para cubrir TODAS las variantes tipadas del SDK
      .on('event', (evt: { event: string; data?: any }) => {
        // 1) Deltas de mensaje (cuando no llegan por textDelta)
        if (evt.event === 'thread.message.delta' || evt.event === 'message.delta') {
          try {
            const items = evt?.data?.delta?.content ?? [];
            for (const it of items) {
              // algunos SDKs usan output_text / input_text, otros text
              if (it?.type === 'output_text' && it?.text) {
                send('delta', { value: it.text });
              } else if (it?.type === 'input_text' && it?.text) {
                send('delta', { value: it.text });
              } else if (it?.type === 'text' && it?.text?.value) {
                send('delta', { value: it.text.value });
              }
            }
          } catch {}
        }

        // 2) Mensaje completado (nombre estable: message.completed)
        if (evt.event === 'thread.message.completed' || evt.event === 'message.completed') {
          try {
            const msg = evt.data;
            const parts = Array.isArray(msg?.content) ? msg.content : [];
            const text = parts
              .filter((c: any) => c?.type === 'text' && c?.text?.value)
              .map((c: any) => c.text.value)
              .join('\n');

            if (text) {
              finalText += text;
              send('final', { text });
            }
          } catch {}
        }

        // 3) Run terminado
        if (evt.event === 'run.completed' || evt.event === 'thread.run.completed') {
          resolve({ finalText });
        }
      })
      .on('end', () => resolve({ finalText }))
      .on('error', (err: any) => reject(err));
  });
}


// ---------- Route ----------
export async function POST(req: NextRequest) {
  const { message } = await req.json();
  const tid = (req.nextUrl.searchParams.get('threadId') || '').trim();

  const encoder = new TextEncoder();

  const rs = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: any) =>
        controller.enqueue(encoder.encode(sse(event, data)));

      send('meta', { threadId: tid });

      // Heartbeat para mantener vivo el loader en el cliente
      const hb = setInterval(() => { try { send('hb', { t: Date.now() }); } catch {} }, 8000);

      try {
        // ---- Run 1
        const r1 = await runOnceWithStream(tid, send);

        // ¿Dijo “un momento” y NO entregó bloque visible? → reprompt "?"
        const shouldReprompt =
          r1.finalText &&
          !/```cv:(itinerary|quote)\b/i.test(r1.finalText) &&
          /^\s*(un\s+momento|dame\s+un\s+segundo|give\s+me\s+a\s+moment)/i.test(r1.finalText);

        if (shouldReprompt) {
          await client.beta.threads.messages.create(tid, {
            role: 'user',
            content: '?',
          });
          await runOnceWithStream(tid, send);
        }

        send('done', {});
        clearInterval(hb);
        controller.close();
      } catch (e: any) {
        clearInterval(hb);
        ulog('error', { msg: String(e?.message || e) });
        try { controller.enqueue(encoder.encode(sse('error', { message: 'stream_error' }))); } catch {}
        try { controller.close(); } catch {}
      }
    },
  });

  return new Response(rs, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
