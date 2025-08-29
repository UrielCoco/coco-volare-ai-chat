'use client';

import cx from 'classnames';
import { AnimatePresence, motion } from 'framer-motion';
import { memo, useState, useEffect } from 'react';
// ❌ quitamos los tipos estrictos de @ai-sdk/react
// import type { UseChatHelpers } from '@ai-sdk/react';
import type { ChatMessage, Itinerary } from '@/lib/types';
import equal from 'fast-deep-equal';
import { Markdown } from './markdown';
import { Button } from './ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import { PencilEditIcon } from './icons';
import { cn, sanitizeText } from '@/lib/utils';

/* ---------- Hook: escribe como máquina para el asistente ---------- */
function useTypewriter(text: string, speed = 12) {
  const [len, setLen] = useState(0);
  useEffect(() => { setLen(0); }, [text]);
  useEffect(() => {
    if (!text) return;
    const id = setInterval(() => setLen((n) => (n < text.length ? n + 1 : n)), Math.max(5, speed));
    return () => clearInterval(id);
  }, [text, speed]);
  return text.slice(0, len);
}
function AssistantMarkdown({ text, speed = 18 }: { text: string; speed?: number }) {
  const typed = useTypewriter(text, speed);
  return <Markdown>{typed}</Markdown>;
}

/* ---------- UI: Tarjeta de Itinerario (tabs + timeline) ---------- */
type ItinItem = Itinerary['days'][number]['items'][number];
type ItinDay = Itinerary['days'][number];

function IconByType({ t }: { t?: string }) {
  const map: Record<string, string> = {
    flight: '✈️',
    transfer: '🚐',
    meal: '🍽️',
    hotel: '🏨',
    activity: '🎟️',
    ticket: '🎫',
  };
  return <span className="mr-2">{map[t ?? ''] ?? '📍'}</span>;
}

function ItineraryCard({ itin }: { itin: Itinerary }) {
  const [idx, setIdx] = useState(0);
  const days = Array.isArray(itin.days) ? itin.days : [];
  const sel: ItinDay = days[idx] ?? { items: [] as ItinItem[] };

  return (
    <div className="w-full">
      {itin.tripTitle && (
        <h3 className="text-lg md:text-xl font-semibold text-white mb-2">{itin.tripTitle}</h3>
      )}
      {/* Tabs */}
      <div className="flex gap-2 overflow-x-auto pb-2">
        {days.map((d, i) => {
          const label = d.title || (d.day ? `Día ${d.day}` : `Día ${i + 1}`);
          return (
            <button
              key={`tab-${i}`}
              onClick={() => setIdx(i)}
              className={cx(
                'px-3 py-1 rounded-full border text-sm whitespace-nowrap transition',
                i === idx
                  ? 'bg-[#b69965] text-black border-[#b69965]'
                  : 'bg-transparent text-white border-white/20 hover:border-white/40'
              )}
            >
              {label}{d.date ? ` — ${d.date}` : ''}
            </button>
          );
        })}
      </div>

      {/* Timeline */}
      <div className="mt-3 md:mt-4">
        {sel.items?.length ? (
          <ul className="relative pl-5">
            <div className="absolute left-2 top-0 bottom-0 w-px bg-white/15" />
            {sel.items.map((it, k) => (
              <li key={`it-${k}`} className="relative mb-3 md:mb-4">
                <div className="absolute -left-0.5 top-1 size-2 rounded-full bg-[#b69965]" />
                <div className="rounded-xl bg-black text-white border border-white/10 p-3">
                  <div className="flex items-start gap-2">
                    <IconByType t={it.type} />
                    <div className="flex-1">
                      <div className="flex items-baseline gap-2">
                        <h4 className="font-medium">{it.title}</h4>
                        {it.time && <span className="text-xs text-white/60">{it.time}</span>}
                        {it.location && <span className="text-xs text-white/60">· {it.location}</span>}
                      </div>
                      {it.notes && <p className="text-sm text-white/80 mt-1 whitespace-pre-wrap">{it.notes}</p>}
                      {'price' in it && it.price && (
                        <div className="text-xs text-white/60 mt-1">
                          Estimado: <span className="text-white/80">{String(it.price)}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-white/70 text-sm">Sin actividades registradas.</div>
        )}
      </div>
    </div>
  );
}

/* ---------- Mensaje ---------- */
// 👉 relajamos tipos de helpers para NO arrastrar la restricción UIMessage<...>
type SetMessagesFn = (updater: { messages: ChatMessage[] }) => void;

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
  vote?: any;
  isLoading: boolean;
  setMessages: SetMessagesFn;
  regenerate: () => Promise<void> | void;
  isReadonly: boolean;
  requiresScrollPadding: boolean;
}) => {
  const [mode, setMode] = useState<'view' | 'edit'>('view');

  const attachmentsFromMessage = message.parts.filter((p: any) => p.type === 'file');

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
            { 'w-full': mode === 'edit', 'group-data-[role=user]/message:w-fit': mode !== 'edit' },
          )}
        >
          {message.role === 'assistant' && (
            <div className="size-8 flex items-center rounded-full justify-center ring-1 shrink-0 ring-border bg-[#000000] text-[#b69965] overflow-hidden">
              <img src="../images/Intelligence.gif" alt="Coco Volare" className="w-full h-full object-cover" />
            </div>
          )}

          <div className={cn('flex flex-col gap-4 w-full', { 'min-h-96': message.role === 'assistant' && requiresScrollPadding })}>
            {attachmentsFromMessage.length > 0 && (
              <div className="flex flex-row justify-end gap-2">
                {attachmentsFromMessage.map((a: any, i: number) => (
                  <a
                    key={i}
                    href={a.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs underline text-white/80"
                  >
                    {a.filename ?? 'archivo'} ({a.mediaType})
                  </a>
                ))}
              </div>
            )}

            {message.parts.map((part: any, index: number) => {
              const key = `message-${message.id}-part-${index}`;

              // 🗺️ Itinerario
              if (part.type === 'itinerary' && part.itinerary) {
                return (
                  <div key={key} className="flex flex-row gap-2 items-start">
                    <div
                      data-testid="message-content"
                      className={cn(
                        'flex flex-col gap-4 px-3 py-3 rounded-2xl leading-relaxed',
                        'bg-[#000000] text-white rounded-bl-none border border-white/10'
                      )}
                    >
                      <ItineraryCard itin={part.itinerary as Itinerary} />
                    </div>
                  </div>
                );
              }

              // 💬 Texto normal
              if (part.type === 'text' && typeof part.text === 'string') {
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
                        <TooltipContent>Editar</TooltipContent>
                      </Tooltip>
                    )}

                    <div
                      data-testid="message-content"
                      className={cn(
                        'flex flex-col gap-4 px-4 py-3 rounded-2xl shadow-md leading-relaxed',
                        {
                          'bg-[#c5a970] text-white rounded-br-none border border-[#c5a970]/40': message.role === 'user',
                          'bg-[#000000] text-white rounded-bl-none border border-white/10': message.role === 'assistant',
                        }
                      )}
                    >
                      {message.role === 'assistant'
                        ? <AssistantMarkdown text={safe} />
                        : <Markdown>{safe}</Markdown>}
                    </div>
                  </div>
                );
              }

              return null;
            })}
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
    if (!equal(prev.message.parts, next.message.parts)) return false;
    return true;
  },
);
