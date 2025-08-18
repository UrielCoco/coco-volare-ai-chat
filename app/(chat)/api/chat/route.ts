// app/(chat)/api/chat/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { cookies as cookieStore } from 'next/headers';
import { runAssistantWithTools } from '@/lib/ai/providers/openai-assistant';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  // Parseo compatible con tu UI actual
  const body = await req.json().catch(() => ({} as any));
  const userInput: string = body?.message?.parts?.[0]?.text?.toString()?.trim() || '';
  if (!userInput) return NextResponse.json({ error: 'empty_message' }, { status: 400 });

  const cookies = cookieStore();
  let threadId = cookies.get('cv_thread_id')?.value || null;

  try {
    const { reply, threadId: newThreadId } = await runAssistantWithTools(userInput, {
      threadId,
      hubBaseUrl: String(process.env.NEXT_PUBLIC_HUB_BASE_URL || ''),
      hubSecret: String(process.env.HUB_BRIDGE_SECRET || ''),
    });

    // Persistir el thread para mantener el contexto entre turnos
    if (!threadId && newThreadId) {
      cookies.set('cv_thread_id', newThreadId, { httpOnly: true, path: '/', maxAge: 60 * 60 * 24 * 7 });
    }

    return NextResponse.json({ reply, threadId: newThreadId || threadId || null });
  } catch (error) {
    console.error('Assistant error:', error);
    return NextResponse.json({ error: 'Error generating response' }, { status: 500 });
  }
}
