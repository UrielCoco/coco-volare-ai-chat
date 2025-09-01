'use client';

import { useEffect, useState } from 'react';
import ItineraryCard from './ItineraryCard';
import QuoteCard from './QuoteCard';
import type { ChatMessage } from '@/lib/types';

// ---------------- Helpers ----------------
type Props = {
  messages: ChatMessage[];
  isLoading: boolean;
  setMessages: (p: { messages: ChatMessage[] }) => void;
  regenerate: () => Promise<void>;
  isReadonly?: boolean;
  chatId?: string;
  votes?: any[];
};

function UserBubble({ children }: { children: any }) {
  return (
    <div className="w-full flex justify-end my-3">
      <div className="max-w-[85%] rounded-2xl px-4 py-3 bg-amber-400 text-black shadow">
        {children}
      </div>
    </div>
  );
}

function AssistantBubble({ children }: { children: any }) {
  return (
    <div className="w-full flex justify-start my-3">
      <div className="max-w-[85%] rounded-2xl px-4 py-3 bg-black text-white border border-zinc-800 shadow">
        {children}
      </div>
    </div>
  );
}

function detectLang(text: string) {
  const t = (text || '').trim();
  if (!t) return 'es';
  if (/[¿¡áéíóúñ]/i.test(t)) return 'es';
  if (/[a-z]/i.test(t)) {
    const looksEn = /\b(the|and|to|please|when|how|where|days?)\b/.test(t) && !/[áéíóúñ¿¡]/.test(t);
    return looksEn ? 'en' : 'es';
  }
  return 'es';
}

function extractBalancedJson(src: string, startIdx: number): string | null {
  let inString = false, escape = false, depth = 0, first = -1;
  for (let i = startIdx; i < src.length; i++) {
    const ch = src[i];
    if (inString) {
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === '"') { inString = false; continue; }
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{') { if (depth === 0) first = i; depth++; continue; }
    if (ch === '}') { depth--; if (depth === 0 && first >= 0) return src.slice(first, i + 1); }
  }
  return null;
}

function extractLabeledJson(text: string, label: string): { found: boolean; complete: boolean; data?: any } {
  const lower = text.toLowerCase();
  const idx = lower.indexOf(label.toLowerCase());
  if (idx === -1) return { found: false, complete: false };

  // Fenced
  const re = new RegExp("```\\s*" + label.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&') + "\\s*([\\s\\S]*?)```", "i");
  const fenced = text.match(re);
  if (fenced) {
    try { return { found: true, complete: true, data: JSON.parse(fenced[1]) }; }
    catch { return { found: true, complete: false }; }
  }

  // Plain JSON after label
  const braceIdx = text.indexOf('{', idx);
  if (braceIdx === -1) return { found: true, complete: false };
  const jsonSlice = extractBalancedJson(text, braceIdx);
  if (!jsonSlice) return { found: true, complete: false };
  try { return { found: true, complete: true, data: JSON.parse(jsonSlice) }; }
  catch { return { found: true, complete: false }; }
}

export default function Messages({
  messages,
  isLoading,
  setMessages,
  regenerate,
  isReadonly,
  chatId,
}: Props) {
  const [_, setLang] = useState<'es' | 'en'>('es');

  useEffect(() => {
    const last = [...messages].reverse().find((m) => m.role === 'assistant' || m.role === 'user');
    if (last) setLang(detectLang(last.parts?.[0]?.text || 'es') as any);
  }, [messages]);

  return (
    <div className="w-full pt-4">
      {messages.map((m, i) => {
        const role = m.role;
        const raw = m.parts?.[0]?.text || '';
        const trimmed = raw.trim();
        const visible = trimmed.replace(/```cv:kommo[\s\S]*?```/gi, '').trim();

        if (role === 'user') {
          return (
            <UserBubble key={(m as any).id || i}>
              <div className="whitespace-pre-wrap break-words">{raw}</div>
            </UserBubble>
          );
        }

        if (role === 'assistant') {
          // Evita burbuja doble cuando aún no hay tokens
          if (!visible) return null;

          // 1) Itinerario
          const it = extractLabeledJson(trimmed, 'cv:itinerary');
          if (it.complete && it.data) {
            return (
              <div key={(m as any).id || i} className="w-full flex justify-start my-3 cv-appear">
                <ItineraryCard data={it.data} />
              </div>
            );
          }

          // 2) Quote (cotización)
          const q = extractLabeledJson(trimmed, 'cv:quote');
          if (q.complete && q.data) {
            return (
              <div key={(m as any).id || i} className="w-full flex justify-start my-3 cv-appear">
                <QuoteCard data={q.data} />
              </div>
            );
          }

          // 3) Texto normal
          return (
            <AssistantBubble key={(m as any).id || i}>
              <div className="whitespace-pre-wrap break-words">{visible}</div>
            </AssistantBubble>
          );
        }

        return null;
      })}
    </div>
  );
}
