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

  // 🔽 Función central para bajar al final
  const scrollToBottom = () => {
    const anchor = scrollAnchorRef.current;
    const parent = messagesRef.current;
    if (anchor) anchor.scrollIntoView({ behavior: 'smooth', block: 'end' });
    if (parent) parent.scrollTop = parent.scrollHeight;
  };

  // ✅ Autoscroll al añadir mensajes / cambiar loading
  useLayoutEffect(() => {
    const raf = requestAnimationFrame(() => setTimeout(scrollToBottom, 0));
    return () => cancelAnimationFrame(raf);
  }, [messages.length, isLoading]);

  // ✅ Observa cambios en DOM (streaming / typewriter) y baja
  useEffect(() => {
    const root = messagesRef.current;
    if (!root || typeof MutationObserver === 'undefined') return;

    let rafId: number | null = null;
    const onMutate = () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(scrollToBottom);
    };

    const mo = new MutationObserver(onMutate);
    mo.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    return () => {
      mo.disconnect();
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, []);

  return (
    <div
      ref={messagesRef}
      className="flex flex-col flex-1 px-4 pt-4 w-full overflow-y-auto gap-3 md:gap-4"
      style={{
        // Reserva el espacio del composer + safe area
        paddingBottom: 'calc(var(--composer-h) + env(safe-area-inset-bottom) + 12px)',
        // Para que scrollIntoView respete el espacio del composer
        scrollPaddingBottom: 'calc(var(--composer-h) + env(safe-area-inset-bottom) + 12px)',
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

      {/* ✅ Ancla de scroll */}
      <div ref={scrollAnchorRef} style={{ height: 1 }} />
    </div>
  );
}
