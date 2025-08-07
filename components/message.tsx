
'use client';

import cx from 'classnames';
import { AnimatePresence, motion } from 'framer-motion';
import { memo, useState } from 'react';
import type { Vote } from '@/lib/db/schema';
import { Markdown } from './markdown';
import type { UseChatHelpers } from '@ai-sdk/react';
import type { ChatMessage } from '@/lib/types';
import { useDataStream } from './data-stream-provider';
import Image from 'next/image';
import { cn } from '@/lib/utils';

const PurePreviewMessage = ({
  chatId,
  message,
  vote,
  isLoading,
  setMessages,
  regenerate,
  isReadonly,
  requiresScrollPadding,
}: {
  chatId: string;
  message: ChatMessage;
  vote: Vote | undefined;
  isLoading: boolean;
  setMessages: UseChatHelpers<ChatMessage>['setMessages'];
  regenerate: UseChatHelpers<ChatMessage>['regenerate'];
  isReadonly: boolean;
  requiresScrollPadding: boolean;
}) => {
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const isAssistant = message.role === 'assistant';
  const isUser = message.role === 'user';
  useDataStream();

  return (
    <AnimatePresence>
      <motion.div
        data-testid={`message-${message.role}`}
        className="w-full mx-auto max-w-3xl px-4 group/message"
        initial={{ y: 5, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        data-role={message.role}
      >
        <div
          className={cn(
            'flex w-fit max-w-[85%] px-4 py-3 rounded-xl shadow-md mb-3',
            isAssistant && 'bg-black text-white rounded-bl-none',
            isUser && 'bg-[#c5a970] text-white self-end ml-auto rounded-br-none'
          )}
        >
          {isAssistant && isLoading ? (
            <Image
              src="/thinking.gif"
              alt="Thinking..."
              width={60}
              height={60}
              className="mx-auto"
            />
          ) : (
            <Markdown content={message.parts.map(p => p.text).join('')} />
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
};

export const PreviewMessage = memo(PurePreviewMessage, (prev, next) =>
  prev.message === next.message && prev.isLoading === next.isLoading
);
