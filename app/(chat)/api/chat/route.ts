import { NextRequest } from 'next/server';
import OpenAI from 'openai';

export const runtime = 'nodejs';

// CV_DEBUG=0 para silenciar logs; cualquier otro valor = logs ON
const DEBUG = process.env.CV_DEBUG !== '0';

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  try {
    const body = await req.json().catch(() => ({}));
    const raw = body?.message;

    const text =
      typeof raw?.parts?.[0]?.text === 'string'
        ? raw.parts[0].text
        : typeof raw?.text === 'string'
        ? raw.text
        : typeof raw === 'string'
        ? raw
        : '';

    const assistantId = process.env.OPENAI_ASSISTANT_ID;
    const apiKey = process.env.OPENAI_API_KEY;
    if (!assistantId || !apiKey) {
      return json(500, { error: 'Faltan OPENAI_ASSISTANT_ID / OPENAI_API_KEY' });
    }

    const openai = new OpenAI({ apiKey });

    // ====== THREAD (memoria) ======
    let threadId: string | null = body?.threadId ?? null;
    if (DEBUG) console.log('[CV][server] incoming', { threadId, textPreview: text.slice(0, 120) });

    if (threadId) {
      await openai.beta.threads.messages.create(threadId, {
        role: 'user',
        content: text || 'Mensaje',
      });
      if (DEBUG) console.log('[CV][server] appended message to', threadId);
    } else {
      const t = await openai.beta.threads.create({
        messages: [{ role: 'user', content: text || 'Mensaje' }],
      });
      threadId = t.id;
      if (DEBUG) console.log('[CV][server] created thread', threadId);
    }

    // ====== RUN (sin tools + evita saludos repetidos) ======
    const run = await openai.beta.threads.runs.create(threadId!, {
      assistant_id: assistantId,

      tool_choice: 'none',
      additional_instructions:
        'No uses herramientas. Continúa exactamente desde el último mensaje del usuario en este thread; NO repitas saludos ni reinicies el flujo. Si el usuario ya dio datos, úsalos y sigue.',
    });
    if (DEBUG) console.log('[CV][server] run', { id: run.id, status: run.status });

    // ====== Polling ======
    const T_LIMIT = 45_000;
    let status = run.status;
    const t0 = Date.now();

    while (!['completed', 'failed', 'cancelled'].includes(status) && Date.now() - t0 < T_LIMIT) {
      await sleep(600);

      // firmas nuevas y viejas del SDK
      let rnow: any;
      try {
        rnow = await (openai as any).beta.threads.runs.retrieve(run.id, { thread_id: threadId });
      } catch {
        rnow = await (openai as any).beta.threads.runs.retrieve(threadId!, run.id);
      }
      status = rnow.status;
      if (DEBUG) console.log('[CV][server] polling', { status });

      // Si (a pesar de tool_choice) pide herramientas → las "satisface" con salidas vacías para forzar la respuesta final
      if (status === 'requires_action') {
        const calls = rnow?.required_action?.submit_tool_outputs?.tool_calls ?? [];
        if (calls.length && DEBUG) console.log('[CV][server] requires_action -> submitting dummy outputs', calls.length);
        if (calls.length) {
          try {
            await (openai as any).beta.threads.runs.submitToolOutputs(threadId!, run.id, {
              tool_outputs: calls.map((c: any) => ({
                tool_call_id: c.id,
                output:
                  'Tool execution disabled in this chat. Provide the final answer directly as text using the context of this thread.',
              })),
            });
          } catch {
            await (openai as any).beta.threads.runs.submit_tool_outputs(threadId!, run.id, {
              tool_outputs: calls.map((c: any) => ({
                tool_call_id: c.id,
                output:
                  'Tool execution disabled in this chat. Provide the final answer directly as text using the context of this thread.',
              })),
            });
          }
        }
      }
    }

    // ====== Leer último mensaje del asistente ======
    const list = await openai.beta.threads.messages.list(threadId!, { order: 'desc', limit: 10 });
    const lastAssistant = list.data.find((m) => m.role === 'assistant');

    let reply = '';
    if (lastAssistant) {
      reply = lastAssistant.content
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text?.value || '')
        .join('\n\n')
        .trim();
    }

    if (DEBUG) {
      console.log('[CV][server] reply ready', {
        ms: Date.now() - startedAt,
        replyPreview: reply.slice(0, 140),
        threadId,
      });
    }

    return json(200, { reply, threadId });
  } catch (err: any) {
    console.error('[CV][server] error', { ms: Date.now() - startedAt, message: String(err?.message || err) });
    return json(500, { error: String(err?.message || err) });
  }
}

function json(status: number, data: any) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
