'use client';

import type { ChatMessage } from '@/lib/types';

function toText(msg: ChatMessage): string {
  // Soporta ambos esquemas: content o parts
  const anyMsg = msg as any;
  if (typeof anyMsg.content === 'string') return anyMsg.content;

  const parts = (anyMsg.parts ?? []) as Array<{ type: string; text?: string }>;
  return parts
    .map((p) => (p && p.type === 'text' ? (p.text ?? '') : ''))
    .join('\n')
    .trim();
}

export default function Message({ item }: { item: ChatMessage }) {
  const text = toText(item) || ' ';
  const isAssistant = item.role === 'assistant';

  return (
    <div className="w-full">
      <div
        className={`mx-auto max-w-3xl px-4 py-3 whitespace-pre-wrap leading-relaxed ${
          isAssistant ? 'text-white' : 'text-white/90'
        }`}
      >
        {text}
      </div>
    </div>
  );
}
