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
        {messages.length === 0 && (
          <div className="flex-1 flex flex-col items-center justify-center gap-4">
            <img src="/images/Intelligence.gif" alt="Coco Volare Intelligence" className="opacity-80 max-h-[25dvh]" />
            <img src="/images/Texts.gif" alt="Coco Volare" className="opacity-70 max-h-[40dvh]" />
          </div>
        )}

        <AnimatePresence mode="popLayout">
          {messages.map((message) => (
            <motion.div
              key={(message as any).id}
              className="chat-message"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              transition={{ duration: 0.25 }}
              style={{ scrollMarginBottom: SPACER }}
            >
              <PreviewMessage message={message as any} />
            </motion.div>
          ))}
        </AnimatePresence>

        {/* typing bubble (ÚNICA) */}
        <AnimatePresence>
          {isLoading && messages.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.2 }}
              className="w-full mx-auto max-w-4xl px-4"
            >
              <div className="inline-flex items-center gap-3 rounded-2xl bg-[#131313] px-5 py-4 shadow-[0_14px_32px_-14px_rgba(0,0,0,0.55)]">
                <img src="/images/Intelligence.gif" alt="pensando" className="h-6 w-6" />
                <div className="flex items-center gap-1">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-white animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-white animate-bounce" style={{ animationDelay: '120ms' }} />
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-white animate-bounce" style={{ animationDelay: '240ms' }} />
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
