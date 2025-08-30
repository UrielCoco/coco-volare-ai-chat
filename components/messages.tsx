'use client';

import { useMemo, useEffect, useState } from 'react';
import Message from './message';
import ItineraryCard from './ItineraryCard';
import type { ChatMessage } from '@/lib/types';

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

/* --- Utils JSON/stream --- */
const normalizeSmartQuotes = (s: string) => s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
const tryParseJson = (s: string) => { try { return JSON.parse(s); } catch {} try { return JSON.parse(normalizeSmartQuotes(s)); } catch {} return null; };
function extractBalancedJsonFrom(text: string, startBraceIndex: number): any | null {
  let depth = 0;
  for (let i = startBraceIndex; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return tryParseJson(text.slice(startBraceIndex, i + 1));
    }
  }
  return null;
}
const isItineraryObject = (o: any) =>
  !!o && typeof o === 'object' && (Array.isArray(o.days) || o.tripTitle || o.title || o.lang);

const containsFenceTag = (s: string) => /`{2,3}\s*cv\s*:\s*itinerary/i.test(s);
const containsPlainTag = (s: string) => /(^|\n)\s*cv\s*:\s*itinerary/i.test(s);
const guessLangFromPartial = (s: string): 'es' | 'en' => {
  const m = normalizeSmartQuotes(s).match(/"lang"\s*:\s*"(es|en)"/i);
  if (m?.[1]) return m[1].toLowerCase() as 'es' | 'en';
  if (/\b(itinerario|día|llegada|hotel|ciudad|país)\b/i.test(s)) return 'es';
  return 'en';
};

function extractItinerary(rawText: string): any | null {
  if (!rawText) return null;
  const s = normalizeSmartQuotes(rawText);

  if (containsFenceTag(s)) {
    const sj = s.indexOf('{', s.search(/`{2,3}\s*cv\s*:\s*itinerary/i));
    if (sj !== -1) { const obj = extractBalancedJsonFrom(s, sj); if (obj && isItineraryObject(obj)) return obj; }
  }
  if (containsPlainTag(s)) {
    const sj = s.indexOf('{', s.search(/(^|\n)\s*cv\s*:\s*itinerary/i));
    if (sj !== -1) { const obj = extractBalancedJsonFrom(s, sj); if (obj && isItineraryObject(obj)) return obj; }
  }
  const m = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (m) {
    const code = m[1].trim();
    const sj = code.indexOf('{'); const ej = code.lastIndexOf('}');
    const maybe = sj !== -1 && ej > sj ? code.slice(sj, ej + 1) : code;
    const obj = tryParseJson(maybe); if (obj && isItineraryObject(obj)) return obj;
  }
  const trimmed = s.trimStart();
  if (trimmed.startsWith('{')) {
    const firstBrace = s.indexOf('{');
    let obj: any = null;
    if (firstBrace !== -1) obj = extractBalancedJsonFrom(s, firstBrace);
    if (!obj) obj = tryParseJson(s) || tryParseJson(trimmed);
    if (obj && isItineraryObject(obj)) return obj;
  }
  return null;
}

function normalizeRole(role: string | undefined): 'user' | 'assistant' {
  return role === 'user' ? 'user' : 'assistant';
}
function getMessageText(m: any): string {
  if (m?.parts && Array.isArray(m.parts)) {
    const piece = m.parts[0]; if (piece && typeof piece.text === 'string') return piece.text;
  }
  if (typeof m?.content === 'string') return m.content;
  return '';
}

/* FadeIn wrapper for loaders/cards from here too */
function FadeIn({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { const t = requestAnimationFrame(() => setMounted(true)); return () => cancelAnimationFrame(t); }, []);
  return (
    <div className={`transition-all duration-300 ease-out ${mounted ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-2 scale-[.98]'}`}>
      {children}
    </div>
  );
}

export default function Messages({
  messages,
  isLoading,
}: Props) {
  const items = useMemo(() => {
    const out = messages.map((m) => {
      const text = getMessageText(m);
      const itin = extractItinerary(text);
      const hasTag = containsFenceTag(text) || containsPlainTag(text);
      const pendingLang = hasTag && !itin ? guessLangFromPartial(text) : undefined;
      return { msg: m, text, itin, hasTag, pendingLang };
    });
    ulog('render.batch', { count: out.length });
    return out;
  }, [messages]);

  const hasPendingItin = items.some(
    ({ msg, hasTag, itin }) => normalizeRole((msg as any)?.role) === 'assistant' && hasTag && !itin
  );

  return (
    <div className="mx-auto w-full max-w-3xl px-3 py-6 space-y-3">
      {items.map(({ msg, text, itin, hasTag, pendingLang }) => {
        const role = normalizeRole((msg as any)?.role);

        if (role === 'assistant' && hasTag && !itin) {
          const lang = pendingLang || 'es';
          const waitText = lang === 'en' ? 'preparing itinerary…' : 'preparando itinerario…';
          return (
            <FadeIn key={msg.id}>
              <div className="space-y-2">
                <div className="w-full flex justify-start">
                  <div className="max-w-[80%] rounded-2xl px-4 py-3 bg-black/80 text-white shadow flex items-center gap-3">
                    <img
                      src="/images/Intelligence.gif"
                      alt={lang === 'en' ? 'Preparing' : 'Preparando'}
                      className="h-6 w-6 rounded"
                    />
                    <div className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-white/80 animate-pulse" style={{ animationDelay: '0ms' }} />
                      <span className="w-2 h-2 rounded-full bg-white/80 animate-pulse" style={{ animationDelay: '150ms' }} />
                      <span className="w-2 h-2 rounded-full bg-white/80 animate-pulse" style={{ animationDelay: '300ms' }} />
                    </div>
                  </div>
                </div>
                <div className="w-full flex justify-start">
                  <div className="max-w-[80%] rounded-2xl px-4 py-3 bg-black/80 text-white shadow">
                    <span className="opacity-80">{waitText}</span>
                  </div>
                </div>
              </div>
            </FadeIn>
          );
        }

        if (itin) {
          return (
            <FadeIn key={msg.id}>
              <ItineraryCard data={itin} />
            </FadeIn>
          );
        }

        return (
          <Message key={msg.id} role={role} text={text} />
        );
      })}

      {/* Loader genérico solo si no hay un itinerario pendiente */}
      {isLoading && !hasPendingItin && (
        <FadeIn>
          <div className="w-full flex justify-start">
            <div className="max-w-[80%] rounded-2xl px-4 py-3 bg-black/80 text-white shadow">
              <span className="opacity-80">pensando…</span>
            </div>
          </div>
        </FadeIn>
      )}
    </div>
  );
}
