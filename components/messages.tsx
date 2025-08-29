'use client';

import { memo } from 'react';
import type { ChatMessage } from '@/lib/types';

function Bubble({ m }: { m: ChatMessage }) {
  const isAssistant = m.role === 'assistant';
  const text =
    m.content?.map((c) => (c.type === 'text' ? c.text?.value ?? '' : '')).join('') ?? '';

  return (
    <div className={`w-full flex ${isAssistant ? 'justify-start' : 'justify-end'}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-3 leading-relaxed whitespace-pre-wrap
          ${isAssistant
            ? 'bg-black text-white border border-yellow-500/30'
            : 'bg-yellow-500 text-black border border-yellow-500/50'
          }`}
      >
        {text || (isAssistant ? '…' : '')}
      </div>
    </div>
  );
}

function MessagesBase({
  messages,
  isLoading,
}: {
  messages: ChatMessage[];
  isLoading: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      {messages.length === 0 && !isLoading && (
        <div className="text-center my-8 opacity-70">
          <p className="text-sm">Coco Volare AI listo para ayudarte ✨</p>
        </div>
      )}

      {messages.map((m) => (
        <Bubble key={m.id} m={m} />
      ))}

      {isLoading && (
        <div className="w-full flex justify-start">
          <div className="max-w-[85%] rounded-2xl px-4 py-3 bg-black text-white border border-yellow-500/30">
            pensando…
          </div>
        </div>
      )}
    </div>
  );
}

export default memo(MessagesBase);
