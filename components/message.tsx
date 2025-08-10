'use client';

import cx from 'classnames';
import { AnimatePresence, motion } from 'framer-motion';
import { memo, useState, useEffect } from 'react';
import type { Vote } from '@/lib/db/schema';
import { DocumentToolCall, DocumentToolResult } from './document';
import { PencilEditIcon, SparklesIcon } from './icons';
import { Markdown } from './markdown';
import { MessageActions } from './message-actions';
import { PreviewAttachment } from './preview-attachment';
import { Weather } from './weather';
import equal from 'fast-deep-equal';
import { cn, sanitizeText } from '@/lib/utils';
import { Button } from './ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import { MessageEditor } from './message-editor';
import { DocumentPreview } from './document-preview';
import { MessageReasoning } from './message-reasoning';
import type { UseChatHelpers } from '@ai-sdk/react';
import type { ChatMessage } from '@/lib/types';
import { useDataStream } from './data-stream-provider';

/* ---------- Hook: devuelve STRING para cumplir con <Markdown>{string}</Markdown> ---------- */
function useTypewriter(text: string, speed = 12) {
  const [len, setLen] = useState(0);

  useEffect(() => {
    setLen(0);
  }, [text]);

  useEffect(() => {
    if (!text) return;
    const id = setInterval(() => {
      setLen((n) => (n < text.length ? n + 1 : n));
    }, Math.max(5, speed));
    return () => clearInterval(id);
  }, [text, speed]);

  return text.slice(0, len); // ← SIEMPRE string
}

/* ---------- Wrapper: usa el hook y pasa STRING a Markdown ---------- */
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
  const attachmentsFromMessage = message.parts.filter((part) => part.type === 'file');
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
            'flex gap-4 w-full group-data-[role=user]/message:ml-auto group-data-[role=user]/message:max-w-2xl',
            {
              'w-full': mode === 'edit',
              'group-data-[role=user]/message:w-fit': mode !== 'edit',
            },
          )}
        >
          {message.role === 'assistant' && (
            <div className="size-8 flex items-center rounded-full justify-center ring-1 shrink-0 ring-border bg-[#000000] text-[#b69965]">
              <img
                src="../images/thinking.gif"
                alt="Coco Volare"
                className="w-full h-full object-cover"
              />
            </div>
          )}

          <div
            className={cn('flex flex-col gap-4 w-full', {
              'min-h-96': message.role === 'assistant' && requiresScrollPadding,
            })}
          >
            {attachmentsFromMessage.length > 0 && (
              <div className="flex flex-row justify-end gap-2">
                {attachmentsFromMessage.map((attachment) => (
                  <PreviewAttachment
                    key={attachment.url}
                    attachment={{
                      name: attachment.filename ?? 'file',
                      contentType: attachment.mediaType,
                      url: attachment.url,
                    }}
                  />
                ))}
              </div>
            )}

            {message.parts.map((part, index) => {
              const { type } = part;
              const key = `message-${message.id}-part-${index}`;

              if (type === 'text' && part.text && typeof part.text === 'string') {
                const safe = sanitizeText(part.text);

                return (
                  <div key={key} className="flex flex-row gap-2 items-start">
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
                        'flex flex-col gap-4 px-4 py-3 rounded-2xl shadow-md leading-relaxed',
                        {
                          'bg-[#c5a970] text-white rounded-br-none': message.role === 'user',
                          'bg-[#000000] text-white rounded-bl-none': message.role === 'assistant',
                        }
                      )}
                    >
                      {message.role === 'assistant' ? (
                        // 👇 Aquí ya pasamos STRING a Markdown (no ReactNode)
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

            {/* Ocultamos las acciones visualmente sin alterar lógica */}
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
  (prevProps, nextProps) => {
    if (prevProps.isLoading !== nextProps.isLoading) return false;
    if (prevProps.message.id !== nextProps.message.id) return false;
    if (prevProps.requiresScrollPadding !== nextProps.requiresScrollPadding) return false;
    if (!equal(prevProps.message.parts, nextProps.message.parts)) return false;
    if (!equal(prevProps.vote, nextProps.vote)) return false;
    return true;
  },
);
