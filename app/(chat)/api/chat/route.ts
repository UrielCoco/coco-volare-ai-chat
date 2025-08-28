export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

// ===== Session cookie (simple) =====
const SESSION_COOKIE = 'cv_session_id';
function getOrSetSessionId() {
  const jar = cookies();
  let sessionId = jar.get(SESSION_COOKIE)?.value;
  if (!sessionId) {
    sessionId = `sess_${Math.random().toString(36).slice(2)}_${Date.now()}`;
    jar.set(SESSION_COOKIE, sessionId, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 30, // 30 días
    });
  }
  return { sessionId };
}

// ===== Thread cache sin DB (por sesión) =====
const SESSION_THREADS: Map<string, string> =
  (global as any).__cvSessionThreads || new Map<string, string>();
(global as any).__cvSessionThreads = SESSION_THREADS;

// ===== ENV =====
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const ASSISTANT_ID =
  process.env.OPENAI_ASSISTANT_ID || process.env.ASSISTANT_ID || '';
const HUB_BASE_URL =
  process.env.NEXT_PUBLIC_HUB_BASE_URL || process.env.HUB_BASE_URL || '';
const HUB_BRIDGE_SECRET =
  process.env.HUB_BRIDGE_SECRET || process.env.WEBHOOK_SECRET || '';

// ===== Logs =====
const LOG = 'CV:/api/chat';
const log = (...a: any[]) => console.log(LOG, ...a);
const err = (...a: any[]) => console.error(LOG, ...a);

// ===== Provider que ejecuta Assistant + tools→Hub/Kommo =====
import { runAssistantWithTools } from '@/lib/ai/providers/openai-assistant';

// ===== Util para extraer texto del body =====
function pickText(body: any): string {
  if (!body) return '';
  const direct = body.message || body;
  const pluck = (arr: any[]) =>
    (arr || [])
      .map((it) =>
        typeof it?.text === 'string' ? it.text : typeof it === 'string' ? it : ''
      )
      .find((s) => s && String(s).trim());

  if (typeof direct === 'string') return direct.trim();
  if (typeof direct?.text === 'string') return direct.text.trim();
  if (Array.isArray(direct?.parts)) {
    const t = pluck(direct.parts);
    if (t) return String(t).trim();
  }
  if (Array.isArray(direct?.content)) {
    const t = pluck(direct.content);
    if (t) return String(t).trim();
  }
  if (Array.isArray(direct?.messages)) {
    const lastUser = [...direct.messages].reverse().find((m) => m?.role === 'user');
    if (typeof lastUser?.content === 'string') return lastUser.content.trim();
    if (Array.isArray(lastUser?.content)) {
      const t = pluck(lastUser.content);
      if (t) return String(t).trim();
    }
  }
  return '';
}

export async function POST(req: NextRequest) {
  try {
    log('START');
    log('ENV', {
      hasOpenAI: !!OPENAI_API_KEY,
      hasAssistant: !!ASSISTANT_ID,
      hub: !!HUB_BASE_URL,
      hubSecret: !!HUB_BRIDGE_SECRET,
    });

    if (!OPENAI_API_KEY || !ASSISTANT_ID) {
      err('Missing OpenAI envs');
      return new NextResponse(
        JSON.stringify({ error: 'Missing OPENAI_API_KEY or OPENAI_ASSISTANT_ID' }),
        {
          status: 500,
          headers: { 'content-type': 'application/json', 'x-cv-reason': 'missing-openai-env' },
        }
      );
    }
    if (!HUB_BASE_URL || !HUB_BRIDGE_SECRET) {
      err('Missing HUB envs');
      return new NextResponse(
        JSON.stringify({ error: 'Missing HUB_BASE_URL or HUB_BRIDGE_SECRET' }),
        {
          status: 500,
          headers: { 'content-type': 'application/json', 'x-cv-reason': 'missing-hub-env' },
        }
      );
    }

    const { sessionId } = getOrSetSessionId();
    log('sessionId=', sessionId);

    // parse body (acepta JSON o texto)
    const ct = req.headers.get('content-type') || '';
    let body: any = {};
    if (ct.includes('application/json')) {
      body = (await req.json().catch(() => ({}))) || {};
    } else {
      const text = await req.text();
      try {
        body = JSON.parse(text);
      } catch {
        body = {};
      }
    }

    const userMessage = pickText(body) || 'Hola';

    // 1) threadId del body; 2) si no viene, usar cache por sesión
    let incomingThreadId: string | null = body?.threadId || null;
    if (!incomingThreadId) {
      incomingThreadId = SESSION_THREADS.get(sessionId) || null;
    }

    log('THREAD in=', incomingThreadId || null, 'text.len=', userMessage.length);

    // Ejecuta Assistant con tools → Kommo vía Hub
    const result = await runAssistantWithTools(userMessage, {
      threadId: incomingThreadId,
      hubBaseUrl: String(HUB_BASE_URL),
      hubSecret: String(HUB_BRIDGE_SECRET),
    });

    // Forzamos tipos mínimos esperados
    const reply: string = (result as any)?.reply || '';
    const threadId: string | null = (result as any)?.threadId || null;

    // toolEvents es opcional según tu implementación; úsalo solo si viene
    const toolEvents = (result as any)?.toolEvents as any[] | undefined;
    if (Array.isArray(toolEvents)) {
      const brief = toolEvents.map((e) => ({
        name: e?.name,
        ok: e?.ok ?? true,
        status: e?.status ?? 200,
      }));
      log('toolEvents=', brief);
    }

    // Persistir threadId por sesión (memoria sin DB)
    if (threadId) SESSION_THREADS.set(sessionId, threadId);

    log('THREAD out=', threadId || null);
    log('END (200) reply.len=', reply?.length || 0);
    return NextResponse.json({ threadId, reply }, { status: 200 });
  } catch (e: any) {
    err('UNCAUGHT', e?.stack || e);
    return new NextResponse(
      JSON.stringify({ error: 'Server error', detail: String(e?.message || e) }),
      { status: 500, headers: { 'content-type': 'application/json', 'x-cv-reason': 'exception' } }
    );
  }
}

export async function GET() {
  return NextResponse.json({ ok: true }, { status: 200 });
}
