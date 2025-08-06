export const runtime = 'nodejs';

import {
  convertToModelMessages,
  createUIMessageStream,
  JsonToSseTransformStream,
  smoothStream,
  stepCountIs,
  streamText,
} from 'ai';

import { runAssistantWithStream } from '@/lib/ai/providers/openai-assistant';
import { auth, type UserType } from '@/app/(auth)/auth';
import { type RequestHints, systemPrompt } from '@/lib/ai/prompts';
import {
  createStreamId,
  deleteChatById,
  getChatById,
  getMessageCountByUserId,
  getMessagesByChatId,
  saveChat,
  saveMessages,
} from '@/lib/db/queries';
import { convertToUIMessages, generateUUID } from '@/lib/utils';
import { generateTitleFromUserMessage } from '../../actions';
import { createDocument } from '@/lib/ai/tools/create-document';
import { updateDocument } from '@/lib/ai/tools/update-document';
import { requestSuggestions } from '@/lib/ai/tools/request-suggestions';
import { getWeather } from '@/lib/ai/tools/get-weather';
import { isProductionEnvironment } from '@/lib/constants';
import { myProvider } from '@/lib/ai/providers';
import { entitlementsByUserType } from '@/lib/ai/entitlements';
import { postRequestBodySchema, type PostRequestBody } from './schema';
import { ChatSDKError } from '@/lib/errors';
import type { ChatMessage } from '@/lib/types';
import type { ChatModel } from '@/lib/ai/models';
import type { VisibilityType } from '@/components/visibility-selector';

export const maxDuration = 60;

async function getLocationFromIP(request: Request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || '';
  if (!ip) return {};

  try {
    const res = await fetch(`https://ipapi.co/${ip}/json/`);
    if (!res.ok) return {};
    const data = await res.json();

    return {
      city: data.city,
      country: data.country_name,
      latitude: data.latitude,
      longitude: data.longitude,
    };
  } catch (err) {
    console.warn('Error fetching geolocation:', err);
    return {};
  }
}

export async function POST(request: Request) {
  let requestBody: PostRequestBody;

  try {
    const json = await request.json();
    requestBody = postRequestBodySchema.parse(json);
  } catch (_) {
    return new ChatSDKError('bad_request:api').toResponse();
  }

  try {
    const {
      id,
      message,
      selectedChatModel,
      selectedVisibilityType,
    }: {
      id: string;
      message: ChatMessage;
      selectedChatModel: ChatModel['id'];
      selectedVisibilityType: VisibilityType;
    } = requestBody;

    const session = await auth();
    if (!session?.user)
      return new ChatSDKError('unauthorized:chat').toResponse();

    const userType: UserType = session.user.type;
    const messageCount = await getMessageCountByUserId({
      id: session.user.id,
      differenceInHours: 24,
    });

    if (messageCount > entitlementsByUserType[userType].maxMessagesPerDay) {
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
    } else {
      if (chat.userId !== session.user.id) {
        return new ChatSDKError('forbidden:chat').toResponse();
      }
    }

    const messagesFromDb = await getMessagesByChatId({ id });
    const uiMessages = [...convertToUIMessages(messagesFromDb), message];

    const { longitude, latitude, city, country } = await getLocationFromIP(request);

    const requestHints: RequestHints = {
      longitude,
      latitude,
      city,
      country,
    };

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

    const stream = createUIMessageStream({
      execute: async ({ writer: dataStream }) => {
        try {
          if (selectedChatModel === 'assistant-openai') {
            const assistantId = process.env.OPENAI_ASSISTANT_ID!;
            const firstPart = message.parts[0];
            const userInput =
              typeof firstPart === 'string'
                ? firstPart
                : typeof firstPart?.text === 'string'
                ? firstPart.text
                : '';

            const assistantResponse = await runAssistantWithStream({
              userInput,
              assistantId,
            });

            if (!assistantResponse) {
              throw new Error('No response from assistant');
            }

            dataStream.sendData({
              id: generateUUID(),
              role: 'assistant',
              content: [
                {
                  type: 'text',
                  text: assistantResponse,
                },
              ],
            });

            dataStream.close();
          } else {
            const result = streamText({
              model: myProvider.languageModel(selectedChatModel),
              system: systemPrompt({ selectedChatModel, requestHints }),
              messages: convertToModelMessages(uiMessages),
              stopWhen: stepCountIs(5),
              experimental_activeTools:
                selectedChatModel === 'chat-model-reasoning'
                  ? []
                  : ['getWeather', 'createDocument', 'updateDocument', 'requestSuggestions'],
              experimental_transform: smoothStream({ chunking: 'word' }),
              tools: {
                getWeather,
                createDocument: createDocument({ session, dataStream }),
                updateDocument: updateDocument({ session, dataStream }),
                requestSuggestions: requestSuggestions({ session, dataStream }),
              },
              experimental_telemetry: {
                isEnabled: isProductionEnvironment,
                functionId: 'stream-text',
              },
            });

            result.consumeStream();

            dataStream.merge(
              result.toUIMessageStream({
                sendReasoning: true,
              })
            );
          }
        } catch (e) {
          console.error('❌ Error interno durante el stream:', e);
          throw e;
        }
      },
      generateId: generateUUID,
      onFinish: async ({ messages }) => {
        await saveMessages({
          messages: messages.map((message) => ({
            id: message.id,
            role: message.role,
            parts: message.parts,
            createdAt: new Date(),
            attachments: [],
            chatId: id,
          })),
        });
      },
      onError: () => {
        return 'Oops, an error occurred!';
      },
    });

    if (!stream) {
      return new Response(
        JSON.stringify({ error: 'No stream generated.' }),
        { status: 204, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(stream.pipeThrough(new JsonToSseTransformStream()));
  } catch (error) {
    console.error('❌ ERROR en /api/chat:', error);

    if (error instanceof ChatSDKError) {
      return error.toResponse();
    }

    if ((error as Error)?.message?.includes('rate limit')) {
      return new Response(
        JSON.stringify({
          error: 'Rate Limit Exceeded',
          message: (error as Error)?.message,
        }),
        { status: 429, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({
        error: 'Internal Server Error',
        message: (error as Error)?.message || 'Unexpected error',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
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
