// ✅ Versión mínima funcional: /app/(chat)/api/chat/route.ts

import { streamText, StreamingTextResponse } from 'ai';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

export const runtime = 'edge';

export async function POST(req: Request) {
  const json = await req.json();
  const { message, selectedChatModel } = json;

  const userInput = typeof message?.parts?.[0]?.text === 'string'
    ? message.parts[0].text
    : '';

  if (!userInput) {
    return new Response('Invalid user input', { status: 400 });
  }

  const { textStream } = await streamText({
    model: openai.chat({ model: selectedChatModel }),
    messages: [
      {
        role: 'user',
        content: userInput,
      },
    ],
  });

  return new StreamingTextResponse(textStream);
}
