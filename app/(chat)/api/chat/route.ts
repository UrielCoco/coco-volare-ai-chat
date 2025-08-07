// app/(chat)/api/chat/route.ts

import { NextRequest } from 'next/server';
import { runAssistantWithStream } from '@/lib/ai/providers/openai-assistant';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { message } = body;

  const userInput = message?.parts?.[0]?.text;
  if (!userInput) {
    return new Response('Missing user input', { status: 400 });
  }

  try {
    const assistantMessage = await runAssistantWithStream(userInput);
    return Response.json({ reply: assistantMessage });
  } catch (error) {
    console.error('Assistant error:', error);
    return new Response('Error generating response', { status: 500 });
  }
}
