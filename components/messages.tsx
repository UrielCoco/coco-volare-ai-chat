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

function ulog(event: string, meta: any = {}) {
  try { console.debug('[CV][ui][msg]', event, meta); } catch {}
}

function normalizeSmartQuotes(s: string) {
  return s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
}

function extractBalancedJsonFrom(text: string, startBraceIndex: number): any | null {
  let depth = 0;
  for (let i = startBraceIndex; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        const raw = text.slice(startBraceIndex, i + 1);
        try { return JSON.parse(raw); } catch {}
        try { return JSON.parse(normalizeSmartQuotes(raw)); } catch { return null; }
      }
    }
  }
  return null;
}

/** Detecta:
 * - ```cv:itinerary ... ```
 * - cv:itinerary ... { ... } (sin fences)
 * - fallback: primer ```json ... ```
 */
function extractItinerary(rawText: string): any | null {
  if (!rawText) return null;
  const s = normalizeSmartQuotes(rawText);
  try {
    const fenceTag = '```cv:itinerary';
    const fIdx = s.toLowerCase().indexOf(fenceTag);
    if (fIdx !== -1) {
      const after = fIdx + fenceTag.length;
      const sj = s.indexOf('{', after);
      if (sj !== -1) {
        const obj = extractBalancedJsonFrom(s, sj);
        if (obj) { ulog('itinerary.detect.fenced', { len: JSON.stringify(obj).length }); return obj; }
      }
    }
    const plainTag = 'cv:itinerary';
    const pIdx = s.toLowerCase().indexOf(plainTag);
    if (pIdx !== -1) {
      const after = pIdx + plainTag.length;
      const sj = s.indexOf('{', after);
      if (sj !== -1) {
        const obj = extractBalancedJsonFrom(s, sj);
        if (obj) { ulog('itinerary.detect.plain', { len: JSON.stringify(obj).length }); return obj; }
      }
    }
    const codeBlock = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (codeBlock) {
      const code = codeBlock[1].trim();
      const sj = code.indexOf('{');
      const ej = code.lastIndexOf('}');
      if (sj !== -1 && ej > sj) {
        const maybe = code.slice(sj, ej + 1);
        try { const o = JSON.parse(maybe); ulog('itinerary.detect.jsonblock', { len: JSON.stringify(o).length }); return o; } catch {}
        try { const o2 = JSON.parse(normalizeSmartQuotes(maybe)); ulog('itinerary.detect.jsonblock-smart', { len: JSON.stringify(o2).length }); return o2; } catch {}
      }
    }
  } catch (e) {
    ulog('itinerary.parse.exception', { e });
  }
  return null;
}

function normalizeRole(role: string | undefined): 'user' | 'assistant' {
  return role === 'user' ? 'user' : 'assistant';
}

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
    const out = messages.map((m) => {
      const text = getMessageText(m);
      const itin = extractItinerary(text);
      return { msg: m, text, itin };
    });
    ulog('render.batch', { count: out.length });
    return out;
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
