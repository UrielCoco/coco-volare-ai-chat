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
      className="flex flex-col flex-1 px-4 pt-4 w-full overflow-y-auto gap-3 md:gap-4"
      style={{
        paddingBottom: 'var(--composer-h)', // igual a la altura real del composer
      }}
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
            className="mx-auto my-20 max-w-xl text-center text-sm md:text-base rounded-xl px-4 py-3 backdrop-blur"
          >
            <p className="font-medium">www.CocoVolare.com</p>
            
            <img
              src="../images/Texts.gif"
              alt="..."
              className="block mx-auto w-2/3 h-auto p-4 opacity-100"
            />
            <p className="font-medium"></p>
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

      {/* ✨ Indicador de "escribiendo…" */}
      <AnimatePresence>
        {isLoading && messages.length > 0 && (
          <motion.div
            key="typing-indicator"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2 }}
            className="w-full mx-auto max-w-3xl px-4 group/message"
          >
            <div className="flex gap-4 w-full">
              {/* Avatar igual que en message.tsx */}
              <div className="size-8 flex items-center rounded-full justify-center ring-1 shrink-0 ring-border bg-[#000000] text-[#b69965] overflow-hidden">
                <img
                  src="../images/thinking.gif"
                  alt="..."
                  className="w-full h-full object-cover"
                />
              </div>

              {/* Burbuja de puntos */}
              <div className="rounded-2xl bg-black text-white/80 border border-white/10 px-4 py-2 shadow-sm inline-flex items-center gap-1">
                <span className="animate-bounce" style={{ animationDelay: '-0.2s' }}>•</span>
                <span className="animate-bounce">•</span>
                <span className="animate-bounce" style={{ animationDelay: '0.2s' }}>•</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ✅ Ancla de scroll */}
      <div ref={scrollAnchorRef} />
    </div>
  );
}
