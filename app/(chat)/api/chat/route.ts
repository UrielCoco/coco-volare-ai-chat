export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { getOrSetSessionId } from '@/lib/chat/cookies';

// --------- LOG HELPERS ----------
const LOG_PREFIX = 'CV:/api/chat';
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
const ASSISTANT_ID   = process.env.OPENAI_ASSISTANT_ID || '';
const CHANNEL        = 'web-embed';

function openaiHeaders() {
  return {
    Authorization: `Bearer ${OPENAI_API_KEY}`,
    'Content-Type': 'application/json',
    'OpenAI-Beta': 'assistants=v2', // 👈 REQUERIDO
  };
}

// --------- pickMessage SUPER TOLERANTE ----------
function extractFromRichContent(arr: any[]): string | undefined {
  for (const it of arr) {
    if (!it) continue;
    if (typeof it === 'string' && it.trim()) return it.trim();
    if (typeof it?.text === 'string' && it.text.trim()) return it.text.trim();
    if (typeof it?.value === 'string' && it.value.trim()) return it.value.trim();
    if (typeof it?.content === 'string' && it.content.trim()) return it.content.trim();
  }
  return undefined;
}

function pickMessage(body: any): string | undefined {
  if (!body) return undefined;
  if (typeof body === 'string') return body;

  const direct = body.message ?? body.input ?? body.content ?? body.text ?? body.prompt;
  if (typeof direct === 'string' && direct.trim()) return direct.trim();

  if (direct && typeof direct === 'object') {
    if (typeof direct.text === 'string' && direct.text.trim()) return direct.text.trim();
    if (typeof direct.content === 'string' && direct.content.trim()) return direct.content.trim();
    if (Array.isArray(direct.content)) {
      const t = extractFromRichContent(direct.content);
      if (t) return t;
    }
    if (Array.isArray(direct.parts)) {
      const t = extractFromRichContent(direct.parts);
      if (t) return t;
    }
    if (Array.isArray(direct.messages)) {
      const lastUser = [...direct.messages].reverse().find((m) => m?.role === 'user');
      if (lastUser?.content) {
        if (typeof lastUser.content === 'string' && lastUser.content.trim()) return lastUser.content.trim();
        if (Array.isArray(lastUser.content)) {
          const t = extractFromRichContent(lastUser.content);
          if (t) return t;
        }
      }
    }
  }

  if (Array.isArray(body.messages)) {
    const lastUser = [...body.messages].reverse().find((m) => m?.role === 'user');
    if (lastUser?.content) {
      if (typeof lastUser.content === 'string' && lastUser.content.trim()) return lastUser.content.trim();
      if (Array.isArray(lastUser.content)) {
        const t = extractFromRichContent(lastUser.content);
        if (t) return t;
      }
    }
  }

  if (Array.isArray(body.parts)) {
    const t = extractFromRichContent(body.parts);
    if (t) return t;
  }

  return undefined;
}

// --------- OpenAI helpers ----------
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

async function getOrCreateThreadId(sessionId: string): Promise<string> {
  if (!dbLoaded) {
    log('getOrCreateThreadId: NO-DB path → creating thread');
    return createAssistantThread();
  }
  try {
    log('getOrCreateThreadId: DB path → finding mapping…');
    const rows = await db.select().from(webSessionThread).where(eq(webSessionThread.sessionId, sessionId));
    log('getOrCreateThreadId: rows found=', rows?.length || 0);
    if (rows.length > 0) return rows[0].threadId;

    log('getOrCreateThreadId: creating thread…');
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
    log('getOrCreateThreadId: mapping inserted.');
    return threadId;
  } catch (e: any) {
    err('getOrCreateThreadId: DB ERROR:', String(e?.message || e));
    log('getOrCreateThreadId: fallback → creating thread');
    return createAssistantThread();
  }
}

