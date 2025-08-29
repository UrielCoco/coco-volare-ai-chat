'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { PreviewMessage } from './message';
import type { ChatMessage } from '@/lib/types';
// ❌ quitamos tipos estrictos de @ai-sdk/react
// import type { UseChatHelpers } from '@ai-sdk/react';

interface Props {
  messages: ChatMessage[];
  isLoading: boolean;
  votes?: any[];
  // relajamos tipos para no heredar restricción UIMessage<...>
  setMessages: (updater: { messages: ChatMessage[] }) => void;
  regenerate: () => Promise<void> | void;
  isReadonly: boolean;
  chatId: string;
}

export default function Messages({
  messages,
  isLoading,
  votes = [],
  setMessages,
  regenerate,
  isReadonly,
  chatId,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);

  const SPACER = 'calc(var(--composer-h) + env(safe-area-inset-bottom) + 20px)';

  const toBottom = () => {
    const anchor = anchorRef.current;
    const el = scrollRef.current;
    if (anchor) anchor.scrollIntoView({ behavior: 'smooth', block: 'end' });
    if (el) el.scrollTop = el.scrollHeight;
  };

  useLayoutEffect(() => {
    const id = requestAnimationFrame(() => setTimeout(toBottom, 0));
    return () => cancelAnimationFrame(id);
  }, [messages.length, isLoading]);

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

  const showBackdrop = messages.length === 0 && !isLoading;

  return (
    <div className="relative flex-1 min-h-0">
      {/* 🎬 Backdrop con GIF antes de iniciar */}
      <AnimatePresence>
        {showBackdrop && (
          <motion.div
            key="cv-backdrop"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="pointer-events-none absolute inset-0 -z-10"
          >
            <img src="../images/Texts.gif" alt="Bienvenido a Coco Volare AI" className="w-full h-full object-cover opacity-80" />
            <div className="absolute inset-0 bg-[linear-gradient(to_top,rgba(0,0,0,0.6),transparent_30%)]" />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Contenedor de mensajes */}
      <div
        ref={scrollRef}
        className="relative flex flex-col px-4 pt-4 w-full h-full overflow-y-auto gap-3 md:gap-4"
        style={{ paddingBottom: SPACER, scrollPaddingBottom: SPACER }}
      >
        <AnimatePresence mode="popLayout">
          {messages.map((message) => {
            const vote = votes.find?.((v) => v?.messageId === message.id);
            return (
              <motion.div
                key={message.id}
                className="chat-message"
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}
                transition={{ duration: 0.25 }}
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

        {/* Indicador "pensando…" */}
        <AnimatePresence>
          {isLoading && messages.length > 0 && (
            <motion.div
              key="typing-indicator"
              initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
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

        <div style={{ height: SPACER }} />
        <div ref={anchorRef} style={{ height: 1 }} />
      </div>
    </div>
  );
}
