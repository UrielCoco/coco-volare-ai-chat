import { NextRequest, NextResponse } from 'next/server';
import { runAssistantWithTools } from '@/lib/ai/providers/openai-assistant';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as any));

  // Soporta tu formato actual y simples {message:"..."}
  const text =
    body?.message?.parts?.[0]?.text ??
    body?.message?.text ??
    body?.message ??
    body?.text ??
    '';
  const userInput: string = String(text || '').trim();

  if (!userInput) return NextResponse.json({ error: 'empty_message' }, { status: 400 });

  // Lee el threadId de la cookie si existe
  const existingThread = req.cookies.get('cv_thread_id')?.value || null;

  try {
    const { reply, threadId } = await runAssistantWithTools(userInput, {
      threadId: existingThread,
      hubBaseUrl: String(process.env.NEXT_PUBLIC_HUB_BASE_URL || ''),
      hubSecret: String(process.env.HUB_BRIDGE_SECRET || ''),
    });

    const res = NextResponse.json({ reply, threadId: threadId || existingThread || null });

    // Persiste threadId para siguientes turnos
    if (!existingThread && threadId) {
      res.cookies.set('cv_thread_id', threadId, {
        httpOnly: true,
        path: '/',
        maxAge: 60 * 60 * 24 * 7, // 7 días
      });
    }

    return res;
  } catch (error) {
    console.error('Assistant error:', error);
    return NextResponse.json({ error: 'assistant_error' }, { status: 500 });
  }
}
