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
    if (!apiKey || !assistantId) return json(500, { error: 'Faltan OPENAI_API_KEY / OPENAI_ASSISTANT_ID' });

    const openai = new OpenAI({ apiKey });

    // 👇 Reuso de thread si viene de la UI
    let threadId: string | null = body?.threadId ?? null;

    if (threadId) {
      await openai.beta.threads.messages.create(threadId, { role: 'user', content: text || 'Mensaje' });
    } else {
      const thread = await openai.beta.threads.create({
        messages: [{ role: 'user', content: text || 'Mensaje' }],
      });
      threadId = thread.id;
    }

    const run = await openai.beta.threads.runs.create(threadId!, { assistant_id: assistantId });

    // Polling compatible con SDKs (firmas nuevas y antiguas)
    const start = Date.now();
    let status = run.status;
    while (
      status !== 'completed' &&
      status !== 'failed' &&
      status !== 'cancelled' &&
      Date.now() - start < 45_000
    ) {
      await wait(800);
      let rnow: any;
      try {
        rnow = await (openai as any).beta.threads.runs.retrieve(run.id, { thread_id: threadId });
      } catch {
        rnow = await (openai as any).beta.threads.runs.retrieve(threadId!, run.id);
      }
      status = rnow.status;
      if (status === 'requires_action') break;
    }

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

    return json(200, { reply, threadId });
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
