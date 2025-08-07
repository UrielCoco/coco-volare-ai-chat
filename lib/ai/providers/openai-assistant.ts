import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

export async function runAssistantWithStream(userInput: string) {
  const assistantId = process.env.OPENAI_ASSISTANT_ID;
  if (!assistantId) throw new Error('Missing OPENAI_ASSISTANT_ID in env');

  const thread = await openai.beta.threads.create();
  await openai.beta.threads.messages.create(thread.id, {
    role: 'user',
    content: userInput,
  });

  const run = await openai.beta.threads.runs.create(thread.id, {
    assistant_id: assistantId,
  });

  let runStatus;
  do {
    await new Promise((res) => setTimeout(res, 1000));
    runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);
  } while (runStatus.status !== 'completed');

  const messages = await openai.beta.threads.messages.list(thread.id);

  const reply = messages.data
    .filter((msg) => msg.role === 'assistant')
    .map((msg) => msg.content.map((c) => ('text' in c ? c.text.value : '')).join('\n'))
    .join('\n');


    
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(reply));
      controller.close();
    },
  });

  return { textStream: stream };
}