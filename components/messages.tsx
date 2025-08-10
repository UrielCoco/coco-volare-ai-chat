'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';
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

  // Autoscroll robusto: después de pintar el DOM
  useLayoutEffect(() => {
    const toBottom = () => {
      const anchor = scrollAnchorRef.current;
      if (!anchor) return;
      anchor.scrollIntoView({ behavior: 'smooth', block: 'end' });
      const parent = messagesRef.current;
      if (parent) parent.scrollTop = parent.scrollHeight;
    };

    const raf = requestAnimationFrame(() => setTimeout(toBottom, 0));
    return () => cancelAnimationFrame(raf);
  }, [messages.length, isLoading]);

  return (
    <div
      ref={messagesRef}
      className="flex flex-col flex-1 px-4 pt-4 w-full overflow-y-auto gap-3 md:gap-4"
      style={{
        paddingBottom: 'calc(var(--composer-h) + env(safe-area-inset-bottom) + 12px)',
      }}
    >
      {/* …tu placeholder y lista de mensajes igual que antes… */}

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

      {/* Ancla de scroll */}
      <div ref={scrollAnchorRef} style={{ height: 1 }} />
    </div>
  );
}
