export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { getOrSetSessionId } from '@/lib/chat/cookies';
import {
  db,
  webSessionThread,
  type WebSessionThread as WebSessionThreadRow, // 👈 tipo exacto de la fila
  chat as ChatTable,
  message as MessageV2,
} from '@/lib/db';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;
const ASSISTANT_ID   = process.env.OPENAI_ASSISTANT_ID!; // asst_...
const CHANNEL        = 'web-embed';
const PUBLIC_CHAT_MODE = (process.env.PUBLIC_CHAT_MODE || 'assistants').toLowerCase();

// --- helpers ---

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

/** Devuelve SIEMPRE un objeto con TODAS las props del registro WebSessionThread */
async function getOrCreateAssistantMap(sessionId: string): Promise<WebSessionThreadRow> {
  const found = await db
    .select()
    .from(webSessionThread)
    .where(eq(webSessionThread.sessionId, sessionId));

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

  // devolvemos objeto COMPLETO (coincide con el esquema)
  return {
    sessionId,
    threadId,
    channel: CHANNEL,
    chatId: null,
    createdAt: now,
    updatedAt: now,
  };
}

/** (Opcional) Crea Chat interno si quisieras loguear en Message_v2. Por ahora passthrough. */
async function ensureChatForSession(mapRow: WebSessionThreadRow): Promise<WebSessionThreadRow> {
  // Si quieres crear Chat y enlazarlo a mapRow.chatId, hazlo aquí.
  return mapRow;
}

async function runAssistant(threadId: string, userMessage: string): Promise<string> {
  // 1) user message
  const msgRes = await fetch(`https://api.openai.com/v1/threads/${threadId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ role: 'user', content: userMessage }),
  });
  if (!msgRes.ok) throw new Error(`OpenAI add message failed: ${await msgRes.text()}`);

  // 2) run
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

  // 4) última respuesta
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

// --- handler ---

export async function POST(req: NextRequest) {
  try {
    if (PUBLIC_CHAT_MODE !== 'assistants') {
      return NextResponse.json(
        { error: 'PUBLIC_CHAT_MODE distinto de "assistants". Ajusta tu entorno.' },
        { status: 400 }
      );
    }

    const { sessionId } = getOrSetSessionId();
    const { message, threadId: incomingThreadId } = await req.json();

    if (!message || typeof message !== 'string') {
      return NextResponse.json({ error: 'message es requerido' }, { status: 400 });
    }

    // mapeo session → thread
    let mapRow = await getOrCreateAssistantMap(sessionId); // 👈 tipo WebSessionThreadRow

    // si el cliente envía un threadId explícito, lo respetamos sin perder props
    if (incomingThreadId && incomingThreadId !== mapRow.threadId) {
      const now = new Date();
      await db
        .update(webSessionThread)
        .set({ threadId: incomingThreadId, updatedAt: now })
        .where(eq(webSessionThread.sessionId, sessionId));

      mapRow = {
        ...mapRow,
        threadId: incomingThreadId,
        updatedAt: now,
      };
    }

    // (opcional) asegurar Chat interno (por ahora passthrough)
    mapRow = await ensureChatForSession(mapRow);

    // correr assistant
    const reply = await runAssistant(mapRow.threadId, message);

    // toque de updatedAt
    await db
      .update(webSessionThread)
      .set({ updatedAt: new Date() })
      .where(eq(webSessionThread.sessionId, sessionId));

    return NextResponse.json({ threadId: mapRow.threadId, reply }, { status: 200 });
  } catch (e: any) {
    console.error('CHAT API ERROR', e);
    return NextResponse.json({ error: 'Server error', detail: String(e?.message || e) }, { status: 500 });
  }
}
