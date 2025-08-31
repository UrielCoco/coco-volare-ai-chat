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

function flattenAssistantTextFromMessage(message: any): string {
  // message: OpenAI.Beta.Threads.Messages.Message
  const out: string[] = [];
  if (!message?.content) return '';
  for (const c of message.content) {
    // formatos posibles segun SDK
    if (c.type === 'text' && c.text?.value) out.push(c.text.value);
    // algunos SDKs antiguos usan c.text?.annotations pero value sigue existiendo
  }
  return out.join('\n');
}

function extractDeltaTextFromEvent(e: any): string {
  // Para eventos 'thread.message.delta' el texto suele venir en e.data.delta.content[*].text.value
  try {
    const content = e?.data?.delta?.content;
    if (Array.isArray(content)) {
      const parts: string[] = [];
      for (const item of content) {
        if (item?.type === 'text' && item?.text?.value) parts.push(item.text.value);
        // algunas variantes usan 'output_text'
        if (item?.type === 'output_text' && item?.text?.value) parts.push(item.text.value);
      }
      return parts.join('');
    }
  } catch {}
  return '';
}

// --- Extrae ops de bloques ```cv:kommo ... ```
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
      // ignora bloque malformado
    }
  }
  return ops;
}

export async function POST(req: NextRequest) {
  const { message, threadId } = await req.json();

  // 1) Asegurar thread
  let tid = String(threadId || '');
  if (!tid) {
    const t = await client.beta.threads.create();
    tid = t.id;
  }

  // 2) Adjuntar mensaje de usuario
  const userText = asText(message);
  await client.beta.threads.messages.create(tid, { role: 'user', content: userText });

  // 3) SSE → Cliente
  const encoder = new TextEncoder();

  const rs = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: any) =>
        controller.enqueue(encoder.encode(sse(event, data)));

      // meta con threadId
      send('meta', { threadId: tid });

      let sawText = false;
      let runId: string | null = null;

      try {
        // Usamos createAndStream para compatibilidad y tipeo seguro
        const stream = await client.beta.threads.runs.createAndStream(tid, {
          assistant_id: ASSISTANT_ID,
        });

        // Escuchamos un solo canal "event" para cubrir todas las variantes de SDK
        stream.on('event', (e: any) => {
          const type = e?.event as string;

          if (type === 'thread.run.created') {
            runId = e?.data?.id ?? null;
            return;
          }

          if (type === 'thread.message.delta') {
            const deltaText = extractDeltaTextFromEvent(e);
            if (deltaText) {
              sawText = true;
              send('delta', { value: deltaText });
            }
            return;
          }

          if (type === 'thread.message.completed') {
            // mensaje completo del assistant
            const full = flattenAssistantTextFromMessage(e?.data);
            if (full) {
              sawText = true;
              send('final', { text: full });

              // si incluye bloque cv:kommo, avisamos explícitamente
              const ops = extractKommoOps(full);
              if (ops.length) send('kommo', { ops });
            }
            return;
          }

          if (type === 'error') {
            send('error', { error: String(e?.data || 'unknown') });
            return;
          }

          if (type === 'thread.run.failed') {
            send('error', { error: 'run_failed' });
            return;
          }

          if (type === 'done' || type === 'thread.run.completed') {
            // no enviamos nada extra aquí; el cierre formal lo hace stream.on('end')
            return;
          }
        });

        stream.on('end', async () => {
          if (!sawText && runId) {
            // Algunas versiones del SDK exigen objeto { thread_id, run_id }
            try {
              // @ts-expect-error: distintas firmas segun versión
              await client.beta.threads.runs.cancel({ thread_id: tid, run_id: runId });
            } catch {
              try {
                // fallback a firma (threadId, runId) en SDKs más nuevos
                // @ts-expect-error: firma alternativa
                await client.beta.threads.runs.cancel(tid, runId);
              } catch {}
            }
          }
          send('done', {});
          controller.close();
        });

        stream.on('error', async (err: any) => {
          if (runId) {
            try {
              // @ts-expect-error: distintas firmas segun versión
              await client.beta.threads.runs.cancel({ thread_id: tid, run_id: runId });
            } catch {
              try {
                // @ts-expect-error
                await client.beta.threads.runs.cancel(tid, runId);
              } catch {}
            }
          }
          send('error', { error: String(err?.message || err) });
          controller.close();
        });
      } catch (e: any) {
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
