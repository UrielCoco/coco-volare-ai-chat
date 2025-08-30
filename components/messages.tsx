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
  const match = text.match(/```cv:itinerary\s*([\s\S]*?)```/i);
  if (!match) return null;
  try {
    const raw = match[1].trim();
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

function normalizeRole(role: string | undefined): 'user' | 'assistant' {
  return role === 'user' ? 'user' : 'assistant'; // "system", "tool", etc. => assistant
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
      const text: string =
        (m as any)?.parts?.[0]?.text ??
        (m as any)?.content ??
        '';
      const itin = m.role === 'assistant' ? extractItinerary(text) : extractItinerary(text); // por si llega como "system"
      return { msg: m, text: String(text || ''), itin };
    });
  }, [messages]);

  return (
    <div className="mx-auto w-full max-w-3xl px-3 py-6 space-y-3">
      {items.map(({ msg, text, itin }) =>
        itin ? (
          <ItineraryCard key={msg.id} data={itin} />
        ) : (
          <Message key={msg.id} role={normalizeRole((msg as any)?.role)} text={text} />
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
