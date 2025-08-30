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

// Utilidades mínimas (sin cambiar tu lógica)
const getText = (m: any): string => {
  if (!m) return '';
  if (typeof m.text === 'string') return m.text;
  if (Array.isArray(m.parts) && m.parts[0]?.text) return m.parts[0].text as string;
  if (typeof m.content === 'string') return m.content;
  return '';
};

const guessLang = (msgs: ChatMessage[]): 'es' | 'en' => {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const t = getText(msgs[i]).toLowerCase();
    const looksEn =
      /\b(the|and|to|please|when|how|where|days?)\b/.test(t) && !/[áéíóúñ¿¡]/.test(t);
    if ((msgs[i] as any).role === 'user') return looksEn ? 'en' : 'es';
  }
  return 'es';
};

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
        className="h-8 w-auto select-none" /* sin sombra */
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

export default function Messages(props: Props) {
  const { messages, isLoading } = props;
  const lang = guessLang(messages);

  // Mostrar loader con fade-in/-out sin afectar tu lógica
  const [showLoader, setShowLoader] = useState(false);
  const [phase, setPhase] = useState<'in' | 'out'>('in');

  useEffect(() => {
    if (isLoading) {
      setShowLoader(true);
      setPhase('in');
    } else if (showLoader) {
      setPhase('out');
      const t = setTimeout(() => setShowLoader(false), 180); // dura lo mismo que la animación
      return () => clearTimeout(t);
    }
  }, [isLoading, showLoader]);

  return (
    <div className="mx-auto max-w-3xl w-full px-4 py-6">
      {messages.map((m, i) => {
        const text = getText(m);
        const role = (m as any).role as 'user' | 'assistant' | 'system';

        if (role === 'user') {
          return (
            <UserBubble key={m.id || i}>
              <div className="whitespace-pre-wrap break-words">{text}</div>
            </UserBubble>
          );
        }

        if (role === 'assistant') {
          // Si el assistant incluye un bloque completo cv:itinerary => renderiza tarjeta
          const itMatch = text.match(/```cv:itinerary\s*([\s\S]*?)```/i);
          if (itMatch) {
            try {
              const data = JSON.parse(itMatch[1]);
              return (
                <div key={m.id || i} className="w-full flex justify-start my-3 cv-appear">
                  <ItineraryCard data={data} />
                </div>
              );
            } catch {
              // Si no parsea, muestra texto normal (nos mantenemos fieles a tu versión previa)
            }
          }

          return (
            <AssistantBubble key={m.id || i}>
              <div className="whitespace-pre-wrap break-words">{text}</div>
            </AssistantBubble>
          );
        }

        return null;
      })}

      {/* Loader con fade-in/out */}
      {showLoader && <Loader lang={lang} phase={phase} />}

      {/* Animaciones globales (sólo apariencia, no tocan tu lógica) */}
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
