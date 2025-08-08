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
  const scrollAnchorRef = useRef<HTMLDivElement>(null);

  // ✅ Autoscroll suave al final
  useEffect(() => {
    const anchor = scrollAnchorRef.current;
    if (anchor) {
      anchor.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isLoading]);

  return (
    <div
      ref={messagesRef}
      className="flex flex-col gap-3 md:gap-4 py-4 px-4 overflow-y-auto w-full pb-[96px]"
      style={{ maxHeight: 'calc(100vh - 200px)' }}
    >

      {/* 📌 Placeholder inicial */}
      <AnimatePresence>
        {messages.length === 0 && !isLoading && (
          <motion.div
            key="initial-placeholder"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2 }}
            className="mx-auto my-10 max-w-xl text-center text-sm md:text-base 
                       rounded-xl 
                       px-4 py-3 backdrop-blur"
          >
            <p className="font-small justify-center">Coco Volare</p>
            <p className="font-small justify-center">Intelligence</p>
            <p className=" font-small mt-1 opacity-90">
              Hello! / ¡Hola!
              <div className="flex justify-center py-2">
                <img src="../images/thinking.gif" alt="..." className=" opacity-80" />
              </div>
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence mode="popLayout">
        {messages.map((message) => {
          const vote = votes.find((v) => v.messageId === message.id);

          return (
            <motion.div
              key={message.id}
              className="chat-message"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              transition={{ duration: 0.3 }}
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

      {/* ✅ Este div asegura que el scroll llegue hasta abajo */}
      <div ref={scrollAnchorRef} />
    </div>
  );
}
