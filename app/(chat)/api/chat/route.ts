import { runAssistantWithStream } from '@/lib/ai/providers/openai-assistant';

export const runtime = 'edge';

export async function POST(req: Request) {
  const json = await req.json();
  const userInput = json?.message?.parts?.[0]?.text;

  if (!userInput || typeof userInput !== 'string') {
    return new Response('Invalid user input', { status: 400 });
  }

  try {
    const { textStream } = await runAssistantWithStream(userInput);
    return new Response(textStream, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  } catch (err) {
    console.error('Error in assistant stream:', err);
    return new Response('Failed to run assistant', { status: 500 });
  }
}