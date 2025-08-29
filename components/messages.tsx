'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { PreviewMessage } from './message';
import type { ChatMessage } from '@/lib/types';

type SetMessagesFn = (updater: { messages: ChatMessage[] }) => void;
type RegenerateFn = () => Promise<void> | void;

interface Props {
  messages: ChatMessage[];
  isLoading: boolean;
  votes?: any[];
  setMessages: SetMessagesFn;
  regenerate: RegenerateFn;
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

  return (
    <div className="relative flex-1 min-h-0">
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
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
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

        {/* 3 puntos animados cuando está pensando */}
        <AnimatePresence>
          {isLoading && messages.length > 0 && (
            <motion.div
              key="typing"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.2 }}
              className="w-full mx-auto max-w-3xl px-4 mb-3"
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
