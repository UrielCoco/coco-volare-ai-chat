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

function extractDeltaTextFromEvent(e: any): string {
  try {
    const content = e?.data?.delta?.content;
    if (Array.isArray(content)) {
      const parts: string[] = [];
      for (const item of content) {
        if (item?.type === 'text' && item?.text?.value) parts.push(item.text.value);
        if (item?.type === 'output_text' && item?.text?.value) parts.push(item.text.value);
      }
      return parts.join('');
    }
  } catch {}
  return '';
}

// ---------- Extrae ops de bloques ```cv:kommo ...``` en texto ----------
function extractKommoOps(text: string): Array<any> {
  const ops: any[] = [];
  if (!text) return ops;
  const rxFence = /```\s*cv:kommo\s*([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  while ((m = rxFence.exec(text))) {
    try {
      const json = JSON.parse((m[1] || '').trim());
      if (json && Array.isArray(json.ops)) ops.push(...json.ops);
    } catch {
      // ignorar bloque malformado
    }
  }
  return ops;
}

export async function POST(req: NextRequest) {
  const { message, threadId } = await req.json();
  const userText = asText(message);
  slog('request.in', { hasThreadId: !!threadId, userTextLen: userText.length });

  // 1) Asegurar thread
  let tid = String(threadId || '');
  if (!tid) {
    const t = await client.beta.threads.create();
    tid = t.id;
    slog('thread.created', { threadId: tid });
  } else {
    slog('thread.reuse', { threadId: tid });
  }

  // 2) Adjuntar mensaje del usuario
  await client.beta.threads.messages.create(tid, { role: 'user', content: userText });
  slog('message.append.ok', { threadId: tid });

  // 3) Abrir SSE
  const encoder = new TextEncoder();
  const rs = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: any) =>
        controller.enqueue(encoder.encode(sse(event, data)));

      // meta con threadId (cliente lo guarda)
      send('meta', { threadId: tid });

      let sawText = false;
      let deltaChars = 0;
      let runId: string | null = null;

      try {
        // Stream robusto (compatible con distintas versiones del SDK)
        const stream = await client.beta.threads.runs.createAndStream(tid, {
          assistant_id: ASSISTANT_ID,
        });

        stream.on('event', (e: any) => {
          const type = e?.event as string;

          if (type === 'thread.run.created') {
            runId = e?.data?.id ?? null;
            slog('run.created', { runId, threadId: tid });
            return;
          }

          if (type === 'thread.message.delta') {
            const deltaText = extractDeltaTextFromEvent(e);
            if (deltaText) {
              sawText = true;
              deltaChars += deltaText.length;
              send('delta', { value: deltaText });
              if (deltaChars % 300 === 0) {
                slog('stream.delta.tick', { deltaChars, runId, threadId: tid });
              }
            }
            return;
          }

          if (type === 'thread.message.completed') {
            const full = flattenAssistantTextFromMessage(e?.data);
            if (full) {
              sawText = true;
              // 1) Texto completo para el cliente
              send('final', { text: full });

              // 2) Si viene cv:kommo, avisar explícitamente
              const ops = extractKommoOps(full);
              slog('message.completed', {
                fullLen: full.length,
                kommoOps: ops.length,
                runId,
                threadId: tid,
              });
              if (ops.length) send('kommo', { ops });
            }
            return;
          }

          if (type === 'thread.run.failed') {
            slog('stream.error', { runId, threadId: tid, error: 'run_failed' });
            send('error', { error: 'run_failed' });
            return;
          }

          if (type === 'error') {
            slog('stream.error', { runId, threadId: tid, error: String(e?.data || 'unknown') });
            send('error', { error: String(e?.data || 'unknown') });
            return;
          }

          // Otros eventos se ignoran
        });

        stream.on('end', async () => {
          slog('stream.end', { deltaChars, sawText, runId, threadId: tid });

          // Si no hubo texto, cancelar run para no bloquear thread
          if (!sawText && runId) {
            try {
              // @ts-expect-error firmas distintas segun SDK
              await client.beta.threads.runs.cancel({ thread_id: tid, run_id: runId });
            } catch {
              try {
                // @ts-expect-error firma alternativa
                await client.beta.threads.runs.cancel(tid, runId);
              } catch {}
            }
          }
          send('done', {});
          controller.close();
        });

        stream.on('error', async (err: any) => {
          slog('exception.stream', { runId, threadId: tid, error: String(err?.message || err) });
          if (runId) {
            try {
              // @ts-expect-error firmas distintas segun SDK
              await client.beta.threads.runs.cancel({ thread_id: tid, run_id: runId });
            } catch {
              try {
                // @ts-expect-error firma alternativa
                await client.beta.threads.runs.cancel(tid, runId);
              } catch {}
            }
          }
          send('error', { error: String(err?.message || err) });
          controller.close();
        });
      } catch (e: any) {
        slog('exception.createStream', { error: String(e?.message || e) });
        send('error', { error: String(e?.message || e) });
        controller.close();
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
}
