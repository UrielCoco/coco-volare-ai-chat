'use server';

import { generateText, type UIMessage } from 'ai';
import { cookies } from 'next/headers';
import {
  deleteMessagesByChatIdAfterTimestamp,
  getMessageById,
  updateChatVisiblityById,
} from '@/lib/db/queries';
import type { VisibilityType } from '@/components/visibility-selector';
import { myProvider } from '@/lib/ai/providers';

export async function saveChatModelAsCookie(model: string) {
  const cookieStore = await cookies();
  cookieStore.set('chat-model', model);
}


export async function generateTitleFromUserMessage({
  message,
}: {
  message: UIMessage;
}) {
  // Local, sin modelo: primeras 6 palabras de la entrada
  const raw = typeof (message as any)?.content === 'string'
    ? String((message as any).content)
    : JSON.stringify(message);
  const first = raw.replace(/\s+/g, ' ').trim().slice(0, 120);
  const words = first.split(' ').slice(0, 6).join(' ');
  return words || 'Nueva conversación';
}

export async function deleteTrailingMessages({ id }: { id: string }) {
  const [message] = await getMessageById({ id });

  await deleteMessagesByChatIdAfterTimestamp({
    chatId: message.chatId,
    timestamp: message.createdAt,
  });
}

export async function updateChatVisibility({
  chatId,
  visibility,
}: {
  chatId: string;
  visibility: VisibilityType;
}) {
  await updateChatVisiblityById({ chatId, visibility });
}
