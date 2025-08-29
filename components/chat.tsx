'use client';

import { useEffect, useRef, useState } from 'react';
import Messages from './messages';
import type { ChatMessage, Itinerary } from '@/lib/types';
import { v4 as uuidv4 } from 'uuid';
import { PaperPlaneIcon } from '@radix-ui/react-icons';

function extractItineraryFromText(text: string): Itinerary | null {
  if (!text) return null;

  const reFence = /```(?:itinerary|json)\s*([\s\S]*?)```/i;
  const m1 = text.match(reFence);
  const candidate1 = m1?.[1];

  const rePrefix = /ITINERARY_JSON\s*[:=]\s*({[\s\S]*})/i;
  const m2 = text.match(rePrefix);
  const candidate2 = m2?.[1];

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
      // Tu endpoint debe devolver { reply?: string, parts?: UIMessagePart[], threadId?: string }
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: { role: 'user', parts: [{ text }] } }),
      });

      const data = await res.json();

      let assistant: ChatMessage | null = null;

      if (Array.isArray(data?.parts)) {
        assistant = { id: uuidv4(), role: 'assistant', parts: data.parts };
      } else {
        const reply = (data?.reply ?? '').toString();
        const itin = extractItineraryFromText(reply);
        assistant = itin
          ? { id: uuidv4(), role: 'assistant', parts: [{ type: 'itinerary', itinerary: itin }] }
          : { id: uuidv4(), role: 'assistant', parts: [{ type: 'text', text: reply || '…' }] };
      }

      setMessages((prev) => [...prev, assistant!]);
    } catch (err) {
      console.error(err);
      setMessages((prev) => [
        ...prev,
        { id: uuidv4(), role: 'assistant', parts: [{ type: 'text', text: 'Error procesando tu mensaje.' }] },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full h-full flex flex-col">
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

      <div className="border-t border-gray-800/40 backdrop-blur bg-black/30">
        <div className="mx-auto max-w-3xl p-3 flex gap-2">
          <form onSubmit={handleSubmit} className="flex w-full gap-2">
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Escribe tu mensaje…"
              className="flex-1 rounded-2xl px-4 py-3 bg-black/60 text-white border border-gray-800/40
                         focus:outline-none focus:ring-2 focus:ring-yellow-500/40"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="h-12 w-12 rounded-full grid place-items-center bg-[#b69965] text-black disabled:opacity-50"
            >
              {loading ? '…' : <PaperPlaneIcon className="w-5 h-5" />}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
