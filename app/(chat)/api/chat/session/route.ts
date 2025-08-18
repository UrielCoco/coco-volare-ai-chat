export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { getOrSetSessionId } from '@/lib/chat/cookies';
import { db, webSessionThread } from '@/lib/db';
import { eq } from 'drizzle-orm';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;
const CHANNEL = 'web-embed';

async function getOrCreateAssistantThreadBySession(sessionId: string) {
  const existing = await db
    .select()
    .from(webSessionThread)
    .where(eq(webSessionThread.sessionId, sessionId));

  if (existing.length > 0) return existing[0].threadId;

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
  const threadId = thData.id as string;

  const now = new Date();
  await db.insert(webSessionThread).values({
    sessionId,
    threadId,
    channel: CHANNEL,
    createdAt: now,
    updatedAt: now,
  });

  return threadId;
}

export async function GET(_req: NextRequest) {
  try {
    const { sessionId } = getOrSetSessionId();
    const threadId = await getOrCreateAssistantThreadBySession(sessionId);
    return NextResponse.json({ sessionId, threadId }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: 'session error', detail: String(e?.message || e) }, { status: 500 });
  }
}
