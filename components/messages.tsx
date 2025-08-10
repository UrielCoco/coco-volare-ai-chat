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
  const scrollRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);

  // Usamos la misma constante en todos lados para evitar desajustes
  const SPACER = 'calc(var(--composer-h) + env(safe-area-inset-bottom) + 20px)';

  const toBottom = () => {
    const anchor = anchorRef.current;
    const el = scrollRef.current;
    if (anchor) {
      // Respeta scrollPaddingBottom
      anchor.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
    if (el) {
      // Fallback duro por si el smooth se interrumpe
      el.scrollTop = el.scrollHeight;
    }
  };

  // Baja cuando cambia el número de mensajes o el estado de carga
  useLayoutEffect(() => {
    const id = requestAnimationFrame(() => setTimeout(toBottom, 0));
    return () => cancelAnimationFrame(id);
  }, [messages.length, isLoading]);

  // Baja mientras el contenido crece (typewriter/markdown)
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || typeof MutationObserver === 'undefined') return;
    let raf: number | null = null;
    const mo = new MutationObserver(() => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(toBottom);
    });
    mo.observe(root, { childList: true, subtree: true, characterData: true });
    return () => {
      mo.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div
      ref={scrollRef}
      className="flex flex-col flex-1 px-4 pt-4 w-full overflow-y-auto gap-3 md:gap-4"
      style={{
        // Reserva espacio para que nada quede detrás del form fijo
        paddingBottom: SPACER,
        // Hace que scrollIntoView deje holgura al fondo
        scrollPaddingBottom: SPACER,
      }}
    >
      {/* Placeholder inicial (opcional) */}
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
              // Si algún día haces scrollIntoView del propio mensaje, esto evita que quede debajo del form
              style={{ scrollMarginBottom: SPACER }}
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

      {/* Indicador "pensando…" con margen para no quedar oculto */}
      <AnimatePresence>
        {isLoading && messages.length > 0 && (
          <motion.div
            key="typing-indicator"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2 }}
            className="w-full mx-auto max-w-3xl px-4 group/message mb-3"
            style={{ marginBottom: `max(12px, env(safe-area-inset-bottom))`, scrollMarginBottom: SPACER }}
          >
            <div className="flex gap-4 w-full">
              <div className="size-8 flex items-center rounded-full justify-center ring-1 shrink-0 ring-border bg-[#000000] text-[#b69965] overflow-hidden">
                <img src="../images/Intelligence.gif" alt="..." className="w-full h-full object-cover" />
              </div>
              <div className="rounded-2xl bg-black text-white/80 border border-white/10 px-4 py-2 shadow-sm inline-flex items-center gap-1">
                <span className="animate-bounce" style={{ animationDelay: '-0.2s' }}>•</span>
                <span className="animate-bounce">•</span>
                <span className="animate-bounce" style={{ animationDelay: '0.2s' }}>•</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Spacer real al fondo para garantizar holgura visual */}
      <div style={{ height: SPACER }} />

      {/* Ancla de scroll (el target del scrollIntoView) */}
      <div ref={anchorRef} style={{ height: 1 }} />
    </div>
  );
}
