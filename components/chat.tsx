'use client';

import { useEffect, useRef, useState } from 'react';
import Messages from './messages';
import type { ChatMessage } from '@/lib/types';

const THREAD_KEY = 'cv_thread_id_session'; // ← SOLO sessionStorage
const COMPOSER_H = 72;

export default function Chat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [hasFirstDelta, setHasFirstDelta] = useState(false);

  const threadIdRef = useRef<string | null>(null);

  useEffect(() => {
    const ss = typeof window !== 'undefined' ? window.sessionStorage.getItem(THREAD_KEY) : null;
    if (ss) threadIdRef.current = ss;
  }, []);

  const addMessage = (m: ChatMessage) => setMessages((prev) => [...prev, m]);

  async function handleStream(userText: string) {
    setIsLoading(true);
    setHasFirstDelta(false);

    // placeholder del assistant
    const aid = `a_${Date.now()}`;
    addMessage({
      id: aid,
      role: 'assistant',
      parts: [{ type: 'text', text: '' } as any],
      createdAt: new Date().toISOString(),
    } as any);

    try {
      const res = await fetch('/api/chat?stream=1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({
          message: { role: 'user', parts: [{ type: 'text', text: userText }] },
          threadId: threadIdRef.current,
        }),
      });
      if (!res.body) throw new Error('Stream not supported');

      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let receivedAny = false;

      const applyText = (chunk: string, replace = false) => {
        setMessages((prev) => {
          const next = [...prev];
          const idx = next.findIndex((m) => m.id === aid);
          if (idx >= 0) {
            const curr = next[idx] as any;
            const before = curr.parts?.[0]?.text ?? '';
            curr.parts[0].text = replace ? chunk : before + chunk;
            next[idx] = curr;
          }
          return next;
        });
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const events = buffer.split('\n\n');
        buffer = events.pop() || '';

        for (const evt of events) {
          const lines = evt.split('\n');
          const event = (lines.find(l => l.startsWith('event:')) || '').replace('event:','').trim();
          const dataLine = (lines.find(l => l.startsWith('data:')) || '').replace('data:','').trim();
          if (!event) continue;

          if (event === 'meta') {
            try {
              const data = JSON.parse(dataLine || '{}');
              if (data?.threadId) {
                threadIdRef.current = data.threadId;
                try { window.sessionStorage.setItem(THREAD_KEY, data.threadId); } catch {}
              }
            } catch {}
          } else if (event === 'delta') {
            try {
              const data = JSON.parse(dataLine || '{}');
              if (typeof data?.value === 'string' && data.value.length) {
                if (!hasFirstDelta) setHasFirstDelta(true);
                receivedAny = true;
                applyText(data.value);
              }
            } catch {}
          } else if (event === 'final') {
            // Rellena si no hubo deltas o completa el bloque para el ItineraryCard
            try {
              const data = JSON.parse(dataLine || '{}');
              if (typeof data?.text === 'string') {
                if (!hasFirstDelta) setHasFirstDelta(true);
                receivedAny = true;
                applyText(data.text, true);
              }
            } catch {}
          } else if (event === 'done') {
            setIsLoading(false);
          } else if (event === 'error') {
            setIsLoading(false);
          }
        }
      }

      if (!receivedAny) {
        // Seguridad extra: mensaje de error amable
        applyText('⚠️ Hubo un problema obteniendo la respuesta. Intenta de nuevo.', true);
      }
    } catch (err) {
      console.error(err);
      setIsLoading(false);
      // Fallback UI
      addMessage({
        id: `e_${Date.now()}`,
        role: 'assistant',
        parts: [{ type: 'text', text: '⚠️ No pude conectarme. Intenta otra vez.' }] as any,
        createdAt: new Date().toISOString(),
      } as any);
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const text = input.trim();
    addMessage({
      id: `u_${Date.now()}`,
      role: 'user',
      parts: [{ type: 'text', text }] as any,
      createdAt: new Date().toISOString(),
    } as any);
    setInput('');
    await handleStream(text);
  };

  return (
    <div
      className="flex flex-col min-h-[100dvh] bg-background text-foreground"
      style={{ ['--composer-h' as any]: `${COMPOSER_H}px` }}
    >
      <div className="flex-1 min-h-0">
        <Messages
          messages={messages}
          isLoading={isLoading && !hasFirstDelta} // oculta “pensando” en el primer token o final
          setMessages={({ messages }) => setMessages(messages)}
          regenerate={async () => {}}
          isReadonly={false}
          chatId="main"
        />
      </div>

      <form
        onSubmit={handleSubmit}
        className="fixed bottom-0 left-0 right-0 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60"
        style={{ height: COMPOSER_H }}
      >
        <div className="mx-auto max-w-4xl h-full px-4 flex items-center gap-2">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Escribe tu mensaje…"
            className="flex-1 rounded-full bg-muted px-5 py-3 outline-none text-foreground placeholder:text-muted-foreground"
          />
          <button
            type="submit"
            className="rounded-full px-4 py-3 font-medium hover:opacity-90 transition bg-[#bba36d] text-black"
            aria-label="Enviar"
          >
            ➤
          </button>
        </div>
      </form>
    </div>
  );
}
