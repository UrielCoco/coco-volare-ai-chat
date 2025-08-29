'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { memo, useEffect, useState } from 'react';
import type { Vote } from '@/lib/db/schema';
import { Markdown } from './markdown';
import { MessageActions } from './message-actions';
import { Button } from './ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import { PencilEditIcon } from './icons';
import type { UseChatHelpers } from '@ai-sdk/react';
import type { ChatMessage } from '@/lib/types';
import equal from 'fast-deep-equal';
import { cn, sanitizeText } from '@/lib/utils';
import { useDataStream } from './data-stream-provider';

/* ---------- Hook: typewriter ---------- */
function useTypewriter(text: string, speed = 12) {
  const [len, setLen] = useState(0);
  useEffect(() => setLen(0), [text]);
  useEffect(() => {
    if (!text) return;
    const id = setInterval(() => setLen((n) => (n < text.length ? n + 1 : n)), Math.max(5, speed));
    return () => clearInterval(id);
  }, [text, speed]);
  return text.slice(0, len);
}

function AssistantMarkdown({ text, speed = 20 }: { text: string; speed?: number }) {
  const typed = useTypewriter(text, speed);
  return <Markdown>{typed}</Markdown>;
}

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
  useDataStream();

  // ✅ Fallback universal: si no hay parts, usamos content como part de texto
  const msgParts =
    Array.isArray((message as any).parts) && (message as any).parts.length > 0
      ? ((message as any).parts as Array<any>)
      : [{ type: 'text', text: (message as any).content ?? '' }];

  const attachmentsFromMessage = msgParts.filter((p) => p.type === 'file');

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
            'flex gap-4 w-full group-data-[role=user]/message:ml-auto group-data-[role=user]/message:max-w-2xl',
            {
              'w-full': mode === 'edit',
              'group-data-[role=user]/message:w-fit': mode !== 'edit',
            },
          )}
        >
          {message.role === 'assistant' && (
            <div className="size-8 flex items-center rounded-full justify-center ring-1 shrink-0 ring-border bg-[#000000] text-[#b69965] overflow-hidden">
              <img src="../images/Intelligence.gif" alt="Coco Volare" className="w-full h-full object-cover" />
            </div>
          )}

          <div
            className={cn('flex flex-col gap-4 w-full', {
              'min-h-96': message.role === 'assistant' && requiresScrollPadding,
            })}
          >
            {attachmentsFromMessage.length > 0 && (
              <div className="flex flex-row justify-end gap-2">
                {attachmentsFromMessage.map((attachment: any, i: number) => (
                  <a
                    key={attachment.url || `att-${i}`}
                    href={attachment.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs underline opacity-80 hover:opacity-100"
                  >
                    {attachment.filename ?? 'file'}
                  </a>
                ))}
              </div>
            )}

            {msgParts.map((part: any, index: number) => {
              if (part?.type === 'text') {
                const safe = sanitizeText(String(part?.text ?? ''));

                return (
                  <div key={`message-${message.id}-part-${index}`} className="flex flex-row gap-2 items-start">
                    {message.role === 'user' && !isReadonly && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            data-testid="message-edit-button"
                            variant="ghost"
                            className="px-2 h-fit rounded-full text-muted-foreground opacity-0 group-hover/message:opacity-100"
                            onClick={() => setMode('edit')}
                          >
                            <PencilEditIcon />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Edit message</TooltipContent>
                      </Tooltip>
                    )}

                    <div
                      data-testid="message-content"
                      className={cn(
                        'flex flex-col gap-4 px-4 py-3 rounded-2xl shadow-md leading-relaxed border border-white/10',
                        {
                          'bg-[#c5a970] text-white rounded-br-none': message.role === 'user',
                          'bg-[#000000] text-white rounded-bl-none': message.role === 'assistant',
                        },
                      )}
                    >
                      {message.role === 'assistant' ? (
                        <AssistantMarkdown text={safe} speed={20} />
                      ) : (
                        <Markdown>{safe}</Markdown>
                      )}
                    </div>
                  </div>
                );
              }
              return null;
            })}

            {/* Acciones ocultas pero presentes (para no romper lógica) */}
            {!isReadonly && (
              <div className="hidden" aria-hidden>
                <MessageActions
                  key={`action-${message.id}`}
                  chatId={chatId}
                  message={message}
                  vote={vote}
                  isLoading={isLoading}
                />
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};

export const PreviewMessage = memo(
  PurePreviewMessage,
  (prev, next) => {
    if (prev.isLoading !== next.isLoading) return false;
    if (prev.message.id !== next.message.id) return false;
    if (prev.requiresScrollPadding !== next.requiresScrollPadding) return false;
    // Comparaciones conservadoras para evitar rerenders
    return true;
  },
);
