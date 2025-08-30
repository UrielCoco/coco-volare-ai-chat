'use client';

import ItineraryCard from './ItineraryCard';
import type { ChatMessage } from '@/lib/types';

function ulog(event: string, meta: any = {}) {
  try { console.debug('[CV][ui][messages]', event, meta); } catch {}
}

type Props = {
  messages: ChatMessage[];
  isLoading: boolean;
  setMessages: (p: { messages: ChatMessage[] }) => void;
  regenerate: () => Promise<void>;
  isReadonly?: boolean;
  chatId?: string;
  votes?: any[];
};

const getText = (m: any): string => {
  if (!m) return '';
  if (typeof m.text === 'string') return m.text;
  if (Array.isArray(m.parts) && m.parts[0]?.text) return m.parts[0].text as string;
  if (typeof m.content === 'string') return m.content;
  return '';
};

const extractBlock = (txt: string) => {
  // cv:itinerary
  const itRegex = /```cv:itinerary\s*([\s\S]*?)```/i;
  const itMatch = txt.match(itRegex);
  if (itMatch) {
    try {
      const json = JSON.parse(itMatch[1]);
      return { kind: 'itinerary' as const, data: json };
    } catch (e) {
      ulog('itinerary.parse.error', { e: String(e) });
    }
  }
  // cv:quote (por si lo usas)
  const qRegex = /```cv:quote\s*([\s\S]*?)```/i;
  const qMatch = txt.match(qRegex);
  if (qMatch) {
    try {
      const json = JSON.parse(qMatch[1]);
      return { kind: 'quote' as const, data: json };
    } catch (e) {
      ulog('quote.parse.error', { e: String(e) });
    }
  }
  return { kind: 'text' as const, data: txt };
};

const guessLang = (msgs: ChatMessage[]): 'es' | 'en' => {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const t = getText(msgs[i]);
    const b = extractBlock(t);
    if (b.kind === 'itinerary' && b.data?.lang) return b.data.lang === 'en' ? 'en' : 'es';
  }
  for (let i = msgs.length - 1; i >= 0; i--) {
    if ((msgs[i] as any).role === 'user') {
      const t = getText(msgs[i]).toLowerCase();
      const looksEn = /\b(the|and|to|please|when|how|where|days?)\b/.test(t) && !/[áéíóúñ¿¡]/.test(t);
      return looksEn ? 'en' : 'es';
    }
  }
  return 'es';
};

function UserBubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full flex justify-end my-2">
      <div className="max-w-[80%] rounded-2xl bg-[#bba36d] text-black px-4 py-3 shadow">
        {children}
      </div>
    </div>
  );
}

function AssistantBubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full flex justify-start my-2">
      <div className="max-w-[80%] rounded-2xl bg-neutral-900 text-white px-4 py-3 shadow">
        {children}
      </div>
    </div>
  );
}

function LoaderBubble({ lang }: { lang: 'es' | 'en' }) {
  const label = lang === 'en' ? 'thinking' : 'pensando';
  return (
    <div className="w-full flex items-center gap-2 my-3">
      <img
        src="/images/Intelligence.gif"
        alt="Coco Volare thinking"
        className="h-8 w-auto select-none"  // SIN sombra
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

  return (
    <div className="mx-auto max-w-3xl w-full px-4 py-6">
      {messages.map((m, i) => {
        const text = getText(m);
        const role = (m as any).role as 'user' | 'assistant' | 'system';

        // Ocultar placeholder vacío de assistant
        if (role === 'assistant' && (!text || !text.trim())) return null;

        if (role === 'user') {
          return (
            <UserBubble key={m.id || i}>
              <div className="whitespace-pre-wrap break-words">{text}</div>
            </UserBubble>
          );
        }

        if (role === 'assistant') {
          // Si viene iniciando el bloque pero aún no cierra, NO pintes el texto (evita ver JSON parcial)
          const hasStart = /```cv:itinerary/i.test(text);
          const hasComplete = /```cv:itinerary[\s\S]*?```/i.test(text);
          if (hasStart && !hasComplete) {
            // Mostramos sólo el loader global (abajo); aquí no pintamos nada.
            return null;
          }

          const block = extractBlock(text);
          if (block.kind === 'itinerary') {
            return (
              <div key={m.id || i} className="w-full flex justify-start my-3">
                <ItineraryCard data={block.data} />
              </div>
            );
          }

          return (
            <AssistantBubble key={m.id || i}>
              <div className="whitespace-pre-wrap break-words">{text}</div>
            </AssistantBubble>
          );
        }

        return null;
      })}

      {/* Loader único mientras llega contenido */}
      {isLoading && <LoaderBubble lang={lang} />}
    </div>
  );
}
