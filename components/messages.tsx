'use client';

import { cn } from '@/lib/utils';
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { useChatContext } from '@/context/chat-context';
import { ChatMessage } from '@/lib/types';
import Message from './message';

interface Props {
  messages: ChatMessage[];
  isLoading?: boolean;
}

export default function Messages({ messages, isLoading }: Props) {
  const { chatMessages } = useChatContext();
  const pathname = usePathname();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    containerRef.current?.scrollTo({
      top: containerRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [chatMessages, pathname]);

  return (
    <div
      ref={containerRef}
      className={cn(
        'flex flex-1 flex-col gap-4 overflow-auto px-4 pb-4 pt-2 md:px-6 md:pt-4',
      )}
    >
      <AnimatePresence initial={false}>
        {messages.map((message, i) => (
          <motion.div
            key={message.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ duration: 0.25 }}
          >
            <Message message={message} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
