// ✅ Archivo corregido: /app/(chat)/api/chat/route.ts

import { OpenAI } from '@ai-sdk/openai';
import { streamText } from 'ai';
import { StreamingTextResponse } from 'ai';
import { auth } from '@/auth';
import { ratelimit } from '@/lib/rate-limit';
import { recordChatHistory } from '@/lib/chat-history';
import { generateTitleFromUserMessage } from '@/lib/generate-title';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

export const runtime = 'edge';

export async function POST(req: Request) {
  const json = await req.json();
  const { id, message, selectedChatModel, selectedVisibilityType } = json;

  const session = await auth();
  if (!session) return new Response('Unauthorized', { status: 401 });

  const userInput = typeof message?.parts?.[0]?.text === 'string'
    ? message.parts[0].text
    : '';

  if (!userInput) {
    return new Response('Invalid user input', { status: 400 });
  }

  const rateLimit = await ratelimit(session.user.id);
  if (!rateLimit.success) return new Response('Rate limit exceeded', { status: 429 });

  const { textStream, done } = await streamText({
    model: openai.chat({ model: selectedChatModel }),
    messages: [
      {
        role: 'user',
        content: userInput,
      },
    ],
  });

  done.finally(async () => {
    const title = await generateTitleFromUserMessage({
      message: {
        id,
        role: 'user',
        parts: [{ type: 'text', text: userInput }],
      },
    });

    await recordChatHistory({
      chatId: id,
      userId: session.user.id,
      title,
      visibility: selectedVisibilityType,
      messages: [message],
    });
  });

  return new StreamingTextResponse(textStream);
}
