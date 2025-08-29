'use client';

import { useEffect, useRef, useState } from 'react';
import Messages from './messages';
import type { ChatMessage, Itinerary } from '@/lib/types';
import { v4 as uuidv4 } from 'uuid';
import { PaperPlaneIcon } from '@radix-ui/react-icons';

function extractItineraryFromText(text: string): Itinerary | null {
  if (!text) return null;

  // Soporta fences: ```cv:itinerary```, ```itinerary```, ```json```
  const reFence = /```(?:cv:itinerary|itinerary|json)\s*([\s\S]*?)```/i;
  const m1 = text.match(reFence);
  const candidate1 = m1?.[1];

  // Prefijo tipo: ITINERARY_JSON: { ... }
  const rePrefix = /ITINERARY_JSON\s*[:=]\s*({[\s\S]*})/i;
  const m2 = text.match(rePrefix);
  const candidate2 = m2?.[1];

  // JSON “pelado”
  const maybeWhole = text.trim().startsWith('{') && text.trim().endsWith('}')
    ? text.trim()
    : undefined;

  const candidates = [candidate1, candidate2, maybeWhole].filter(Boolean) as string[];
  for (const c of candidates) {
    try {
      const parsed = JSON.parse(c);
      if (parsed && Array.isArray(parsed.days) && parsed.days.length > 0) {
        return parsed as Itinerary;
      }
    } catch {}
  }
  return null;
}

export default function Chat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const composerRef = useRef<HTMLDivElement | null>(null);
  const [composerH, setComposerH] = useState<number>(96);

  // medir/comunicar altura del composer -> --composer-h
  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    const update = () => setComposerH(el.offsetHeight || 96);
    update();
    let ro: ResizeObserver | null = null;
    try {
      ro = new ResizeObserver(update);
      ro.observe(el);
    } catch {}
    const onResize = () => update();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      try { ro?.disconnect(); } catch {}
    };
  }, []);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || loading) return;

    const userMsg: ChatMessage = {
      id: uuidv4(),
      role: 'user',
      parts: [{ type: 'text', text }],
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      // Espera JSON: { reply?: string, parts?: UIMessagePart[], threadId?: string }
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: { role: 'user', parts: [{ text }] } }),
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(`HTTP ${res.status}: ${t}`);
      }
      const data = await res.json();

      let assistant: ChatMessage;
      if (Array.isArray(data?.parts)) {
        assistant = { id: uuidv4(), role: 'assistant', parts: data.parts };
      } else {
        const reply = (data?.reply ?? '').toString();
        const itin = extractItineraryFromText(reply);
        assistant = itin
          ? { id: uuidv4(), role: 'assistant', parts: [{ type: 'itinerary', itinerary: itin }] }
          : { id: uuidv4(), role: 'assistant', parts: [{ type: 'text', text: reply || '…' }] };
      }

      setMessages((prev) => [...prev, assistant]);
    } catch (err) {
      console.error(err);
      setMessages((prev) => [
        ...prev,
        {
          id: uuidv4(),
          role: 'assistant',
          parts: [{
            type: 'text',
            text:
              'Hubo un problema al procesar tu mensaje. Intenta de nuevo o dime tu destino, fechas y número de personas.',
          }],
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="relative flex flex-col w-full min-h-[100dvh] bg-transparent"
      style={{ ['--composer-h' as any]: `${composerH}px` }}
    >
      {/* Área scrollable con backdrop controlado por <Messages /> */}
      <div className="flex-1 min-h-0">
        <Messages
          messages={messages}
          isLoading={loading}
          votes={[]}
          setMessages={({ messages: m }: any) => setMessages(m)}
          regenerate={async () => {}}
          isReadonly={false}
          chatId="cv"
        />
      </div>

      {/* Composer fijo */}
      <div
        ref={composerRef}
        className="fixed inset-x-0 bottom-0 z-50 border-t border-[#b69965]/25 bg-black/85 backdrop-blur"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="mx-auto max-w-3xl p-3 flex gap-2">
          <form onSubmit={handleSubmit} className="flex w-full gap-2">
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Escribe tu mensaje…"
              className="flex-1 rounded-full px-4 py-3 bg-[#2a2a2a] text-white border border-[#b69965]/30
                         focus:outline-none focus:ring-2 focus:ring-[#b69965]/50"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="h-12 w-12 rounded-full grid place-items-center bg-[#b69965] text-black disabled:opacity-50"
              title="Enviar"
            >
              {loading ? '…' : <PaperPlaneIcon className="w-5 h-5" />}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