async function runAssistant(threadId: string, userMessage: string): Promise<string> {
  log('runAssistant: sending user message…');
  const msgRes = await fetch(`https://api.openai.com/v1/threads/${threadId}/messages`, {
    method: 'POST',
    headers: openaiHeaders(),
    body: JSON.stringify({ role: 'user', content: userMessage }),
  });
  const msgTxt = await msgRes.text();
  log('runAssistant: add message status=', msgRes.status, 'body=', msgTxt.slice(0, 200));
  if (!msgRes.ok) throw new Error(`OpenAI add message failed: ${msgTxt}`);

  log('runAssistant: creating run…');
  const runRes = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs`, {
    method: 'POST',
    headers: openaiHeaders(),
    body: JSON.stringify({ assistant_id: ASSISTANT_ID }),
  });
  const runTxt = await runRes.text();
  log('runAssistant: run status=', runRes.status, 'body=', runTxt.slice(0, 200));
  if (!runRes.ok) throw new Error(`OpenAI run failed: ${runTxt}`);
  const run = JSON.parse(runTxt);

  log('runAssistant: polling…');
  for (let i = 0; i < 60; i++) {
    const statusRes = await fetch(
      `https://api.openai.com/v1/threads/${threadId}/runs/${run.id}`,
      { headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'OpenAI-Beta': 'assistants=v2' } } // 👈 poll sólo necesita auth+beta
    );
    const statusTxt = await statusRes.text();
    const status = JSON.parse(statusTxt);
    log(`runAssistant: poll[${i}] status=`, status.status);
    if (status.status === 'completed') break;
    if (['failed', 'cancelled', 'expired'].includes(status.status)) {
      throw new Error(`Run status: ${status.status}`);
    }
    await new Promise((r) => setTimeout(r, 1100));
  }

  log('runAssistant: fetching last assistant message…');
  const msgsRes = await fetch(
    `https://api.openai.com/v1/threads/${threadId}/messages?limit=10&order=desc`,
    { headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'OpenAI-Beta': 'assistants=v2' } } // 👈 auth+beta
  );
  const msgsTxt = await msgsRes.text();
  log('runAssistant: list messages status=', msgsRes.status, 'body=', msgsTxt.slice(0, 200));
  if (!msgsRes.ok) throw new Error(`OpenAI list messages failed: ${msgsTxt}`);
  const msgs = JSON.parse(msgsTxt);
  const assistantMsg = msgs.data.find((m: any) => m.role === 'assistant');

  const reply =
    assistantMsg?.content
      ?.map((c: any) => (c.type === 'text' ? c.text?.value : ''))
      .join('\n')
      ?.trim() || '…';

  log('runAssistant: reply length=', reply.length);
  return reply;
}

export async function POST(req: NextRequest) {
  try {
    log('START');
    log('ENV check: OPENAI_API_KEY=', OPENAI_API_KEY ? 'present' : 'absent',
        'ASSISTANT_ID=', ASSISTANT_ID ? 'present' : 'absent',
        'DB loaded=', dbLoaded);

    if (!OPENAI_API_KEY || !ASSISTANT_ID) {
      err('Missing OpenAI envs');
      return new NextResponse(
        JSON.stringify({ error: 'Missing OPENAI_API_KEY or OPENAI_ASSISTANT_ID' }),
        { status: 500, headers: { 'content-type': 'application/json', 'x-cv-reason': 'missing-openai-env' } }
      );
    }

    const { sessionId } = getOrSetSessionId();
    log('sessionId=', sessionId);

    let body: any = {};
    try { body = await req.json(); } catch {}
    log('incoming body keys=', Object.keys(body || {}));

    if (body?.message) {
      log('body.message typeof=', typeof body.message, 'keys=', typeof body.message === 'object' ? Object.keys(body.message) : 'n/a');
      if (Array.isArray(body?.message?.content)) log('body.message.content len=', body.message.content.length);
      if (Array.isArray(body?.message?.parts)) log('body.message.parts len=', body.message.parts.length);
    }

    const message = pickMessage(body);
    log('message present=', !!message);
    if (!message) {
      return new NextResponse(
        JSON.stringify({ error: 'message es requerido', detail: 'Accepted: message{string|{text|content|parts}} | input | text | prompt | messages[]' }),
        { status: 400, headers: { 'content-type': 'application/json', 'x-cv-reason': 'missing-message' } }
      );
    }

    let threadId = await getOrCreateThreadId(sessionId);
    log('resolved threadId=', threadId);

    const incomingThreadId: string | undefined = body?.threadId;
    if (incomingThreadId && incomingThreadId !== threadId) {
      log('incomingThreadId override=', incomingThreadId);
      threadId = incomingThreadId;
      if (dbLoaded) {
        try {
          await db
            .update(webSessionThread)
            .set({ threadId, updatedAt: new Date() })
            .where(eq(webSessionThread.sessionId, sessionId));
          log('DB mapping updated with incomingThreadId.');
        } catch (e: any) {
          err('DB update mapping failed:', String(e?.message || e));
        }
      }
    }

    const reply = await runAssistant(threadId, message);

    if (dbLoaded) {
      try {
        await db
          .update(webSessionThread)
          .set({ updatedAt: new Date() })
          .where(eq(webSessionThread.sessionId, sessionId));
        log('DB mapping touch updatedAt.');
      } catch (e: any) {
        err('DB touch updatedAt failed:', String(e?.message || e));
      }
    }

    log('END (200)');
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
