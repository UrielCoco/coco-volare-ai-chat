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
  const [hasFirstDelta, setHasFirstDelta] = useState(false);

  const threadIdRef = useRef<string | null>(null);

  // ThreadId desde storage
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

      const applyDelta = (chunk: string) => {
        setMessages((prev) => {
          const next = [...prev];
          const idx = next.findIndex((m) => m.id === aid);
          if (idx >= 0) {
            const curr = next[idx] as any;
            const before = curr.parts?.[0]?.text ?? '';
            curr.parts[0].text = before + chunk;
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
                try {
                  window.sessionStorage.setItem(THREAD_KEY, data.threadId);
                  window.localStorage.setItem(THREAD_KEY, data.threadId);
                  (window as any).cvThreadId = data.threadId;
                } catch {}
              }
            } catch {}
          } else if (event === 'delta') {
            try {
              const data = JSON.parse(dataLine || '{}');
              if (typeof data?.value === 'string' && data.value.length) {
                if (!hasFirstDelta) setHasFirstDelta(true);
                applyDelta(data.value);
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
      console.error(err);
      setIsLoading(false);
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const text = input.trim();

    // pinta mensaje del usuario
    addMessage({
      id: `u_${Date.now()}`,
      role: 'user',
      parts: [{ type: 'text', text }] as any,
      createdAt: new Date().toISOString(),
    } as any);
    setInput('');

    // streaming inmediato
    await handleStream(text);
  };

  // Mantenemos tu layout y colores
  return (
    <div
      className="flex flex-col min-h-[100dvh] bg-background text-foreground"
      style={{ ['--composer-h' as any]: `${COMPOSER_H}px` }}
    >
      <div className="flex-1 min-h-0">
        <Messages
          messages={messages}
          isLoading={isLoading && !hasFirstDelta /* oculta “pensando” al primer token */}
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
