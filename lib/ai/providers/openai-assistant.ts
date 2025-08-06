import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function runAssistantWithStream({
  userInput,
  assistantId,
}: {
  userInput: string;
  assistantId: string;
}) {
  // 1. Crea thread
  const thread = await openai.beta.threads.create();

  // 2. Agrega mensaje del usuario
  await openai.beta.threads.messages.create(thread.id, {
    role: 'user',
    content: userInput,
  });

  // 3. Ejecuta el agente
  const run = await openai.beta.threads.runs.create(thread.id, {
    assistant_id: assistantId,
  });

  // 4. Espera a que termine
let runStatus;
do {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  runStatus = await openai.beta.threads.runs.retrieve(
    run.id,
    { thread_id: thread.id },
    {}
  );
} while (runStatus.status !== 'completed');

  // 5. Recupera la respuesta
  const messages = await openai.beta.threads.messages.list(thread.id);

  const lastAssistantMessage = messages.data.find(
    (msg) => msg.role === 'assistant'
  );

  const textBlock = lastAssistantMessage?.content.find(
    (block) => block.type === 'text'
  );

  if (textBlock && textBlock.type === 'text') {
    return textBlock.text.value;
  } else {
    return 'No se pudo obtener una respuesta de texto del asistente.';
  }
}