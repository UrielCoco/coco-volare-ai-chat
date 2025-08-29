import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

export const runtime = 'nodejs';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

type UiPart = { type: 'text'; text: string };

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const incoming = body?.message as { role: 'user' | 'assistant'; parts: UiPart[] } | undefined;
    let threadId: string | undefined = body?.threadId;

    if (!incoming || !Array.isArray(incoming.parts) || !incoming.parts[0]?.text) {
      return NextResponse.json({ error: 'Invalid message payload' }, { status: 400 });
    }

    // 1) Thread (reusar o crear)
    if (!threadId) {
      const created = await client.beta.threads.create();
      threadId = created.id;
    }

    // 2) Append user message
    await client.beta.threads.messages.create(threadId, {
      role: incoming.role,
      content: [{ type: 'text', text: incoming.parts[0].text }],
    });

    // 3) Run assistant
    const run = await client.beta.threads.runs.create(threadId, {
      assistant_id: process.env.OPENAI_ASSISTANT_ID!,
    });

    // 4) Poll hasta completar (o error)
    let status: string = 'queued';
    const started = Date.now();
    const MAX_MS = 45_000;

    while (status === 'queued' || status === 'in_progress') {
      // ✅ Firma correcta: (runId, { thread_id })
      const poll = await client.beta.threads.runs.retrieve(run.id, { thread_id: threadId });
      status = poll.status;

      if (status === 'completed' || status === 'failed' || status === 'expired' || status === 'cancelled') break;
      if (Date.now() - started > MAX_MS) break; // timeout suave

      await new Promise((r) => setTimeout(r, 1000));
    }

    // 5) Traer último mensaje del assistant (texto únicamente)
    //    Firma de list con threadId + params (tu SDK lo tipa así)
    const msgs = await client.beta.threads.messages.list(threadId, {
      order: 'desc',
      limit: 10,
    });

    const firstAssistant = msgs.data.find((m) => m.role === 'assistant');
    const reply =
      firstAssistant?.content
        ?.filter((c: any) => c?.type === 'text' && c?.text?.value)
        .map((c: any) => c.text.value as string)
        .join('\n') ?? '';

    return NextResponse.json({ threadId, reply });
  } catch (err: any) {
    console.error('[CV][server] exception', err);
    return NextResponse.json({ error: String(err?.message || err) }, { status: 500 });
  }
}
