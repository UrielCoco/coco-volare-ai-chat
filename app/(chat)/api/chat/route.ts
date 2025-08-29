import { NextRequest } from 'next/server';
import OpenAI from 'openai';

export const runtime = 'nodejs';

// Cambia CV_DEBUG=0 para silenciar logs
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
    if (!apiKey || !assistantId) return json(500, { error: 'Faltan OPENAI_API_KEY / OPENAI_ASSISTANT_ID' });

    const openai = new OpenAI({ apiKey });

    // ▶ Reusar threadId si viene de cliente
    let threadId: string | null = body?.threadId ?? null;
    if (DEBUG) console.log('[CV][server] incoming', { threadId, textPreview: text.slice(0, 120) });

    if (threadId) {
      await openai.beta.threads.messages.create(threadId, { role: 'user', content: text || 'Mensaje' });
      if (DEBUG) console.log('[CV][server] appended message to thread', threadId);
    } else {
      const thread = await openai.beta.threads.create({
        messages: [{ role: 'user', content: text || 'Mensaje' }],
      });
      threadId = thread.id;
      if (DEBUG) console.log('[CV][server] created thread', threadId);
    }

    const run = await openai.beta.threads.runs.create(threadId!, { assistant_id: assistantId });
    if (DEBUG) console.log('[CV][server] run created', { runId: run.id, status: run.status });

    // Polling (compatible con SDKs)
    const t0 = Date.now();
    let status = run.status;
    while (
      status !== 'completed' &&
      status !== 'failed' &&
      status !== 'cancelled' &&
      Date.now() - t0 < 45_000
    ) {
      await wait(800);
      let rnow: any;
      try {
        rnow = await (openai as any).beta.threads.runs.retrieve(run.id, { thread_id: threadId });
      } catch {
        rnow = await (openai as any).beta.threads.runs.retrieve(threadId!, run.id);
      }
      status = rnow.status;
      if (DEBUG) console.log('[CV][server] polling', { status });
      if (status === 'requires_action') break;
    }

    // Leer mensajes (último del asistente)
    const list = await openai.beta.threads.messages.list(threadId!, { order: 'desc', limit: 10 });
    const firstAssistant = list.data.find((m) => m.role === 'assistant');

    let reply = '';
    if (firstAssistant) {
      reply = firstAssistant.content
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text?.value || '')
        .join('\n\n')
        .trim();
    }

    if (DEBUG) {
      console.log('[CV][server] reply ready', {
        ms: Date.now() - startedAt,
        replyPreview: reply.slice(0, 120),
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

function wait(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
