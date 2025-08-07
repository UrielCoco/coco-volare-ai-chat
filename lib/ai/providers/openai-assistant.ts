// lib/ai/providers/openai-assistant.ts

import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

export async function runAssistantWithStream(userMessage: string) {
  const assistantId = process.env.OPENAI_ASSISTANT_ID;
  if (!assistantId) throw new Error("Missing OPENAI_ASSISTANT_ID");

  const thread = await openai.beta.threads.create();

  await openai.beta.threads.messages.create(thread.id, {
    role: 'user',
    content: userMessage,
  });

  const run = await openai.beta.threads.runs.create(thread.id, {
    assistant_id: assistantId,
  });

  let runStatus;
  do {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    runStatus = await openai.beta.threads.runs.retrieve(run.id, {
      thread_id: thread.id,
    });
  } while (runStatus.status !== 'completed');

  const messages = await openai.beta.threads.messages.list(thread.id);
  const lastMessage = messages.data.find((m) => m.role === 'assistant');

  const textPart = lastMessage?.content.find((c) => c.type === 'text');
  if (textPart?.type === 'text') {
    return textPart.text.value;
  }

  return 'No response';
}
