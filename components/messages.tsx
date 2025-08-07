'use client';

import { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { PreviewMessage } from './message';
import type { ChatMessage } from '@/lib/types';
import type { Vote } from '@/lib/db/schema';
import type { UseChatHelpers } from '@ai-sdk/react';

interface Props {
  messages: ChatMessage[];
  isLoading: boolean;
  votes: Vote[];
  setMessages: UseChatHelpers<ChatMessage>['setMessages'];
  regenerate: UseChatHelpers<ChatMessage>['regenerate'];
  isReadonly: boolean;
  chatId: string;
}

export default function Messages({
  messages,
  isLoading,
  votes,
  setMessages,
  regenerate,
  isReadonly,
  chatId,
}: Props) {
  const messagesRef = useRef<HTMLDivElement>(null);

  // Autoscroll al final de los mensajes
  useEffect(() => {
    const el = messagesRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, isLoading]);

  return (
    <div
      ref={messagesRef}
      className="flex flex-col gap-6 px-6 pt-6 pb-10 overflow-y-auto w-full bg-gray-50 dark:bg-zinc-900"
      style={{ maxHeight: 'calc(100vh - 200px)' }}
    >
      <AnimatePresence mode="popLayout">
        {messages.map((message) => {
          const vote = votes.find((v) => v.messageId === message.id);

          return (
            <motion.div
              key={message.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              transition={{ type: 'spring', stiffness: 180, damping: 16 }}
              className="w-full flex"
            >
              <PreviewMessage
                key={message.id}
                message={message}
                chatId={chatId}
                vote={vote}
                isLoading={isLoading}
                setMessages={setMessages}
                regenerate={regenerate}
                isReadonly={isReadonly}
                requiresScrollPadding={false}
              />
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
