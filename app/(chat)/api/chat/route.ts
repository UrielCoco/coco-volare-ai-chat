export const runtime = 'nodejs';

import { auth } from '@/app/(auth)/auth';
import {
  createStreamId,
  deleteChatById,
  getChatById,
  getMessageCountByUserId,
  saveChat,
  saveMessages,
} from '@/lib/db/queries';
import { postRequestBodySchema } from './schema';
import { ChatSDKError } from '@/lib/errors';
import { generateUUID } from '@/lib/utils';
import { generateTitleFromUserMessage } from '../../actions';
import type { VisibilityType } from '@/components/visibility-selector';
import { streamText } from 'ai';
import { myProvider } from '@/lib/ai/providers';
import { runAssistantWithStream } from '@/lib/ai/providers/openai-assistant';

export async function POST(request: Request) {
  console.log('📥 POST /api/chat iniciado');

  let requestBody;
  try {
    const json = await request.json();
    console.log('📨 JSON recibido:', json);
    requestBody = postRequestBodySchema.parse(json);
  } catch (error) {
    console.error('❌ Error al parsear JSON:', error);
    return new ChatSDKError('bad_request:api').toResponse();
  }

  const { id, message, selectedChatModel, selectedVisibilityType } = requestBody;
  const session = await auth();
  if (!session?.user) return new ChatSDKError('unauthorized:chat').toResponse();

  const messageCount = await getMessageCountByUserId({
    id: session.user.id,
    differenceInHours: 24,
  });

  if (messageCount > 100) {
    return new ChatSDKError('rate_limit:chat').toResponse();
  }

  const chat = await getChatById({ id });
  if (!chat) {
    const firstPart = message.parts[0];
    const userInput = typeof firstPart === 'string' ? firstPart : (firstPart as any)?.text ?? '';
    const title = await generateTitleFromUserMessage({ message: { role: 'user', content: userInput } });
    await saveChat({
      id,
      userId: session.user.id,
      title,
      visibility: selectedVisibilityType,
    });
    console.log('💬 Nuevo chat creado:', title);
  } else if (chat.userId !== session.user.id) {
    return new ChatSDKError('forbidden:chat').toResponse();
  }

  await saveMessages({
    messages: [
      {
        chatId: id,
        id: message.id,
        role: 'user',
        parts: message.parts,
        attachments: [],
        createdAt: new Date(),
      },
    ],
  });

  const streamId = generateUUID();
  await createStreamId({ streamId, chatId: id });

  console.log('🚀 Iniciando stream con modelo:', selectedChatModel);

  const firstPart = message.parts[0];
  const userInput = typeof firstPart === 'string' ? firstPart : (firstPart as any)?.text ?? '';
  console.log('📝 Prompt enviado al assistant:', userInput);

  try {
    // 👉 Branch para assistant
    if (selectedChatModel === 'assistant-openai') {
      const responseText = await runAssistantWithStream({
        userInput,
        assistantId: process.env.ASSISTANT_ID!, // asegúrate que esté definida en .env
      });

      return new Response(
        `data: ${JSON.stringify({ type: 'text', content: responseText })}\n\n`,
        {
          status: 200,
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          },
        },
      );
    }

    // 👉 Branch para languageModel tradicional
    const result = await streamText({
      model: myProvider.languageModel(selectedChatModel),
      messages: [
        {
          role: 'user',
          content: userInput,
        },
      ],
      temperature: 0.7,
    });

    const responseStream = result;

    console.log('📡 Enviando respuesta como SSE');
    return new Response(responseStream, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (err) {
    console.error('❌ Error al llamar OpenAI:', err);
    return new Response(JSON.stringify({ error: 'AI request failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return new ChatSDKError('bad_request:api').toResponse();
  }

  const session = await auth();
  if (!session?.user) return new ChatSDKError('unauthorized:chat').toResponse();

  const chat = await getChatById({ id });
  if (chat.userId !== session.user.id) {
    return new ChatSDKError('forbidden:chat').toResponse();
  }

  const deletedChat = await deleteChatById({ id });
  return Response.json(deletedChat, { status: 200 });
}
