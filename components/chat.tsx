'use client';

import { useEffect, useRef, useState } from 'react';
import Messages from './messages';
import type { ChatMessage } from '@/lib/types';
import { v4 as uuidv4 } from 'uuid';
import { PaperPlaneIcon } from '@radix-ui/react-icons';

type SetMessagesFn = (updater: { messages: ChatMessage[] }) => void;

export default function Chat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const composerRef = useRef<HTMLDivElement | null>(null);
  const [composerH, setComposerH] = useState<number>(96);

  // Mide altura del composer y la expone como --composer-h (para que <Messages /> reserve espacio)
  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    const update = () => setComposerH(el.offsetHeight || 96);
    update();
    let ro: ResizeObserver | null = null;
    try { ro = new ResizeObserver(update); ro.observe(el); } catch {}
    const onResize = () => update();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      try { ro?.disconnect(); } catch {}
    };
  }, []);

  useEffect(() => { inputRef.current?.focus(); }, []);

  // Envío
  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || loading) return;

    const user: ChatMessage = {
      id: uuidv4(),
      role: 'user',
      parts: [{ type: 'text', text }],
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, user]);
    setInput('');
    setLoading(true);

    try {
      const threadId =
        (typeof window !== 'undefined' && (window as any).cvThreadId) ||
        (typeof window !== 'undefined' && localStorage.getItem('cv_thread_id')) ||
        null;

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: { role: 'user', parts: [{ text }] },
          selectedChatModel: 'gpt-4o',
          threadId,
        }),
      });

      const ct = res.headers.get('content-type') || '';
      if (!res.ok) {
        const t = ct.includes('application/json') ? JSON.stringify(await res.json()) : await res.text();
        throw new Error(`HTTP ${res.status}: ${t.slice(0, 200)}`);
      }
      if (!ct.includes('application/json')) throw new Error(`Respuesta no-JSON`);

      const data = await res.json(); // { reply, threadId }

      if (data?.threadId) {
        try { localStorage.setItem('cv_thread_id', data.threadId); } catch {}
        (window as any).cvThreadId = data.threadId;
      }

      const assistant: ChatMessage = {
        id: uuidv4(),
        role: 'assistant',
        parts: [{ type: 'text', text: (data?.reply ?? '').toString() || '…' }],
      };
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
            text: 'Hubo un problema. Dime destino, fechas y número de personas y lo intentamos de nuevo.',
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
      {/* Área de conversación */}
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

      {/* Composer fijo negro/dorado */}
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
              aria-label="Enviar"
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
