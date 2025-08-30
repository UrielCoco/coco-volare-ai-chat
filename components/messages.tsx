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

/* Utilidades JSON/stream */
function normalizeSmartQuotes(s: string) {
  return s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
}
function tryParseJson(s: string): any | null {
  try { return JSON.parse(s); } catch {}
  try { return JSON.parse(normalizeSmartQuotes(s)); } catch {}
  return null;
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
        return tryParseJson(raw);
      }
    }
  }
  return null;
}
function isItineraryObject(o: any): boolean {
  if (!o || typeof o !== 'object') return false;
  if (Array.isArray(o.days) && o.days.length >= 1) return true;
  if (o.tripTitle || o.title) return true;
  if (o.lang && (o.clientBooksLongHaulFlights !== undefined || o.disclaimer)) return true;
  return false;
}

/* Detección de etiquetas en streaming */
function containsFenceTag(s: string): boolean {
  return /`{2,3}\s*cv\s*:\s*itinerary/i.test(s);
}
function containsPlainTag(s: string): boolean {
  return /(^|\n)\s*cv\s*:\s*itinerary/i.test(s);
}

/* Idioma desde el texto parcial del assistant */
function guessLangFromPartial(s: string): 'es' | 'en' {
  const n = normalizeSmartQuotes(s);
  const m = n.match(/"lang"\s*:\s*"(es|en)"/i);
  if (m && m[1]) return m[1].toLowerCase() as 'es' | 'en';
  // fallback: heurística por palabras
  if (/\b(itinerario|día|llegada|hotel|ciudad|país)\b/i.test(n)) return 'es';
  return 'en';
}

/* Parser robusto del itinerario */
function extractItinerary(rawText: string): any | null {
  if (!rawText) return null;
  const s = normalizeSmartQuotes(rawText);

  if (containsFenceTag(s)) {
    const sj = s.indexOf('{', s.search(/`{2,3}\s*cv\s*:\s*itinerary/i));
    if (sj !== -1) {
      const obj = extractBalancedJsonFrom(s, sj);
      if (obj && isItineraryObject(obj)) { ulog('itinerary.detect.fence', { len: JSON.stringify(obj).length }); return obj; }
    }
  }
  if (containsPlainTag(s)) {
    const sj = s.indexOf('{', s.search(/(^|\n)\s*cv\s*:\s*itinerary/i));
    if (sj !== -1) {
      const obj = extractBalancedJsonFrom(s, sj);
      if (obj && isItineraryObject(obj)) { ulog('itinerary.detect.plain', { len: JSON.stringify(obj).length }); return obj; }
    }
  }
  const m = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (m) {
    const code = m[1].trim();
    const sj = code.indexOf('{');
    const ej = code.lastIndexOf('}');
    if (sj !== -1 && ej > sj) {
      const maybe = code.slice(sj, ej + 1);
      const obj = tryParseJson(maybe);
      if (obj && isItineraryObject(obj)) { ulog('itinerary.detect.jsonblock', { len: JSON.stringify(obj).length }); return obj; }
    } else {
      const obj = tryParseJson(code);
      if (obj && isItineraryObject(obj)) { ulog('itinerary.detect.jsonblock.raw', { len: JSON.stringify(obj).length }); return obj; }
    }
  }
  const trimmed = s.trimStart();
  if (trimmed.startsWith('{')) {
    const firstBrace = s.indexOf('{');
    let obj: any = null;
    if (firstBrace !== -1) obj = extractBalancedJsonFrom(s, firstBrace);
    if (!obj) obj = tryParseJson(s);
    if (!obj) obj = tryParseJson(trimmed);
    if (obj && isItineraryObject(obj)) { ulog('itinerary.detect.toplevel', { len: JSON.stringify(obj).length }); return obj; }
  }
  return null;
}

function normalizeRole(role: string | undefined): 'user' | 'assistant' {
  return role === 'user' ? 'user' : 'assistant';
}

/* Texto del mensaje */
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
      const hasTag = containsFenceTag(text) || containsPlainTag(text);
      const pendingLang = hasTag && !itin ? guessLangFromPartial(text) : undefined;
      return { msg: m, text, itin, hasTag, pendingLang };
    });
    ulog('render.batch', { count: out.length });
    return out;
  }, [messages]);

  // ¿Hay un cv:itinerary en curso (aún sin JSON válido)?
  const hasPendingItin = items.some(
    ({ msg, hasTag, itin }) => normalizeRole((msg as any)?.role) === 'assistant' && hasTag && !itin
  );

  return (
    <div className="mx-auto w-full max-w-3xl px-3 py-6 space-y-3">
      {items.map(({ msg, text, itin, hasTag, pendingLang }) => {
        const role = normalizeRole((msg as any)?.role);

        // Mientras llega un cv:itinerary en streaming -> NO mostrar JSON crudo.
        if (role === 'assistant' && hasTag && !itin) {
          const lang = pendingLang || 'es';
          const waitText = lang === 'en' ? 'preparing itinerary…' : 'preparando itinerario…';
          return (
            <div key={msg.id} className="space-y-2">
              {/* Burbuja con GIF + 3 puntos animados */}
              <div className="w-full flex justify-start">
                <div className="max-w-[80%] rounded-2xl px-4 py-3 bg-black/80 text-white shadow flex items-center gap-3">
                  <img
                    src="/Intelligence.gif"
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
              {/* Burbuja con texto de espera según idioma detectado */}
              <div className="w-full flex justify-start">
                <div className="max-w-[80%] rounded-2xl px-4 py-3 bg-black/80 text-white shadow">
                  <span className="opacity-80">{waitText}</span>
                </div>
              </div>
            </div>
          );
        }

        // JSON ya válido -> renderizar tarjeta
        if (itin) {
          return <ItineraryCard key={msg.id} data={itin} />;
        }

        // Mensajes normales
        return <Message key={msg.id} role={role} text={text} />;
      })}

      {/* Loader genérico SOLO si no hay un itinerario pendiente */}
      {isLoading && !hasPendingItin && (
        <div className="w-full flex justify-start">
          <div className="max-w-[80%] rounded-2xl px-4 py-3 bg-black/80 text-white shadow">
            <span className="opacity-80">pensando…</span>
          </div>
        </div>
      )}
    </div>
  );
}
