'use client';

import { useEffect, useRef, useState } from 'react';
import Messages from './messages';
import type { ChatMessage } from '@/lib/types';
import { v4 as uuidv4 } from 'uuid';
import { PaperPlaneIcon } from '@radix-ui/react-icons';

const CV_SESSION_KEY = 'cv_session';

function getOrCreateSessionId() {
  try {
    const s = localStorage.getItem(CV_SESSION_KEY);
    if (s) return s;
    const nu = uuidv4();
    localStorage.setItem(CV_SESSION_KEY, nu);
    return nu;
  } catch {
    return uuidv4();
  }
}

export default function Chat({
  id,
  initialMessages = [],
  initialChatModel,
  initialVisibilityType,
  isReadonly,
  session,
  autoResume = false,
}: {
  id: string;
  initialMessages?: ChatMessage[];
  initialChatModel?: string;
  initialVisibilityType?: 'public' | 'private';
  isReadonly?: boolean;
  session?: any;
  autoResume?: boolean;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, loading]);

  useEffect(() => {
    inputRef.current?.focus();
    // crea/recupera sesión
    getOrCreateSessionId();
  }, []);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const text = input.trim();
    if (!text || loading) return;

    const userMsg: ChatMessage = {
      id: uuidv4(),
      role: 'user',
      content: [{ type: 'text', text: { value: text } }],
      createdAt: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    const controller = new AbortController();
    abortRef.current = controller;

    const userId = getOrCreateSessionId();
    let full = '';

    try {
      // ⚠️ Ruta correcta del Route Handler (segmento de grupo (chat) no participa en la URL)
      const res = await fetch('/api/chat', {
        method: 'POST',
        body: JSON.stringify({
          message: text,
          userId,
          metadata: { chatId: id },
        }),
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const errText = await res.text();
        throw new Error(errText || 'No stream');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        const parts = chunk.split('\n\n').filter(Boolean);
        for (const p of parts) {
          if (!p.startsWith('data:')) continue;
          const payloadRaw = p.slice(5).trim();
          if (!payloadRaw) continue;
          let payload: any;
          try { payload = JSON.parse(payloadRaw); } catch { continue; }

          if (payload.type === 'delta' && typeof payload.text === 'string') {
            full += payload.text;
          } else if (payload.type === 'done') {
            full = payload.text ?? full;
          } else if (payload.type === 'error') {
            throw new Error(payload.error || 'Assistant error');
          }
        }
      }

      if (full && full.trim().length > 0) {
        const assistantMsg: ChatMessage = {
          id: uuidv4(),
          role: 'assistant',
          content: [{ type: 'text', text: { value: full } }],
          createdAt: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, assistantMsg]);
      }
    } catch (err) {
      console.error('CV Chat error:', err);
      const errMsg: ChatMessage = {
        id: uuidv4(),
        role: 'assistant',
        content: [{ type: 'text', text: { value: 'Lo siento, hubo un problema procesando tu mensaje.' } }],
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errMsg]);
    } finally {
      setLoading(false);
      abortRef.current = null;
      bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  };

  const handleStop = () => {
    try { abortRef.current?.abort(); } catch {}
    setLoading(false);
  };

  return (
    <div className="w-full h-full flex flex-col">
      <div id="cv-chat-scroll" className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {/* ✅ Solo pasamos props que existen */}
        <Messages messages={messages} isLoading={loading} />
        <div ref={bottomRef} />
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
                         text-[16px] md:text-base focus:outline-none focus:ring-2 focus:ring-yellow-500/40"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="flex-shrink-0 grid place-items-center rounded-full
                         h-12 w-12 bg-yellow-500 text-black font-semibold hover:opacity-90 transition disabled:opacity-50"
              aria-label="Enviar"
              title="Enviar"
            >
              {loading ? '…' : <PaperPlaneIcon className="w-5 h-5" />}
            </button>
            {loading && (
              <button
                type="button"
                onClick={handleStop}
                className="px-4 rounded-xl border border-yellow-500/40 text-yellow-500"
                title="Detener"
              >
                Detener
              </button>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
