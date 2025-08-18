export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { getOrSetSessionId } from '@/lib/chat/cookies';
import { runAssistantWithTools } from '@/lib/ai/providers/openai-assistant';

// --------- LOG HELPERS ----------
const LOG_PREFIX = 'CV:/api/chat';
const log = (...a: any[]) => console.log(LOG_PREFIX, ...a);
const err = (...a: any[]) => console.error(LOG_PREFIX, ...a);

// --------- ENV ----------
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID || '';
const HUB_BASE_URL = process.env.NEXT_PUBLIC_HUB_BASE_URL || process.env.HUB_BASE_URL || '';
const HUB_BRIDGE_SECRET = process.env.HUB_BRIDGE_SECRET || process.env.WEBHOOK_SECRET || '';

function pickText(body: any): string {
  if (!body) return '';
  const direct = body.message || body;
  const tryParts = (arr: any[]) =>
    (arr || [])
      .map((it) => (typeof it?.text === 'string' ? it.text : typeof it === 'string' ? it : ''))
      .find((s) => s && String(s).trim());

  if (typeof direct === 'string') return direct.trim();
  if (typeof direct?.text === 'string') return direct.text.trim();
  if (Array.isArray(direct?.parts)) {
    const t = tryParts(direct.parts);
    if (t) return String(t).trim();
  }
  if (Array.isArray(direct?.content)) {
    const t = tryParts(direct.content);
    if (t) return String(t).trim();
  }
  if (Array.isArray(direct?.messages)) {
    const lastUser = [...direct.messages].reverse().find((m) => m?.role === 'user');
    if (typeof lastUser?.content === 'string') return lastUser.content.trim();
    if (Array.isArray(lastUser?.content)) {
      const t = tryParts(lastUser.content);
      if (t) return String(t).trim();
    }
  }
  return '';
}

export async function POST(req: NextRequest) {
  try {
    log('START');
    log(
      'ENV check: OPENAI_API_KEY=',
      OPENAI_API_KEY ? 'present' : 'absent',
      'ASSISTANT_ID=',
      ASSISTANT_ID ? 'present' : 'absent',
      'HUB_BASE_URL=',
      !!HUB_BASE_URL,
      'HUB_BRIDGE_SECRET=',
      !!HUB_BRIDGE_SECRET
    );

    if (!OPENAI_API_KEY || !ASSISTANT_ID) {
      err('Missing OpenAI envs');
      return new NextResponse(
        JSON.stringify({ error: 'Missing OPENAI_API_KEY or OPENAI_ASSISTANT_ID' }),
        { status: 500, headers: { 'content-type': 'application/json', 'x-cv-reason': 'missing-openai-env' } }
      );
    }
    if (!HUB_BASE_URL || !HUB_BRIDGE_SECRET) {
      err('Missing HUB envs');
      return new NextResponse(
        JSON.stringify({ error: 'Missing HUB_BASE_URL or HUB_BRIDGE_SECRET' }),
        { status: 500, headers: { 'content-type': 'application/json', 'x-cv-reason': 'missing-hub-env' } }
      );
    }

    const { sessionId } = getOrSetSessionId();
    log('sessionId=', sessionId);

    // body parse
    const ct = req.headers.get('content-type') || '';
    let body: any = {};
    if (ct.includes('application/json')) {
      body = await req.json().catch(() => ({}));
    } else {
      const text = await req.text();
      try { body = JSON.parse(text); } catch { body = {}; }
    }

    // mensaje
    const userMessage = pickText(body) || 'Hola';
    const incomingThreadId: string | undefined = body?.threadId || body?.message?.threadId;
    log('incoming threadId=', incomingThreadId || null, 'text.len=', userMessage.length);

    // Ejecuta assistant con TOOLS → Kommo via Hub
    const { reply, threadId } = await runAssistantWithTools(userMessage, {
      threadId: incomingThreadId || null,
      hubBaseUrl: String(HUB_BASE_URL),
      hubSecret: String(HUB_BRIDGE_SECRET),
    });

    log('END (200) threadId=', threadId, 'reply.len=', reply?.length || 0);
    return NextResponse.json({ threadId, reply }, { status: 200 });
  } catch (e: any) {
    err('UNCAUGHT:', e?.stack || e);
    return new NextResponse(
      JSON.stringify({ error: 'Server error', detail: String(e?.message || e) }),
      { status: 500, headers: { 'content-type': 'application/json', 'x-cv-reason': 'exception' } }
    );
  }
}

export async function GET() {
  return NextResponse.json({ ok: true }, { status: 200 });
}
