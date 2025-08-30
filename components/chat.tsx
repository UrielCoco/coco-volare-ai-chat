'use client';

import { useEffect, useRef, useState } from 'react';
import Messages from './messages';
import type { ChatMessage } from '@/lib/types';

const THREAD_KEY = 'cv_thread_id_session';
const COMPOSER_H = 84; // alto real del composer

export default function Chat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [hasFirstDelta, setHasFirstDelta] = useState(false);

  const threadIdRef = useRef<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  // Mantén threadId (memoria de conversación)
  useEffect(() => {
    try {
      const ss = window.sessionStorage.getItem(THREAD_KEY);
      if (ss) threadIdRef.current = ss;
    } catch {}
  }, []);

  // Auto-scroll al final cuando cambian mensajes o llega primer token
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    // pequeño timeout para esperar layout
    const t = setTimeout(() => {
      el.scrollTop = el.scrollHeight;
    }, 0);
    return () => clearTimeout(t);
  }, [messages, hasFirstDelta]);

  async function handleStream(userText: string, assistantId: string) {
    setIsLoading(true);
    setHasFirstDelta(false);

    try {
      const res = await fetch('/api/chat?stream=1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: { role: 'user', parts: [{ type: 'text', text: userText }] },
          threadId: threadIdRef.current,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (!res.body) throw new Error('Stream no soportado.');

      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      const applyText = (chunk: string, replace = false) => {
        setMessages((prev) => {
          const next = [...prev];
          const idx = next.findIndex((m) => m.id === assistantId);
          if (idx >= 0) {
            const curr = next[idx] as any;
            const before = curr.parts?.[0]?.text ?? '';
            curr.parts = [{ type: 'text', text: replace ? chunk : before + chunk }];
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

        for (const ev of events) {
          const lines = ev.split('\n');
          const event = (lines.find((l) => l.startsWith('event:')) || '').replace('event:', '').trim();
          const dataLine = (lines.find((l) => l.startsWith('data:')) || '').replace('data:', '').trim();

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
                applyText(data.value);
              }
            } catch {}
          } else if (event === 'final') {
            try {
              const data = JSON.parse(dataLine || '{}');
              if (typeof data?.text === 'string') {
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
    } catch (err) {
      console.error('[CV][chat] stream error:', err);
      setIsLoading(false);
      // Pinta error en placeholder
      setMessages((prev) => {
        const next = [...prev];
        const idx = next.findIndex((m) => m.id === assistantId);
        if (idx >= 0) {
          (next[idx] as any).parts = [{ type: 'text', text: '⚠️ No pude conectarme. Intenta otra vez.' }];
        }
        return next;
      });
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || isLoading) return;

    const userId = `u_${Date.now()}`;
    const assistantId = `a_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    const userMsg: ChatMessage = {
      id: userId,
      role: 'user',
      parts: [{ type: 'text', text }] as any,
      createdAt: new Date().toISOString(),
    } as any;

    const assistantPlaceholder: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      parts: [{ type: 'text', text: '' }] as any,
      createdAt: new Date().toISOString(),
    } as any;

    // Mantén historial (no lo borres)
    setMessages((prev) => [...prev, userMsg, assistantPlaceholder]);
    setInput('');
    await handleStream(text, assistantId);
  };

  return (
    <div
      className="relative flex flex-col w-full min-h-[100dvh] bg-background"
      style={{ ['--composer-h' as any]: `${COMPOSER_H}px` }}
    >
      {/* Lista de mensajes scrolleable. Deja espacio al final para el composer */}
      <div
        ref={listRef}
        className="flex-1 overflow-y-auto"
        style={{ paddingBottom: `calc(var(--composer-h) + env(safe-area-inset-bottom))` }}
      >
        <Messages
          messages={messages}
          isLoading={isLoading && !hasFirstDelta}
          setMessages={({ messages }) => setMessages(messages)}
          regenerate={async () => {}}
          isReadonly={false}
          chatId="main"
          votes={[]}
        />
      </div>

      {/* Composer sticky con efecto cristal que no “sube” al escribir */}
      <form
        onSubmit={handleSubmit}
        className="sticky bottom-0 left-0 right-0 w-full border-t border-white/10 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="mx-auto max-w-3xl flex items-center gap-2 px-3 py-4">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Escribe tu mensaje…"
            className="flex-1 rounded-full bg-muted px-5 py-3 outline-none text-foreground placeholder:text-muted-foreground"
          />
          <button
            type="submit"
            className="rounded-full px-4 py-3 font-medium hover:opacity-90 transition bg-[#bba36d] text-black shadow"
            aria-label="Enviar"
          >
            ➤
          </button>
        </div>
      </form>
    </div>
  );
}
