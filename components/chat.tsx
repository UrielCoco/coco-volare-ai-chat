'use client';

import { useEffect, useRef, useState } from 'react';
import Messages from './messages';
import type { ChatMessage } from '@/lib/types';
import { v4 as uuidv4 } from 'uuid';
import { PaperPlaneIcon } from '@radix-ui/react-icons';

export default function Chat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const composerRef = useRef<HTMLDivElement | null>(null);
  const [composerH, setComposerH] = useState<number>(96);

  // Medir altura del composer para reservar espacio en el scroll
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

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || loading) return;

    // Mensaje del usuario
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
      // Reuso de threadId guardado
      const stored =
        (typeof window !== 'undefined' && (window as any).cvThreadId) ||
        (typeof window !== 'undefined' && localStorage.getItem('cv_thread_id')) ||
        null;

      console.log('[CV][client] sending ->', {
        textPreview: text.slice(0, 80),
        threadId: stored,
      });

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: { role: 'user', parts: [{ text }] },
          threadId: stored,
        }),
      });

      const ct = res.headers.get('content-type') || '';
      if (!res.ok) {
        const t = ct.includes('application/json') ? JSON.stringify(await res.json()) : await res.text();
        console.error('[CV][client] /api/chat error', res.status, t);
        throw new Error(`HTTP ${res.status}: ${t.slice(0, 300)}`);
      }
      if (!ct.includes('application/json')) throw new Error('Respuesta no-JSON');

      const data = await res.json(); // { reply, threadId, debug? }

      if (data?.threadId) {
        try { localStorage.setItem('cv_thread_id', data.threadId); } catch {}
        (window as any).cvThreadId = data.threadId;
      }
      console.log('[CV][client] received <-', {
        replyPreview: (data?.reply ?? '').slice(0, 80),
        threadId: data?.threadId,
      });

      const assistant: ChatMessage = {
        id: uuidv4(),
        role: 'assistant',
        parts: [{ type: 'text', text: (data?.reply ?? '').toString() || '…' }],
      };
      setMessages((prev) => [...prev, assistant]);
    } catch (err) {
      console.error('[CV][client] exception', err);
      setMessages((prev) => [
        ...prev,
        {
          id: uuidv4(),
          role: 'assistant',
          parts: [{ type: 'text', text: 'Tuvimos un problema. ¿Destino, fechas y número de personas?' }],
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const SPACER = `calc(${composerH}px + env(safe-area-inset-bottom) + 8px)`;
  const showBackdrop = messages.length === 0;

  return (
    <div
      className="relative flex flex-col w-full min-h-[100dvh]"
      style={{ ['--composer-h' as any]: `${composerH}px` }}
    >
      {/* 🎬 Pre-chat: GIF centrado (no full screen), sin gradiente */}
      {showBackdrop && (
        <div className="pointer-events-none fixed inset-0 -z-10 grid place-items-center bg-black">
          <img
            src="../images/Texts.gif"
            alt="Coco Volare"
            className="max-w-[min(92vw,900px)] max-h-[70vh] w-auto h-auto object-contain rounded-2xl"
          />
        </div>
      )}

      {/* Área de conversación */}
      <div
        className="flex-1 min-h-0 overflow-y-auto px-0 py-0 scroll-smooth"
        style={{ paddingBottom: SPACER, scrollPaddingBottom: SPACER }}
      >
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
        className="fixed inset-x-0 bottom-0 z-50 border-t border-[#b69965]/25 bg-black/90 backdrop-blur"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="mx-auto max-w-3xl p-3 flex gap-2">
          <form onSubmit={handleSubmit} className="flex w-full gap-2">
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Escribe tu mensaje…"
              className="flex-1 rounded-full px-4 py-3
                         bg-black text-white placeholder-white/50
                         border border-[#b69965]/40 focus:outline-none
                         focus:ring-2 focus:ring-[#b69965]/60"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="h-12 w-12 rounded-full grid place-items-center
                         bg-[#b69965] text-black disabled:opacity-50"
              title="Enviar"
              aria-label="Enviar"
            >
              {loading ? '…' : <PaperPlaneIcon className="w-5 h-5" />}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
