'use client';

import { useEffect, useRef, useState } from 'react';
import Messages from './messages';
import type { ChatMessage } from '@/lib/types';

const THREAD_KEY = 'cv_thread_id';

export default function Chat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const threadIdRef = useRef<string | null>(null);
  useEffect(() => {
    threadIdRef.current = window.sessionStorage.getItem(THREAD_KEY) || null;
  }, []);

  const addMessage = (msg: ChatMessage) => setMessages(prev => [...prev, msg]);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const text = input.trim();
    if (!text) return;

    // mensaje user
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
          message: { role: 'user', parts: [{ text }] },
          threadId: threadIdRef.current,
        }),
      });

      const data = await res.json();
      const raw = String(data?.reply || '');

      if (data?.threadId) {
        threadIdRef.current = data.threadId;
        window.sessionStorage.setItem(THREAD_KEY, data.threadId);
      }

      addMessage({
        id: `a_${Date.now()}`,
        role: 'assistant',
        parts: [{ type: 'text', text: raw }],
        createdAt: new Date().toISOString(),
      } as any);
    } catch (err) {
      addMessage({
        id: `a_${Date.now()}`,
        role: 'assistant',
        parts: [{ type: 'text', text: 'Ocurrió un error, lamentamos los inconvenientes.' }],
        createdAt: new Date().toISOString(),
      } as any);
      console.error('[CV][client] /api/chat error', err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-black relative">
      {/* mensajes */}
      <Messages
        messages={messages}
        isLoading={isLoading}
        setMessages={({ messages }) => setMessages(messages)}
        regenerate={async () => {}}
        isReadonly={false}
        chatId="main"
      />

      {/* input */}
      <form
        onSubmit={handleSubmit}
        className="sticky bottom-0 w-full bg-[#0d0d0d] border-t border-white/10"
      >
        <div className="mx-auto max-w-4xl px-4 py-4 flex items-center gap-2">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Escribe tu mensaje…"
            className="flex-1 rounded-full bg-black text-white px-5 py-3 outline-none"
          />
          <button
            type="submit"
            className="rounded-full bg-[#bba36d] text-black px-4 py-3 font-medium hover:opacity-90 transition"
          >
            ➤
          </button>
        </div>
      </form>
    </div>
  );
}
