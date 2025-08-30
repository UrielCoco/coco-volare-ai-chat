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

/** Normaliza comillas “ ” ‘ ’ a comillas ASCII */
function normalizeSmartQuotes(s: string) {
  return s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
}

/** Extrae un objeto JSON balanceando llaves desde el índice dado. */
function extractBalancedJsonFrom(text: string, startBraceIndex: number): any | null {
  let depth = 0;
  for (let i = startBraceIndex; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        const raw = text.slice(startBraceIndex, i + 1);
        try {
          return JSON.parse(raw);
        } catch {
          try {
            return JSON.parse(normalizeSmartQuotes(raw));
          } catch {
            return null;
          }
        }
      }
    }
  }
  return null;
}

/**
 * Parser robusto:
 * - ```cv:itinerary\n{...}\n``` (con fences)
 * - `cv:itinerary` seguido del JSON sin fences
 * - fallback: cualquier bloque ```json ... ```
 */
function extractItinerary(rawText: string): any | null {
  if (!rawText) return null;

  const s = normalizeSmartQuotes(rawText);

  // 1) Fence ```cv:itinerary
  const fenceTag = '```cv:itinerary';
  const fenceIdx = s.toLowerCase().indexOf(fenceTag);
  if (fenceIdx !== -1) {
    const after = fenceIdx + fenceTag.length;
    const startJson = s.indexOf('{', after);
    if (startJson !== -1) {
      const obj = extractBalancedJsonFrom(s, startJson);
      if (obj) return obj;
    }
  }

  // 2) Plano: cv:itinerary ... { ... }
  const plainTag = 'cv:itinerary';
  const plainIdx = s.toLowerCase().indexOf(plainTag);
  if (plainIdx !== -1) {
    const after = plainIdx + plainTag.length;
    const startJson = s.indexOf('{', after);
    if (startJson !== -1) {
      const obj = extractBalancedJsonFrom(s, startJson);
      if (obj) return obj;
    }
  }

  // 3) Fallback: primer bloque de código ```json ... ```
  const codeBlockMatch = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (codeBlockMatch) {
    const code = codeBlockMatch[1].trim();
    // intenta parsear si parece objeto
    const startJson = code.indexOf('{');
    const endJson = code.lastIndexOf('}');
    if (startJson !== -1 && endJson > startJson) {
      const maybe = code.slice(startJson, endJson + 1);
      try {
        return JSON.parse(maybe);
      } catch {
        try {
          return JSON.parse(normalizeSmartQuotes(maybe));
        } catch {
          /* ignore */
        }
      }
    }
  }

  return null;
}

function normalizeRole(role: string | undefined): 'user' | 'assistant' {
  // Cualquier cosa que no sea 'user' la mostramos como 'assistant'
  return role === 'user' ? 'user' : 'assistant';
}

/** Obtiene texto "seguro" de ChatMessage, uniendo parts si hace falta. */
function getMessageText(m: any): string {
  if (m?.parts && Array.isArray(m.parts)) {
    const piece = m.parts[0];
    if (piece && typeof piece.text === 'string') return piece.text;
  }
  if (typeof m?.content === 'string') return m.content;
  return '';
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
      const text = getMessageText(m);
      const itin = extractItinerary(text);
      return { msg: m, text, itin };
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
