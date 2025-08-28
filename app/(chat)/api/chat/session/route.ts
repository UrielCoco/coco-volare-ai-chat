export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { getOrSetSessionId } from '@/lib/chat/cookies';

// --------- LOG HELPERS ----------
const LOG_PREFIX = 'CV:/api/chat/session';
const log = (...a: any[]) => console.log(LOG_PREFIX, ...a);
const err = (...a: any[]) => console.error(LOG_PREFIX, ...a);

// --------- DB (opcional, tolerante) ----------
let dbLoaded = true;
let db: any, webSessionThread: any, eq: any;
try {
  log('loading DB module…');
  const mod = await import('@/lib/db');
  db = mod.db;
  webSessionThread = mod.webSessionThread;
  eq = (await import('drizzle-orm')).eq;
  log('DB module loaded.');
} catch (e) {
  dbLoaded = false;
  err('DB module not available, continuing without DB. Detail:', String((e as any)?.message || e));
}

// --------- ENV ----------
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const CHANNEL = 'web-embed';

function openaiHeaders() {
  return {
    Authorization: `Bearer ${OPENAI_API_KEY}`,
    'Content-Type': 'application/json',
    'OpenAI-Beta': 'assistants=v2', // 👈 REQUERIDO
  };
}

async function createAssistantThread(): Promise<string> {
  log('createAssistantThread: calling OpenAI…');
  const res = await fetch('https://api.openai.com/v1/threads', {
    method: 'POST',
    headers: openaiHeaders(),
    body: JSON.stringify({}),
  });
  const txt = await res.text();
  log('createAssistantThread: status=', res.status, 'body=', txt.slice(0, 200));
  if (!res.ok) throw new Error(`OpenAI create thread failed: ${txt}`);
  const data = JSON.parse(txt);
  return data.id as string;
}

export async function GET(_req: NextRequest) {
  try {
    log('START');
    log('ENV check: OPENAI_API_KEY=', OPENAI_API_KEY ? 'present' : 'absent', 'DB loaded=', dbLoaded);

    if (!OPENAI_API_KEY) {
      err('Missing OPENAI_API_KEY');
      return new NextResponse(
        JSON.stringify({ error: 'Missing OPENAI_API_KEY' }),
        { status: 500, headers: { 'content-type': 'application/json', 'x-cv-reason': 'missing-openai-api-key' } }
      );
    }

    const { sessionId } = getOrSetSessionId();
    log('sessionId=', sessionId);

    if (!dbLoaded) {
      const threadId = await createAssistantThread();
      log('NO-DB path: returning threadId=', threadId);
      return new NextResponse(
        JSON.stringify({ sessionId, threadId }),
        { status: 200, headers: { 'content-type': 'application/json', 'x-cv-db': 'unavailable' } }
      );
    }

    try {
      log('DB path: searching existing mapping…');
      const rows = await db.select().from(webSessionThread).where(eq(webSessionThread.sessionId, sessionId));
      log('DB path: rows found=', rows?.length || 0);
      if (rows.length > 0) {
        log('DB path: found threadId=', rows[0]?.threadId);
        return NextResponse.json({ sessionId, threadId: rows[0].threadId }, { status: 200 });
      }

      log('DB path: creating new thread…');
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

      log('DB path: inserted mapping for sessionId.');
      return NextResponse.json({ sessionId, threadId }, { status: 200 });
    } catch (dbErr: any) {
      err('DB path ERROR:', String(dbErr?.message || dbErr));
      const threadId = await createAssistantThread();
      log('DB path fallback: returning threadId=', threadId);
      return new NextResponse(
        JSON.stringify({ sessionId, threadId }),
        { status: 200, headers: { 'content-type': 'application/json', 'x-cv-db': `error:${String(dbErr?.message || dbErr)}` } }
      );
    }
  } catch (e: any) {
    err('UNCAUGHT:', e?.stack || e);
    return new NextResponse(
      JSON.stringify({ error: 'session error', detail: String(e?.message || e) }),
      { status: 500, headers: { 'content-type': 'application/json', 'x-cv-reason': 'exception' } }
    );
  } finally {
    log('END');
  }
}
