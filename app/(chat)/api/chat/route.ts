// app/(chat)/api/chat/route.ts
import { NextRequest } from 'next/server';
import OpenAI from 'openai';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
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
    if (!apiKey || !assistantId) {
      return json(500, { error: 'Faltan OPENAI_API_KEY / OPENAI_ASSISTANT_ID' });
    }

    const openai = new OpenAI({ apiKey });

    // 1) Crear thread con el mensaje del usuario
    const thread = await openai.beta.threads.create({
      messages: [{ role: 'user', content: text || 'Mensaje' }],
    });

    // 2) Lanzar run
    const run = await openai.beta.threads.runs.create(thread.id, {
      assistant_id: assistantId,
    });

    // 3) Polling hasta completar (máx. ~45s) con firmas compatibles
    const start = Date.now();
    let status = run.status;

    while (
      status !== 'completed' &&
      status !== 'failed' &&
      status !== 'cancelled' &&
      Date.now() - start < 45_000
    ) {
      await wait(800);

      // --- Compatibilidad de firmas:
      // v4.x recientes: retrieve(runId, { thread_id })
      // v4.x antiguas: retrieve(threadId, runId)
      let rnow: any;
      try {
        rnow = await (openai as any).beta.threads.runs.retrieve(run.id, {
          thread_id: thread.id,
        });
      } catch {
        rnow = await (openai as any).beta.threads.runs.retrieve(thread.id, run.id);
      }

      status = rnow.status;
      if (status === 'requires_action') {
        // Si usas herramientas, aquí manejarías tool_outputs
        break;
      }
    }

    // 4) Leer mensajes (tomamos el último del asistente)
    const list = await openai.beta.threads.messages.list(thread.id, {
      order: 'desc',
      limit: 10,
    });

    const firstAssistant = list.data.find((m) => m.role === 'assistant');

    let reply = '';
    if (firstAssistant) {
      const chunks: string[] = [];
      for (const c of firstAssistant.content) {
        if (c.type === 'text') chunks.push(c.text.value || '');
      }
      reply = chunks.join('\n\n').trim();
    }

    return json(200, { reply, threadId: thread.id });
  } catch (err: any) {
    return json(500, { error: String(err?.message || err) });
  }
}

function json(status: number, data: any) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function wait(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
