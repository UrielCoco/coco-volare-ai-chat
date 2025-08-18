export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { getOrSetSessionId } from '@/lib/chat/cookies';
import {
  db,
  webSessionThread,
  type WebSessionThread as WebSessionThreadRow,
} from '@/lib/db';
import { eq } from 'drizzle-orm';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;
const ASSISTANT_ID   = process.env.OPENAI_ASSISTANT_ID!; // asst_...
const CHANNEL        = 'web-embed';

// -------- helpers --------
function pickMessage(body: any): string | undefined {
  if (!body) return undefined;
  if (typeof body === 'string') return body;
  // nombres comunes
  const direct =
    body.message ??
    body.input ??
    body.content ??
    body.text ??
    body.prompt;
  if (typeof direct === 'string' && direct.trim()) return direct.trim();

  // SDKs que envían parts/attachments
  if (Array.isArray(body.parts) && body.parts.length) {
    const first = body.parts[0];
    if (first && typeof first === 'object') {
      if (typeof first.text === 'string' && first.text.trim()) return first.text.trim();
      if (typeof first.content === 'string' && first.content.trim()) return first.content.trim();
    }
  }

  // chat payloads tipo { messages:[{role,content}] }
  if (Array.isArray(body.messages)) {
    const lastUser = [...body.messages].reverse().find((m) => m?.role === 'user');
    if (lastUser?.content && typeof lastUser.content === 'string') return lastUser.content.trim();
  }

  return undefined;
}

async function createAssistantThread(): Promise<string> {
  const thRes = await fetch('https://api.openai.com/v1/threads', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });
  if (!thRes.ok) throw new Error(`OpenAI create thread failed: ${await thRes.text()}`);
  const thData = await thRes.json();
  return thData.id as string;
}

async function getOrCreateAssistantMap(sessionId: string): Promise<WebSessionThreadRow> {
  const found = await db.select().from(webSessionThread).where(eq(webSessionThread.sessionId, sessionId));
  if (found.length > 0) return found[0];

  const threadId = await createAssistantThread();
  const now = new Date();
  await db.insert(webSessionThread).values({
    sessionId,
    threadId,
    channel: CHANNEL,
    chatId: null,
    createdAt: now,
    updatedAt: now,
  });

  return { sessionId, threadId, channel: CHANNEL, chatId: null, createdAt: now, updatedAt: now };
}

async function runAssistant(threadId: string, userMessage: string): Promise<string> {
  // 1) mensaje del usuario
  const msgRes = await fetch(`https://api.openai.com/v1/threads/${threadId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ role: 'user', content: userMessage }),
  });
  if (!msgRes.ok) throw new Error(`OpenAI add message failed: ${await msgRes.text()}`);

  // 2) lanzar run
  const runRes = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ assistant_id: ASSISTANT_ID }),
  });
  if (!runRes.ok) throw new Error(`OpenAI run failed: ${await runRes.text()}`);
  const run = await runRes.json();

  // 3) poll simple
  for (let i = 0; i < 60; i++) {
    const statusRes = await fetch(
      `https://api.openai.com/v1/threads/${threadId}/runs/${run.id}`,
      { headers: { Authorization: `Bearer ${OPENAI_API_KEY}` } }
    );
    const status = await statusRes.json();
    if (status.status === 'completed') break;
    if (['failed', 'cancelled', 'expired'].includes(status.status)) {
      throw new Error(`Run status: ${status.status}`);
    }
    await new Promise((r) => setTimeout(r, 1100));
  }

  // 4) obtener última respuesta del assistant
  const msgsRes = await fetch(
    `https://api.openai.com/v1/threads/${threadId}/messages?limit=10&order=desc`,
    { headers: { Authorization: `Bearer ${OPENAI_API_KEY}` } }
  );
  if (!msgsRes.ok) throw new Error(`OpenAI list messages failed: ${await msgsRes.text()}`);
  const msgs = await msgsRes.json();
  const assistantMsg = msgs.data.find((m: any) => m.role === 'assistant');

  const reply =
    assistantMsg?.content
      ?.map((c: any) => (c.type === 'text' ? c.text?.value : ''))
      .join('\n')
      ?.trim() || '…';

  return reply;
}

// -------- handlers --------

export async function POST(req: NextRequest) {
  try {
    // ya no bloqueamos por PUBLIC_CHAT_MODE
    if (!OPENAI_API_KEY || !ASSISTANT_ID) {
      return new NextResponse(
        JSON.stringify({ error: 'Faltan OPENAI_API_KEY u OPENAI_ASSISTANT_ID' }),
        { status: 500, headers: { 'content-type': 'application/json', 'x-cv-reason': 'missing-openai-env' } }
      );
    }

    const { sessionId } = getOrSetSessionId();

    let body: any = {};
    try { body = await req.json(); } catch {}
    const message = pickMessage(body);

    if (!message) {
      return new NextResponse(
        JSON.stringify({ error: 'message es requerido', detail: 'Acepta message|input|content|text|prompt|parts[0].text' }),
        { status: 400, headers: { 'content-type': 'application/json', 'x-cv-reason': 'missing-message' } }
      );
    }

    // mapeo session → thread
    let mapRow = await getOrCreateAssistantMap(sessionId);

    // si el cliente envía un threadId explícito, lo respetamos (si venía en el body)
    const incomingThreadId: string | undefined = body?.threadId;
    if (incomingThreadId && incomingThreadId !== mapRow.threadId) {
      const now = new Date();
      await db
        .update(webSessionThread)
        .set({ threadId: incomingThreadId, updatedAt: now })
        .where(eq(webSessionThread.sessionId, sessionId));
      mapRow = { ...mapRow, threadId: incomingThreadId, updatedAt: now };
    }

    const reply = await runAssistant(mapRow.threadId, message);

    await db
      .update(webSessionThread)
      .set({ updatedAt: new Date() })
      .where(eq(webSessionThread.sessionId, sessionId));

    return NextResponse.json({ threadId: mapRow.threadId, reply }, { status: 200 });
  } catch (e: any) {
    console.error('CHAT API ERROR', e);
    return new NextResponse(
      JSON.stringify({ error: 'Server error', detail: String(e?.message || e) }),
      { status: 500, headers: { 'content-type': 'application/json', 'x-cv-reason': 'exception' } }
    );
  }
}

// (opcional) health-check rápido
export async function GET() {
  return NextResponse.json({ ok: true }, { status: 200 });
}
