'use client';

import { useEffect, useRef, useState } from 'react';
import Messages from './messages';
import type { ChatMessage } from '@/lib/types';

const THREAD_KEY = 'cv_thread_id_session'; // sessionStorage
const COMPOSER_H = 72;

export default function Chat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const threadIdRef = useRef<string | null>(null);

  useEffect(() => {
    const ss = typeof window !== 'undefined' ? window.sessionStorage.getItem(THREAD_KEY) : null;
    if (ss) threadIdRef.current = ss;
  }, []);

  const setLastTurn = (userMsg: ChatMessage, assistantMsg?: ChatMessage) => {
    setMessages(assistantMsg ? [userMsg, assistantMsg] : [userMsg]);
  };

  async function handleStream(userText: string) {
    setIsLoading(true);

    const aid = `a_${Date.now()}`;
    // placeholder del assistant (siempre exactamente 1)
    const assistantPlaceholder: ChatMessage = {
      id: aid,
      role: 'assistant',
      parts: [{ type: 'text', text: '' } as any],
      createdAt: new Date().toISOString(),
    } as any;

    try {
      const res = await fetch('/api/chat?stream=1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: { role: 'user', parts: [{ type: 'text', text: userText }] },
          threadId: threadIdRef.current,
        }),
      });
      if (!res.body) throw new Error('Stream not supported');

      // aseguramos en UI: [user, assistant]
      setMessages((prev) => {
        const user = prev[0] && prev[0].role === 'user' ? prev[0] : null;
        if (user) return [user, assistantPlaceholder];
        return prev;
      });

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

        for (const ev of events) {
          const lines = ev.split('\n');
          const event = (lines.find((l) => l.startsWith('event:')) || '').replace('event:', '').trim();
          const dataLine = (lines.find((l) => l.startsWith('data:')) || '').replace('data:', '').trim();
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
                receivedAny = true;
                applyText(data.value);
              }
            } catch {}
          } else if (event === 'final') {
            try {
              const data = JSON.parse(dataLine || '{}');
              if (typeof data?.text === 'string') {
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
        applyText('⚠️ Hubo un problema obteniendo la respuesta. Intenta de nuevo.', true);
      }
    } catch (err) {
      console.error(err);
      setIsLoading(false);
      // Reemplaza el placeholder con error
      setMessages((prev) => {
        const next = [...prev];
        const idx = next.findIndex((m) => m.id === aid);
        if (idx >= 0) {
          (next[idx] as any).parts = [{ type: 'text', text: '⚠️ No pude conectarme. Intenta otra vez.' }];
        }
        return next;
      });
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const text = input.trim();

    // SIEMPRE un turno visible: user + assistant
    const userMsg: ChatMessage = {
      id: `u_${Date.now()}`,
      role: 'user',
      parts: [{ type: 'text', text }] as any,
      createdAt: new Date().toISOString(),
    } as any;

    setLastTurn(userMsg); // limpia y coloca solo el user
    setInput('');
    await handleStream(text);
  };

  return (
    <div className="relative flex flex-col w-full h-full" style={{ ['--composer-h' as any]: `${COMPOSER_H}px` }}>
      <Messages
  messages={messages}
  isLoading={isLoading}
  // Messages espera un setter con { messages: ChatMessage[] }
  setMessages={({ messages }) => setMessages(messages)}
  // Puede ser noop, pero debe devolver void | Promise<void>
  regenerate={async () => {}}
  // Estos dos SON REQUERIDOS por Messages.tsx
  isReadonly={false}
  chatId="main"
  // Opcional, pero lo dejamos explícito
  votes={[]}
/>


      <form onSubmit={handleSubmit} className="sticky bottom-0 left-0 right-0 w-full bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto max-w-3xl flex items-center gap-2 p-3">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
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
