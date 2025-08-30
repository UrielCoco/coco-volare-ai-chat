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

/** Normaliza comillas “ ” ‘ ’ a ASCII para que JSON.parse no truene */
function normalizeSmartQuotes(s: string) {
  return s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
}

/** Intenta parsear JSON (con y sin smart quotes) */
function tryParseJson(s: string): any | null {
  try { return JSON.parse(s); } catch {}
  try { return JSON.parse(normalizeSmartQuotes(s)); } catch {}
  return null;
}

/** Extrae objeto JSON balanceando llaves { ... } desde un índice dado */
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

/** Heurística para reconocer que el objeto parece un itinerario */
function isItineraryObject(o: any): boolean {
  if (!o || typeof o !== 'object') return false;
  if (Array.isArray(o.days) && o.days.length >= 1) return true;
  if (o.tripTitle || o.title) return true;
  if (o.lang && (o.clientBooksLongHaulFlights !== undefined || o.disclaimer)) return true;
  return false;
}

/** Encuentra índice del tag con tolerancia:
 * - 2 o 3 backticks: `` o ```
 * - espacios opcionales: ``` cv:itinerary / ```cv : itinerary
 */
function containsFenceTag(s: string): boolean {
  return /`{2,3}\s*cv\s*:\s*itinerary/i.test(s);
}

/** Variante sin fences, al inicio de línea o tras salto */
function containsPlainTag(s: string): boolean {
  return /(^|\n)\s*cv\s*:\s*itinerary/i.test(s);
}

/**
 * Parser robusto que cubre:
 * 1) ```cv:itinerary (2/3 backticks, espacios opcionales)
 * 2) cv:itinerary ... { ... } (sin fences)
 * 3) ```json ... ```
 * 4) JSON toplevel puro (empieza directamente con { ... })
 */
function extractItinerary(rawText: string): any | null {
  if (!rawText) return null;
  const s = normalizeSmartQuotes(rawText);

  // 1) Fence tolerante
  if (containsFenceTag(s)) {
    const sj = s.indexOf('{', s.search(/`{2,3}\s*cv\s*:\s*itinerary/i));
    if (sj !== -1) {
      const obj = extractBalancedJsonFrom(s, sj);
      if (obj && isItineraryObject(obj)) {
        ulog('itinerary.detect.fence', { len: JSON.stringify(obj).length });
        return obj;
      }
    }
  }

  // 2) Plano: cv:itinerary ... { ... }
  if (containsPlainTag(s)) {
    const sj = s.indexOf('{', s.search(/(^|\n)\s*cv\s*:\s*itinerary/i));
    if (sj !== -1) {
      const obj = extractBalancedJsonFrom(s, sj);
      if (obj && isItineraryObject(obj)) {
        ulog('itinerary.detect.plain', { len: JSON.stringify(obj).length });
        return obj;
      }
    }
  }

  // 3) Bloque ```json ... ```
  {
    const m = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (m) {
      const code = m[1].trim();
      const sj = code.indexOf('{');
      const ej = code.lastIndexOf('}');
      if (sj !== -1 && ej > sj) {
        const maybe = code.slice(sj, ej + 1);
        const obj = tryParseJson(maybe);
        if (obj && isItineraryObject(obj)) {
          ulog('itinerary.detect.jsonblock', { len: JSON.stringify(obj).length });
          return obj;
        }
      } else {
        const obj = tryParseJson(code);
        if (obj && isItineraryObject(obj)) {
          ulog('itinerary.detect.jsonblock.raw', { len: JSON.stringify(obj).length });
          return obj;
        }
      }
    }
  }

  // 4) JSON toplevel puro
  {
    const trimmed = s.trimStart();
    if (trimmed.startsWith('{')) {
      const firstBrace = s.indexOf('{');
      let obj: any = null;
      if (firstBrace !== -1) obj = extractBalancedJsonFrom(s, firstBrace);
      if (!obj) obj = tryParseJson(s);
      if (!obj) obj = tryParseJson(trimmed);
      if (obj && isItineraryObject(obj)) {
        ulog('itinerary.detect.toplevel', { len: JSON.stringify(obj).length });
        return obj;
      }
    }
  }

  return null;
}

function normalizeRole(role: string | undefined): 'user' | 'assistant' {
  // Cualquier rol que no sea 'user' lo mostramos como 'assistant'
  return role === 'user' ? 'user' : 'assistant';
}

/** Obtiene texto de ChatMessage (une parts si hace falta) */
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
      return { msg: m, text, itin, hasTag };
    });
    ulog('render.batch', { count: out.length });
    return out;
  }, [messages]);

  return (
    <div className="mx-auto w-full max-w-3xl px-3 py-6 space-y-3">
      {items.map(({ msg, text, itin, hasTag }) => {
        const role = normalizeRole((msg as any)?.role);

        // 1) Si es respuesta del assistant y estamos streameando cv:itinerary pero
        // aún NO hay JSON válido, mostramos loader (no el JSON crudo).
        if (role === 'assistant' && hasTag && !itin) {
          return (
            <div key={msg.id} className="w-full flex justify-start">
              <div className="max-w-[80%] rounded-2xl px-4 py-3 bg-black/80 text-white shadow">
                <span className="opacity-80">preparando itinerario…</span>
              </div>
            </div>
          );
        }

        // 2) Si ya tenemos JSON válido, renderiza la tarjeta
        if (itin) {
          return <ItineraryCard key={msg.id} data={itin} />;
        }

        // 3) Mensaje normal
        return <Message key={msg.id} role={role} text={text} />;
      })}

      {/* Loader genérico solo cuando no hay cv:itinerary en curso */}
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
