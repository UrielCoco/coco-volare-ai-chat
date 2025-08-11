// app/(chat)/api/chat/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { cookies as cookieStore } from 'next/headers';
import { runAssistantWithStream } from '@/lib/ai/providers/openai-assistant';

export const runtime = 'nodejs';

// URL del Hub (defínela en Vercel/.env.local)
const HUB = process.env.NEXT_PUBLIC_HUB_BASE_URL;

export async function POST(req: NextRequest) {
  // 1) Parseo compatible con tu UI actual
  const body = await req.json().catch(() => ({} as any));
  const userInput: string = body?.message?.parts?.[0]?.text?.toString()?.trim() || '';

  if (!userInput) {
    return NextResponse.json({ error: 'Missing user input' }, { status: 400 });
  }

  // 2) Cookie de sesión para memoria en el Hub
  const jar = cookieStore();
  let sid = jar.get('cv_session_id')?.value;
  if (!sid) sid = 'cv-' + Math.random().toString(36).slice(2);

  // 3) Si hay HUB, proxy → Hub; si falla, hacemos fallback al assistant local
  if (HUB) {
    try {
      const r = await fetch(`${HUB}/api/assistant/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: sid, text: userInput, channel: 'web' }),
      });

      if (!r.ok) {
        const t = await r.text();
        console.error('Hub error:', r.status, t);
        // Fallback a tu implementación actual
        const assistantMessage = await runAssistantWithStream(userInput);
        const res = NextResponse.json({ reply: assistantMessage });
        res.cookies.set('cv_session_id', sid, {
          httpOnly: false, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 365,
        });
        return res;
      }

      const data = await r.json();
      const reply: string =
        data?.text ??
        data?.choices?.[0]?.message?.content ??
        '';

      const res = NextResponse.json({ reply });
      res.cookies.set('cv_session_id', sid, {
        httpOnly: false, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 365,
      });
      return res;
    } catch (err) {
      console.error('Hub fetch error:', err);
      // Fallback si el Hub no responde
      try {
        const assistantMessage = await runAssistantWithStream(userInput);
        const res = NextResponse.json({ reply: assistantMessage });
        res.cookies.set('cv_session_id', sid, {
          httpOnly: false, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 365,
        });
        return res;
      } catch (error) {
        return NextResponse.json({ error: 'Error generating response' }, { status: 500 });
      }
    }
  }

  // 4) Sin HUB definido → comportamiento original
  try {
    const assistantMessage = await runAssistantWithStream(userInput);
    return NextResponse.json({ reply: assistantMessage });
  } catch (error) {
    console.error('Assistant error:', error);
    return NextResponse.json({ error: 'Error generating response' }, { status: 500 });
  }
}
