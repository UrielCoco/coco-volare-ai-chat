'use client';

import { useEffect, useState } from 'react';
import ItineraryCard from './ItineraryCard';
import type { ChatMessage } from '@/lib/types';

type Props = {
  messages: ChatMessage[];
  isLoading: boolean;
  setMessages: (p: { messages: ChatMessage[] }) => void;
  regenerate: () => Promise<void>;
  isReadonly?: boolean;
  chatId?: string;
  votes?: any[];
};

// --- Helpers ---------------------------------------------------------

const getText = (m: any): string => {
  if (!m) return '';
  if (typeof m.text === 'string') return m.text;
  if (Array.isArray(m.parts) && m.parts[0]?.text) return m.parts[0].text as string;
  if (typeof m.content === 'string') return m.content;
  return '';
};

const guessLang = (msgs: ChatMessage[]): 'es' | 'en' => {
  for (let i = msgs.length - 1; i >= 0; i--) {
    if ((msgs[i] as any).role === 'user') {
      const t = getText(msgs[i]).toLowerCase();
      const looksEn = /\b(the|and|to|please|when|how|where|days?)\b/.test(t) && !/[áéíóúñ¿¡]/.test(t);
      return looksEn ? 'en' : 'es';
    }
  }
  return 'es';
};

/** JSON balanceado desde el primer { a partir de startIdx */
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

/** Extrae cv:itinerary (fenced o directo) y valida si está completo */
function extractItineraryFromText(text: string): { found: boolean; complete: boolean; data?: any } {
  const lower = text.toLowerCase();
  const labelIdx = lower.indexOf('cv:itinerary');
  if (labelIdx === -1) return { found: false, complete: false };

  const fenced = text.match(/```[\s]*cv:itinerary\s*([\s\S]*?)```/i);
  if (fenced) {
    try { return { found: true, complete: true, data: JSON.parse(fenced[1]) }; }
    catch { return { found: true, complete: false }; }
  }

  const braceIdx = text.indexOf('{', labelIdx);
  if (braceIdx === -1) return { found: true, complete: false };
  const jsonSlice = extractBalancedJson(text, braceIdx);
  if (!jsonSlice) return { found: true, complete: false };
  try { return { found: true, complete: true, data: JSON.parse(jsonSlice) }; }
  catch { return { found: true, complete: false }; }
}

// --- UI bits ---------------------------------------------------------

function UserBubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full flex justify-end my-2 cv-appear">
      <div className="max-w-[80%] rounded-2xl bg-[#bba36d] text-black px-4 py-3 shadow">
        {children}
      </div>
    </div>
  );
}

function AssistantBubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full flex justify-start my-2 cv-appear">
      <div className="max-w-[80%] rounded-2xl bg-neutral-900 text-white px-4 py-3 shadow">
        {children}
      </div>
    </div>
  );
}

function Loader({ lang, phase }: { lang: 'es' | 'en'; phase: 'in' | 'out' }) {
  const label = lang === 'en' ? 'thinking' : 'pensando';
  return (
    <div className={`w-full flex items-center gap-2 my-3 ${phase === 'in' ? 'cv-fade-in' : 'cv-fade-out'}`}>
      <img
        src="/images/Intelligence.gif"
        alt="Coco Volare thinking"
        className="h-8 w-auto select-none"
        draggable={false}
      />
      <div className="rounded-2xl bg-neutral-900 text-white px-3 py-2 shadow flex items-center gap-1">
        <span className="opacity-90">{label}</span>
        <span className="w-1.5 h-1.5 rounded-full bg-white/80 animate-bounce" style={{ animationDelay: '0ms' }} />
        <span className="w-1.5 h-1.5 rounded-full bg-white/60 animate-bounce" style={{ animationDelay: '150ms' }} />
        <span className="w-1.5 h-1.5 rounded-full bg-white/40 animate-bounce" style={{ animationDelay: '300ms' }} />
      </div>
    </div>
  );
}

// --- Componente -------------------------------------------------------

export default function Messages(props: Props) {
  const { messages, isLoading } = props;
  const lang = guessLang(messages);

  // Loader con fade in/out
  const [showLoader, setShowLoader] = useState(false);
  const [phase, setPhase] = useState<'in' | 'out'>('in');

  useEffect(() => {
    if (isLoading) {
      setShowLoader(true);
      setPhase('in');
    } else if (showLoader) {
      setPhase('out');
      const t = setTimeout(() => setShowLoader(false), 180);
      return () => clearTimeout(t);
    }
  }, [isLoading, showLoader]);

  return (
    <div className="mx-auto max-w-3xl w-full px-4 py-6">
      {messages.map((m, i) => {
        const role = (m as any).role as 'user' | 'assistant' | 'system';
        const raw = getText(m) ?? '';
        // 🔒 Regla anti-doble-burbuja:
        // si el asistente aún no ha emitido tokens y el texto está vacío,
        // NO renderizamos la burbuja (el loader será lo único visible).
        const trimmed = raw.replace(/\u200B/g, '').trim();

        if (role === 'user') {
          return (
            <UserBubble key={(m as any).id || i}>
              <div className="whitespace-pre-wrap break-words">{raw}</div>
            </UserBubble>
          );
        }

        if (role === 'assistant') {
          // Oculta burbujas vacías (evita el “globo negro” mini)
          if (!trimmed) {
            return null;
          }

          // Itinerary: solo muestra tarjeta cuando el JSON esté completo
          const it = extractItineraryFromText(trimmed);
          if (it.found && !it.complete) return null;
          if (it.complete && it.data) {
            return (
              <div key={(m as any).id || i} className="w-full flex justify-start my-3 cv-appear">
                <ItineraryCard data={it.data} />
              </div>
            );
          }

          return (
            <AssistantBubble key={(m as any).id || i}>
              <div className="whitespace-pre-wrap break-words">{trimmed}</div>
              {(m as any)?.stopped === true && (
                <div className="text-xs opacity-70 mt-1">⏹️ Respuesta detenida por el usuario</div>
              )}
            </AssistantBubble>
          );
        }

        return null;
      })}

      {/* Loader */}
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
