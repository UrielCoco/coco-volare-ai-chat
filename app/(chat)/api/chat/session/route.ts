import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
const COOKIE = 'cv_session_thread';

export async function GET(req: NextRequest) {
  try {
    const cookie = req.cookies.get(COOKIE)?.value;
    let threadId = cookie;

    if (!threadId) {
      const t = await client.beta.threads.create({ metadata: { channel: 'webchat-embed' } });
      threadId = t.id;
    }

    const res = NextResponse.json({ ok: true, threadId });
    res.cookies.set(COOKIE, threadId!, {
      httpOnly: false,
      sameSite: 'lax',
      secure: true,
      maxAge: 60 * 60 * 24 * 365,
      path: '/',
    });
    return res;
  } catch (e: any) {
    console.error('[CV][server] session exception', e);
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
