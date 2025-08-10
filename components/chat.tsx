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

  // 🔹 Refs
  const formRef = useRef<HTMLFormElement | null>(null);           // para submit/focus
  const composerRef = useRef<HTMLDivElement | null>(null);        // para medir altura real (incluye paddings)

  const [composerH, setComposerH] = useState<number>(96); // fallback por defecto

  // ✅ Medición segura del alto del composer (wrapper con paddings)
  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;

    const update = () => setComposerH(el.offsetHeight || 96);
    update();

    let ro: ResizeObserver | null = null;
    try {
      if (typeof window !== 'undefined' && 'ResizeObserver' in window) {
        ro = new ResizeObserver(() => {
          try { update(); } catch {}
        });
        ro.observe(el);
      }
    } catch {}

    const onResize = () => update();
    window.addEventListener('resize', onResize);

    return () => {
      try { ro && ro.disconnect(); } catch {}
      window.removeEventListener('resize', onResize);
    };
  }, []);

  // ✅ Envío del mensaje
  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!input.trim()) return;

    const userMessage: ChatMessage = {
      id: uuidv4(),
      role: 'user',
      parts: [{ type: 'text', text: input }],
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: { role: 'user', parts: [{ text: userMessage.parts[0].text }] },
          selectedChatModel: 'gpt-4o',
        }),
      });

      if (response.redirected) {
        const txt = await response.text();
        throw new Error(`Redirigido a: ${response.url} :: ${txt.slice(0, 120)}…`);
      }

      const ct = response.headers.get('content-type') || '';
      if (!response.ok) {
        const errText = ct.includes('application/json')
          ? JSON.stringify(await response.json())
          : await response.text();
        throw new Error(`HTTP ${response.status}: ${errText.slice(0, 200)}`);
      }

      if (!ct.includes('application/json')) {
        const text = await response.text();
        throw new Error(`Respuesta no-JSON: ${text.slice(0, 200)}`);
      }

      const data = await response.json();

      const assistantMessage: ChatMessage = {
        id: uuidv4(),
        role: 'assistant',
        parts: [{ type: 'text', text: data.reply || 'No response' }],
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error) {
      console.error('Error sending message:', error);
      alert('No se pudo enviar el mensaje. Intenta de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Constante para reservar espacio y para scrollPadding (coherente con la altura medida)
  const SPACER = `calc(${composerH}px + env(safe-area-inset-bottom) + 12px)`;

  return (
    <div
      className="relative flex flex-col w-full min-h-[100dvh] mx-auto bg-transparent dark:bg-transparent"
      style={{ ['--composer-h' as any]: `${composerH}px` }}
    >
      {/* Área de conversación */}
      <div
        className="flex-1 min-h-0 overflow-y-auto px-0 py-0 scroll-smooth"
        style={{
          paddingBottom: SPACER,          // reserva real para que nada quede debajo del form
          scrollPaddingBottom: SPACER,    // scrollIntoView respeta la holgura
        }}
      >
        <Messages
          messages={messages}
          isLoading={loading}
          votes={[]}
          setMessages={setMessages}
          regenerate={async () => {}}
          isReadonly={false}
          chatId="local-chat"
        />
      </div>

      {/* Barra del composer: negra con padding simétrico y responsivo */}
      <div
        className="fixed inset-x-0 bottom-0 z-50 bg-black"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div
          ref={composerRef}
          className="mx-auto max-w-3xl px-2 sm:px-4 py-2 sm:py-4"
        >
          <form
            ref={formRef}
            onSubmit={handleSubmit}
            className="w-full flex items-center gap-2 sm:gap-3"
          >
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="..."
              // Responsivo: no se corta ni empuja al botón
              className="min-w-0 flex-1 px-3 sm:px-5 py-3 rounded-full border border-gray-700
                         bg-white/70 dark:bg-white/20 text-black dark:text-white placeholder-gray-500
                         focus:outline-none focus:ring-2 focus:ring-volare-blue transition-all duration-300
                         text-[16px] md:text-base"
            />

            <button
              type="submit"
              disabled={loading || !input.trim()}
              // Responsivo: tamaños por breakpoint, no se aplasta
              className="flex-shrink-0 grid place-items-center rounded-full
                         h-10 w-10 sm:h-11 sm:w-11 md:h-12 md:w-12
                         bg-white text-black hover:bg-gray-100 transition-colors duration-300 disabled:opacity-50"
              aria-label="Enviar"
            >
              {loading ? '...' : <PaperPlaneIcon className="w-4 h-4 sm:w-5 sm:h-5" />}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
