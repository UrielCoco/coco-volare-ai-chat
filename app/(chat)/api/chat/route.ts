// app/(chat)/api/chat/route.ts

import { NextRequest } from 'next/server';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { message, selectedChatModel } = body;

  const userInput = message?.parts?.[0]?.text;
  if (!userInput) {
    return new Response('Missing user input', { status: 400 });
  }

  const completion = await openai.chat.completions.create({
    model: selectedChatModel || 'gpt-3.5-turbo',
    messages: [
      {
        role: 'user',
        content: userInput,
      },
    ],
    stream: false,
  });

  const assistantMessage = completion.choices[0]?.message?.content ?? 'No response';
  return Response.json({ reply: assistantMessage });
}
