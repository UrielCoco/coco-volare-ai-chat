'use client';

import { useEffect, useRef, useState } from 'react';
import Messages from './messages';
import type { ChatMessage } from '@/lib/types';

const THREAD_KEY = 'cv_thread_id';
const COMPOSER_H = 72; // px

export default function Chat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const threadIdRef = useRef<string | null>(null);

  // Lee threadId de localStorage o sessionStorage (y sincroniza ambos)
  useEffect(() => {
    const ls = typeof window !== 'undefined' ? window.localStorage.getItem(THREAD_KEY) : null;
    const ss = typeof window !== 'undefined' ? window.sessionStorage.getItem(THREAD_KEY) : null;
    const existing = ss || ls || (typeof window !== 'undefined' ? (window as any).cvThreadId : null);
    if (existing) {
      threadIdRef.current = existing;
      try {
        window.localStorage.setItem(THREAD_KEY, existing);
        window.sessionStorage.setItem(THREAD_KEY, existing);
      } catch {}
    }
  }, []);

  const addMessage = (m: ChatMessage) => {
    setMessages((prev) => [...prev, m]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const text = input.trim();

    addMessage({
      id: `u_${Date.now()}`,
      role: 'user',
      parts: [{ type: 'text', text }],
      createdAt: new Date().toISOString(),
    } as any);
    setInput('');
    setIsLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: { role: 'user', parts: [{ type: 'text', text }] },
          threadId: threadIdRef.current,
        }),
      });

      const data = await res.json();
      const raw = String(data?.reply || '');

      if (data?.threadId) {
        threadIdRef.current = data.threadId;
        try {
          window.sessionStorage.setItem(THREAD_KEY, data.threadId);
          window.localStorage.setItem(THREAD_KEY, data.threadId);
          (window as any).cvThreadId = data.threadId;
        } catch {}
      }

      addMessage({
        id: `a_${Date.now()}`,
        role: 'assistant',
        parts: [{ type: 'text', text: raw }],
        createdAt: new Date().toISOString(),
      } as any);
    } catch (err: any) {
      addMessage({
        id: `e_${Date.now()}`,
        role: 'assistant',
        parts: [{ type: 'text', text: '⚠️ Tuvimos un problema procesando tu mensaje. Intenta de nuevo.' }],
        createdAt: new Date().toISOString(),
      } as any);
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      className="flex flex-col min-h-[100dvh] bg-background text-foreground"
      style={{ ['--composer-h' as any]: `${COMPOSER_H}px` }}
    >
      {/* mensajes */}
      <div className="flex-1 min-h-0">
        <Messages
          messages={messages}
          isLoading={isLoading}
          setMessages={({ messages }) => setMessages(messages)}
          regenerate={async () => {}}
          isReadonly={false}
          chatId="main"
        />
      </div>

      {/* input: fijo al fondo del iframe */}
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
