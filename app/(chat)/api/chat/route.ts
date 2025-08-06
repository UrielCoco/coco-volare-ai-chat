export const runtime = 'nodejs';

import { auth, type UserType } from '@/app/(auth)/auth';
import {
  createStreamId,
  deleteChatById,
  getChatById,
  getMessageCountByUserId,
  getMessagesByChatId,
  saveChat,
  saveMessages,
} from '@/lib/db/queries';
import { runAssistantWithStream } from '@/lib/ai/providers/openai-assistant';
import { postRequestBodySchema, type PostRequestBody } from './schema';
import { ChatSDKError } from '@/lib/errors';
import { convertToUIMessages, generateUUID } from '@/lib/utils';
import { generateTitleFromUserMessage } from '../../actions';
import type { ChatMessage } from '@/lib/types';
import type { ChatModel } from '@/lib/ai/models';
import type { VisibilityType } from '@/components/visibility-selector';

export async function POST(request: Request) {
  console.log('📥 POST /api/chat iniciado');
  let requestBody: PostRequestBody;

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

  const userType: UserType = session.user.type;
  const messageCount = await getMessageCountByUserId({
    id: session.user.id,
    differenceInHours: 24,
  });

  if (messageCount > 100) {
    return new ChatSDKError('rate_limit:chat').toResponse();
  }

  const chat = await getChatById({ id });
  if (!chat) {
    const title = await generateTitleFromUserMessage({ message });
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
        parts: message.parts as any[], // ✅ Fuerza como arreglo compatible
        attachments: [],
        createdAt: new Date(),
      },
    ],
  });

  const streamId = generateUUID();
  await createStreamId({ streamId, chatId: id });

  console.log('🚀 Iniciando stream con modelo:', selectedChatModel);
  console.log('🤖 Usando assistant-openai');

  const firstPart = message.parts[0];
  let userInput = '';

  if (typeof firstPart === 'string') {
    userInput = firstPart;
  } else if ('text' in firstPart) {
    userInput = firstPart.text;
  }

  console.log('📝 Prompt enviado al assistant:', userInput);

  let responseStream;
  try {
    responseStream = await runAssistantWithStream({
      userInput,
      assistantId: process.env.OPENAI_ASSISTANT_ID!,
      // Si el tipo no permite 'stream', quita esta línea o tipa como 'any'
      // stream: true as any,
    });
  } catch (err) {
    console.error('❌ Error al llamar OpenAI:', err);
    return new Response(JSON.stringify({ error: 'AI request failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!responseStream || typeof (responseStream as any)?.body?.getReader !== 'function') {
    console.error('❌ No stream válido recibido de OpenAI');
    return new Response(JSON.stringify({ error: 'No stream' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  console.log('📡 Enviando respuesta como SSE');
  const sseStream = new ReadableStream({
    async start(controller) {
      const reader = (responseStream as any).body.getReader();
      const encoder = new TextEncoder();
      const decoder = new TextDecoder();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          console.log('📤 Chunk recibido:', chunk);
          controller.enqueue(encoder.encode(`data: ${chunk}\n\n`));
        }
        controller.close();
      } catch (err) {
        console.error('❌ Error durante el stream:', err);
        controller.error(err);
      }
    },
  });

  return new Response(sseStream, {
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