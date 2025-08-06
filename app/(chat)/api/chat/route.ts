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
  const firstPart = message.parts[0];
  const userInput = typeof firstPart === 'string' ? firstPart : (firstPart as any)?.text ?? '';

  if (!chat) {
    const title = await generateTitleFromUserMessage({
      message: { role: 'user', content: userInput },
    });

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
  console.log('📝 Prompt enviado al assistant:', userInput);

  let responseStream: ReadableStream;

  try {
    if (selectedChatModel === 'assistant-openai') {
      const assistantId = process.env.OPENAI_ASSISTANT_ID;
      if (!assistantId) {
        throw new Error('El assistant ID no está definido en las variables de entorno');
      }

      const responseText = await runAssistantWithStream({
        userInput,
        assistantId,
      });

      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(`data: ${responseText}\n\n`));
          controller.close();
        },
      });

      responseStream = stream;
    } else {
      const result = await streamText({
        model: myProvider.languageModel(selectedChatModel),
        messages: [{ role: 'user', content: userInput }],
        temperature: 0.7,
      });

      if (typeof result?.getReader === 'function') {
        responseStream = result;
      } else {
        throw new Error('No se pudo obtener un stream válido');
      }
    }
  } catch (err) {
    console.error('❌ Error al llamar OpenAI:', err);
    return new Response(JSON.stringify({ error: 'AI request failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  console.log('📡 Enviando respuesta como SSE');
  return new Response(responseStream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
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
