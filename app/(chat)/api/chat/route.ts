// app/(chat)/api/chat/route.ts
import { NextRequest } from 'next/server';
import OpenAI from 'openai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const client = new OpenAI({
  apiKey: process.env.OPENAI_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY!,
});
const ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID!;

// --------- Tipos mínimos para la UI ---------
type UiMessage = {
  role: 'user' | 'assistant';
  parts: Array<{ type: 'text'; text: string }>;
};

function asText(msg?: UiMessage) {
  if (!msg?.parts?.length) return '';
  return msg.parts.map((p) => (p.type === 'text' ? p.text : '')).join('');
}

function sse(event: string, data: any) {
  return `event: ${event}\n` + `data: ${JSON.stringify(data)}\n\n`;
}

// ---------- Logs server ----------
function slog(event: string, meta: Record<string, any> = {}) {
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

// Extrae texto delta de eventos heterogéneos del SDK
function extractDeltaTextFromEvent(e: any): string {
  try {
    const content = e?.data?.delta?.content;
    if (Array.isArray(content)) {
      const parts: string[] = [];
      for (const item of content) {
        if (item?.type === 'text' && item?.text?.value) parts.push(item.text.value);
        if (item?.type === 'output_text' && item?.text?.value) parts.push(item.text.value);
        // algunas versiones envían "output_text_delta"
        if (item?.type === 'output_text_delta' && (item as any)?.value) parts.push((item as any).value);
      }
      return parts.join('');
    }
  } catch {}
  return '';
}

// ---------- “te lo preparo / un momento” (para ACK visual) ----------
const WAIT_PATTERNS = [
  // ES
  /dame un momento/i, /un momento/i, /perm[ií]teme/i, /en breve/i, /ahora mismo/i,
  /lo preparo/i, /te preparo/i, /voy a preparar/i, /estoy preparando/i,
  // EN
  /give me a moment/i, /one moment/i, /hold on/i, /let me/i, /just a moment/i,
  /i('|’)ll prepare/i, /i will prepare/i, /i('|’)m preparing/i, /working on it/i,
  // IT
  /un attimo/i, /lascia(mi)? che/i, /preparo/i, /sto preparando/i,
  // PT
  /um momento/i, /deixa eu/i, /vou preparar/i, /estou preparando/i,
  // FR
  /un instant/i, /laisse(-|\s)?moi/i, /je vais pr[eé]parer/i, /je pr[eé]pare/i,
  // DE
  /einen moment/i, /lass mich/i, /ich werde vorbereiten/i, /ich bereite vor/i,
];
function hasWaitPhrase(text: string) {
  const t = text || '';
  return WAIT_PATTERNS.some((rx) => rx.test(t));
}
function hasVisibleBlock(text: string) {
  return /```cv:(itinerary|quote)\b/.test(text || '');
}

// ========== POST ==========
export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const wantStream = searchParams.get('stream') === '1';

  const body = await req.json().catch(() => ({}));
  const uiMsg: UiMessage | undefined = body?.message;
  let threadId: string | null = body?.threadId || null;

  // 1) thread
  if (!threadId) {
    const created = await client.beta.threads.create({});
    threadId = created.id;
  }

  // 2) add user message
  const userText = asText(uiMsg);
  if (userText) {
    await client.beta.threads.messages.create(threadId!, {
      role: 'user',
      content: userText,
    });
  }

  // 3) NO streaming → simple createAndPoll (por si quieres debug)
  if (!wantStream) {
    const run = await client.beta.threads.runs.createAndPoll(threadId!, {
      assistant_id: ASSISTANT_ID,
    });
    const list = await client.beta.threads.messages.list(threadId!);
    const last = list.data?.[0];
    const text = flattenAssistantTextFromMessage(last);
    return new Response(JSON.stringify({ threadId, run, text }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 4) Streaming SSE
  const stream = new ReadableStream({
    start: async (controller) => {
      const send = (event: string, data: any) => {
        controller.enqueue(new TextEncoder().encode(sse(event, data)));
      };

      // informa thread listo
      send('thread.ready', { threadId });

      try {
        // @ts-ignore – la forma concreta del stream varía por versión del SDK
        const runStream: any = await client.beta.threads.runs.stream(threadId!, {
          assistant_id: ASSISTANT_ID,
        });

        // --- Handlers de alto nivel (UI state machine) ---
        runStream
          .on('messageCreated', (e: any) => {
            const text = flattenAssistantTextFromMessage(e?.data);
            // ACK temprano (no bloquear UI)
            if (hasWaitPhrase(text) && !hasVisibleBlock(text)) {
              send('ack', { messageId: e?.data?.id });
            }
          })
          .on('messageDelta', (e: any) => {
            const delta = extractDeltaTextFromEvent(e);
            if (delta) send('delta', { value: delta });
          })
          .on('messageCompleted', (e: any) => {
            // mensaje completo del assistant (solo texto)
            try {
              const msg = e?.data;
              const text = flattenAssistantTextFromMessage(msg);
              send('message.final', {
                id: msg?.id,
                role: 'assistant',
                text,
              });
            } catch {}
          })
          // Herramientas: si el assistant emite JSON, espera a cerrar y manda un solo bloque
          .on('toolCallCreated', (e: any) => {
            if (e?.data?.name) slog('tool.created', { name: e.data.name });
          })
          .on('toolCallDelta', (e: any) => {
            // ignoramos los deltas de JSON para no renderizar parcial
          })
          .on('toolCallCompleted', (e: any) => {
            try {
              const tool = e?.data || e?.toolCall;
              const fnName = tool?.function?.name;
              if (fnName === 'emit_itinerary') {
                const args = JSON.parse(tool.function.arguments ?? '{}');
                if (args && Array.isArray(args.days)) {
                  send('itinerary', { payload: args });
                }
              }
            } catch (err) {
              slog('tool.error', { err: (err as any)?.message });
            }
          })
          .on('runStepCreated', (e: any) => {
            send('run.step', { id: e?.data?.id, status: 'created' });
          })
          .on('runStepDelta', (e: any) => {
            send('run.step', { id: e?.data?.id, status: 'in_progress' });
          })
          .on('runStepCompleted', (e: any) => {
            send('run.step', { id: e?.data?.id, status: 'completed' });
          })
          .on('runCreated', (e: any) => {
            send('run.status', { id: e?.data?.id, status: 'created' });
          })
          .on('runInProgress', (e: any) => {
            send('run.status', { id: e?.data?.id, status: 'in_progress' });
          })
          .on('runCompleted', (e: any) => {
            send('run.final', { id: e?.data?.id, status: 'completed' });
            controller.close();
          })
          .on('runFailed', (e: any) => {
            send('run.final', { id: e?.data?.id, status: 'failed' });
            controller.close();
          })
          .on('error', (err: any) => {
            slog('run.error', { err: String(err) });
            send('error', { message: 'stream_error' });
            controller.close();
          });

      } catch (err: any) {
        slog('server.error', { err: err?.message || String(err) });
        send('error', { message: 'internal_error' });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // evita buffering en proxies Nginx
    },
  });
}
