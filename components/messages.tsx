'use client';

import Message from './message';
import ItineraryCard from './ItineraryCard';
import type { ChatMessage } from '@/lib/types';
import { useMemo } from 'react';

type SetMessagesFn = (updater: { messages: ChatMessage[] }) => void;

interface Props {
  messages: ChatMessage[];
  isLoading: boolean;
  setMessages: SetMessagesFn;
  regenerate: () => Promise<void> | void;
  isReadonly: boolean;
  chatId: string;
  votes?: any[];
}

function extractItinerary(text: string): any | null {
  if (!text) return null;
  // Busca bloque: ```cv:itinerary\n{...}\n```
  const match = text.match(/```cv:itinerary\s*([\s\S]*?)```/i);
  if (!match) return null;
  try {
    const raw = match[1].trim();
    // Si viene con fences internas, intenta recortar
    const jsonStart = raw.indexOf('{');
    const jsonEnd = raw.lastIndexOf('}');
    if (jsonStart >= 0 && jsonEnd > jsonStart) {
      const jsonStr = raw.slice(jsonStart, jsonEnd + 1);
      return JSON.parse(jsonStr);
    }
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export default function Messages({
  messages,
  isLoading,
  setMessages,
  regenerate,
  isReadonly,
  chatId,
}: Props) {
  const items = useMemo(() => {
    return messages.map((m) => {
      const text = (m as any)?.parts?.[0]?.text || '';
      const itin = m.role === 'assistant' ? extractItinerary(text) : null;
      return { msg: m, text, itin };
    });
  }, [messages]);

  return (
    <div className="mx-auto w-full max-w-3xl px-3 py-6 space-y-3">
      {/* Fondo/hero antes de iniciar podría estar en tu layout global; aquí solo mensajes */}
      {items.map(({ msg, text, itin }) =>
        itin ? (
          <ItineraryCard key={msg.id} data={itin} />
        ) : (
          <Message key={msg.id} role={msg.role} text={text} />
        )
      )}

      {isLoading && (
        <div className="w-full flex justify-start">
          <div className="max-w-[80%] rounded-2xl px-4 py-3 bg-black/80 text-white shadow">
            <span className="opacity-80">pensando…</span>
          </div>
        </div>
      )}
    </div>
  );
}
