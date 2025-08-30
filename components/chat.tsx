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
  // Controla spinner/loader del primer token
  const [hasFirstDelta, setHasFirstDelta] = useState(false);

  const threadIdRef = useRef<string | null>(null);

  // Recupera threadId de la sesión para mantener contexto de OpenAI
  useEffect(() => {
    try {
      const ss = typeof window !== 'undefined' ? window.sessionStorage.getItem(THREAD_KEY) : null;
      if (ss) threadIdRef.current = ss;
    } catch {
      // no-op
    }
  }, []);

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

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      if (!res.body) {
        throw new Error('Stream not supported by browser.');
      }

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

          if (!event) continue;

          if (event === 'meta') {
            try {
              const data = JSON.parse(dataLine || '{}');
              if (data?.threadId) {
                threadIdRef.current = data.threadId as string;
                try {
                  window.sessionStorage.setItem(THREAD_KEY, data.threadId);
                } catch {}
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
            // Server-side error surfaced via SSE
            setIsLoading(false);
          } else {
            // ping u otros eventos -> ignore
          }
        }
      }
    } catch (err) {
      console.error('[CV][chat] stream error:', err);
      setIsLoading(false);
      // Pintamos error en el placeholder
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

    // 1) Empuja mensaje del usuario (se conserva historial)
    const userMsg: ChatMessage = {
      id: userId,
      role: 'user',
      parts: [{ type: 'text', text }] as any,
      createdAt: new Date().toISOString(),
    } as any;

    // 2) Placeholder del asistente (una sola burbuja por turno)
    const assistantPlaceholder: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      parts: [{ type: 'text', text: '' }] as any,
      createdAt: new Date().toISOString(),
    } as any;

    setMessages((prev) => [...prev, userMsg, assistantPlaceholder]);
    setInput('');

    await handleStream(text, assistantId);
  };

  return (
    <div className="relative flex flex-col w-full h-full" style={{ ['--composer-h' as any]: `${COMPOSER_H}px` }}>
      {/* 
        NOTA: Messages controla colores de burbujas, GIF de fondo y detección de bloques (p.ej. ```cv:itinerary ...```).
        Pasamos las props exactas que espera para no romper UI.
      */}
      <Messages
        messages={messages}
        isLoading={isLoading && !hasFirstDelta}
        setMessages={({ messages }) => setMessages(messages)}
        regenerate={async () => {}}
        isReadonly={false}
        chatId="main"
        votes={[]}
      />

      {/* Composer pegado al fondo, respeta tu estilo previo */}
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
