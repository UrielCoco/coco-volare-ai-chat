export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { getOrSetSessionId } from '@/lib/chat/cookies';

// ⚠️ Usamos la DB si está disponible; si falla, seguimos sin romper el flujo.
let dbLoaded = true;
let db: any, webSessionThread: any, eq: any;
try {
  const mod = await import('@/lib/db');
  db = mod.db;
  webSessionThread = mod.webSessionThread;
  eq = (await import('drizzle-orm')).eq;
} catch {
  dbLoaded = false;
}

const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;
const CHANNEL = 'web-embed';

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

export async function GET(_req: NextRequest) {
  try {
    if (!OPENAI_API_KEY) {
      return new NextResponse(
        JSON.stringify({ error: 'Falta OPENAI_API_KEY' }),
        { status: 500, headers: { 'content-type': 'application/json', 'x-cv-reason': 'missing-openai-api-key' } }
      );
    }

    const { sessionId } = getOrSetSessionId();

    // Si no hay DB, creamos thread y devolvemos (sin persistir)
    if (!dbLoaded) {
      const threadId = await createAssistantThread();
      return new NextResponse(
        JSON.stringify({ sessionId, threadId }),
        { status: 200, headers: { 'content-type': 'application/json', 'x-cv-db': 'unavailable' } }
      );
    }

    // Con DB: intenta leer/crear mapping
    try {
      const rows = await db.select().from(webSessionThread).where(eq(webSessionThread.sessionId, sessionId));
      if (rows.length > 0) {
        return NextResponse.json({ sessionId, threadId: rows[0].threadId }, { status: 200 });
      }

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

      return NextResponse.json({ sessionId, threadId }, { status: 200 });
    } catch (dbErr: any) {
      // Si la tabla no existe o hay error de conexión, seguimos sin romper
      const threadId = await createAssistantThread();
      return new NextResponse(
        JSON.stringify({ sessionId, threadId }),
        { status: 200, headers: { 'content-type': 'application/json', 'x-cv-db': `error:${String(dbErr?.message || dbErr)}` } }
      );
    }
  } catch (e: any) {
    return new NextResponse(
      JSON.stringify({ error: 'session error', detail: String(e?.message || e) }),
      { status: 500, headers: { 'content-type': 'application/json', 'x-cv-reason': 'exception' } }
    );
  }
}
