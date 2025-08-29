import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
const ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID!;
const POLL_MS = 900;
const MAX_MS = 90_000; // 90s timeout suave

type UiPart = { type: 'text'; text: string };

function now() { return Date.now(); }
async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// Espera a que NO haya runs activos para un thread (evita "Can't add messages…")
async function waitForNoActiveRun(threadId: string) {
  let waited = 0;
  while (waited <= MAX_MS) {
    const runs = await client.beta.threads.runs.list(threadId, { limit: 1, order: 'desc' });
    const last = runs.data[0];
    const active = last && (
      last.status === 'queued' ||
      last.status === 'in_progress' ||
      last.status === 'requires_action' ||
      last.status === 'cancelling'
    );
    if (!active) return;
    await sleep(POLL_MS);
    waited += POLL_MS;
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const incoming = body?.message as { role: 'user' | 'assistant'; parts: UiPart[] } | undefined;
    let threadId: string | undefined = body?.threadId;

    const text = incoming?.parts?.[0]?.text?.trim();
    if (!text) {
      return NextResponse.json({ error: 'empty message' }, { status: 400 });
    }

    // 1) thread
    if (!threadId) {
      const t = await client.beta.threads.create({ metadata: { channel: 'webchat-embed' } });
      threadId = t.id;
    }

    // 2) asegúrate de no tener runs activos antes de crear un nuevo mensaje
    await waitForNoActiveRun(threadId);

    // 3) mensaje del usuario
    await client.beta.threads.messages.create(threadId, {
      role: 'user',
      content: text,
    });

    // 4) lanzar run
    const run = await client.beta.threads.runs.create(threadId, {
      assistant_id: ASSISTANT_ID,
      // Puedes inyectar una instrucción breve para suprimir "un momento..."
      instructions:
        'No digas “un momento” ni “te aviso”; responde de inmediato. ' +
        'Si hay información suficiente para un itinerario, responde usando un bloque ```cv:itinerary {json}```.',
    });

    // 5) poll status
    let status = run.status;
    const started = now();
    while (true) {
      const poll = await client.beta.threads.runs.retrieve(run.id, { thread_id: threadId });
      status = poll.status;

      if (
        status === 'completed' ||
        status === 'failed' ||
        status === 'expired' ||
        status === 'cancelled'
      ) break;

      if (now() - started > MAX_MS) {
        // timeout suave -> cancela y sal
        try { await client.beta.threads.runs.cancel(run.id, { thread_id: threadId }); } catch {}
        break;
      }
      await sleep(POLL_MS);
    }

    // 6) obtener último mensaje del assistant (texto)
    const msgs = await client.beta.threads.messages.list(threadId, { order: 'desc', limit: 10 });
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
