'use client';

import { useEffect, useState } from 'react';
import type { ChatMessage } from '@/lib/types';
import ItineraryCard from './ItineraryCard';
import QuoteCard from './QuoteCard';

const RICH_CARDS_ENABLED = true; // tarjetas activas

type Props = {
  messages: ChatMessage[];
  isLoading: boolean;
  setMessages: (p: { messages: ChatMessage[] }) => void;
  regenerate: () => Promise<void>;
  isReadonly?: boolean;
  chatId?: string;
  votes?: any[];
};

function UserBubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full flex justify-end my-3 cv-appear">
      <div className="max-w-[80%] rounded-2xl px-4 py-3 shadow bg-[#bba36d] text-black whitespace-pre-wrap break-words">
        {children}
      </div>
    </div>
  );
}

function AssistantBubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full flex justify-start my-3 cv-appear">
      <div className="max-w-[80%] rounded-2xl px-4 py-3 shadow bg-black/80 text-white whitespace-pre-wrap break-words">
        {children}
      </div>
    </div>
  );
}

function guessLang(messages: ChatMessage[]) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m) continue;
    const t = (m as any)?.parts?.[0]?.text || '';
    if (typeof t === 'string' && t.trim()) {
      const looksEn = /\b(the|and|to|please|when|how|where|days?)\b/.test(t) && !/[áéíóúñ¿¡]/.test(t);
      return looksEn ? 'en' : 'es';
    }
  }
  return 'es';
}

function Loader({ lang, phase }: { lang: 'es'|'en', phase: 'in'|'out' }) {
  const label = lang === 'en' ? 'thinking' : 'pensando';
  return (
    <div className={`w-full flex items-center gap-2 my-3 ${phase === 'in' ? 'cv-fade-in' : 'cv-fade-out'}`}>
      <img src="/images/Intelligence.gif" alt="Coco Volare thinking" className="h-8 w-auto select-none" draggable={false} />
      <div className="rounded-2xl bg-neutral-900 text-white px-3 py-2 shadow flex items-center gap-1">
        <span className="opacity-90">{label}</span>
        <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ animationDelay: '0ms', background: 'rgba(255,255,255,.8)' }} />
        <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ animationDelay: '150ms', background: 'rgba(255,255,255,.6)' }} />
        <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ animationDelay: '300ms', background: 'rgba(255,255,255,.4)' }} />
      </div>
    </div>
  );
}

/* ===================== Helpers ===================== */

// quita bloques internos de CRM
function stripKommo(text: string) {
  return (text || '').replace(/```cv:kommo[\s\S]*?```/gi, '').trim();
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

// toma el primer JSON que aparezca (fence ```json o crudo balanceado)
function parseFirstJson(text: string): any | null {
  if (!text) return null;

  // 1) fence ```json
  const m = text.match(/```[ \t]*json[ \t]*\n?([\s\S]*?)```/i);
  if (m) {
    try { return JSON.parse(m[1] || ''); } catch {}
  }

  // 2) balanceado crudo
  const i = text.indexOf('{');
  if (i >= 0) {
    const chunk = extractBalancedJson(text, i);
    if (chunk) {
      try { return JSON.parse(chunk); } catch {}
    }
  }
  return null;
}

/* ===================== Componente ===================== */
export default function Messages(props: Props) {
  const { messages, isLoading } = props;
  const lang = guessLang(messages);

  const [showLoader, setShowLoader] = useState(false);
  const [phase, setPhase] = useState<'in' | 'out'>('in');

  useEffect(() => {
    if (isLoading) { setShowLoader(true); setPhase('in'); }
    else if (showLoader) { setPhase('out'); const t = setTimeout(() => setShowLoader(false), 180); return () => clearTimeout(t); }
  }, [isLoading, showLoader]);

  return (
    <div className="mx-auto max-w-3xl w-full px-4 py-6">
      {messages.map((m, i) => {
        const role = (m as any).role as string;
        const raw = ((m as any)?.parts?.[0]?.text ?? '') as string;

        if (role === 'system') return null;

        if (role === 'user') {
          return (
            <UserBubble key={(m as any).id || i}>
              <div className="whitespace-pre-wrap break-words">{raw}</div>
            </UserBubble>
          );
        }

        if (role === 'assistant') {
          if (!RICH_CARDS_ENABLED) {
            // modo texto crudo (debug)
            const visible = stripKommo(raw);
            if (!visible) return null;
            return (
              <AssistantBubble key={(m as any).id || i}>
                <div className="whitespace-pre-wrap break-words">{visible}</div>
              </AssistantBubble>
            );
          }

          // NUEVO: solo mostramos si hay JSON con cardType
          const visible = stripKommo(raw);
          const obj = parseFirstJson(visible);
          const cardType = typeof obj?.cardType === 'string' ? obj.cardType.toLowerCase() : '';

          if (cardType === 'itinerary') {
            return (
              <div key={(m as any).id || i} className="w-full flex justify-start my-3 cv-appear">
                <ItineraryCard data={obj} />
              </div>
            );
          }

          if (cardType === 'quote') {
            return (
              <div key={(m as any).id || i} className="w-full flex justify-start my-3 cv-appear">
                <QuoteCard data={obj} />
              </div>
            );
          }

          // Si no trae cardType → oculto (no pintamos nada)
          return null;
        }

        return null;
      })}

      {showLoader && <Loader lang={lang} phase={phase} />}

      <style jsx global>{`
        @keyframes cvFadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes cvFadeOut { from { opacity: 1 } to { opacity: 0 } }
        @keyframes cvAppear { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: translateY(0) } }
        .cv-fade-in  { animation: cvFadeIn .18s ease-out both; }
        .cv-fade-out { animation: cvFadeOut .18s ease-out both; }
        .cv-appear   { animation: cvAppear .22s ease-out both; }
        @media (prefers-reduced-motion: reduce) {
          .cv-fade-in, .cv-fade-out, .cv-appear { animation-duration: .001s; }
        }
      `}</style>
    </div>
  );
}
