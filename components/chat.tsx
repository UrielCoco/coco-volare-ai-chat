// components/chat.tsx
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

  // 🔹 Ref y estado para medir altura del composer
  const formRef = useRef<HTMLFormElement | null>(null);
  const [composerH, setComposerH] = useState<number>(72); // altura inicial aprox. del composer

  // 🔹 Ajusta la altura del área de scroll según el alto real del composer
  useEffect(() => {
    const updateComposerHeight = () => {
      if (!formRef.current) return;
      const rect = formRef.current.getBoundingClientRect();
      setComposerH(rect.height);
    };

    updateComposerHeight();

    const ro = new ResizeObserver(updateComposerHeight);
    if (formRef.current) ro.observe(formRef.current);

    // manejar cambios de viewport (teclado móvil, etc.)
    const onResize = () => updateComposerHeight();
    window.addEventListener('resize', onResize);

    return () => {
      ro.disconnect();
      window.removeEventListener('resize', onResize);
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    const newMsg: ChatMessage = {
      id: uuidv4(),
      role: 'user',
      parts: [{ type: 'text', text: input.trim() }],
    };

    setMessages((prev) => [...prev, newMsg]);
    setInput('');
    setLoading(true);

    try {
      // aquí seguiría tu lógica de envío a /api/chat o la que tengas
      // ...
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  return (
    <div
      className="relative flex flex-col w-full min-h-[100dvh] mx-auto bg-transparent dark:bg-transparent"
      style={{ ['--composer-h' as any]: `${composerH}px` }} // variable CSS
    >
      {/* Área de conversación: ocupa todo el alto disponible y hace scroll interno */}
      <div className="flex-1 min-h-0">
        <Messages
          messages={messages}
          isLoading={loading}
          votes={[]}
          setMessages={(fn: any) => setMessages(fn)}
          regenerate={async () => {}}
          isReadonly={false}
          isPreview={false}
        />
      </div>

      {/* Composer fijo al fondo, sin tapar el scroll (usa la var --composer-h) */}
      <div
        className="sticky bottom-0 left-0 right-0 w-full backdrop-blur supports-[backdrop-filter]:bg-black/5 dark:supports-[backdrop-filter]:bg-white/5"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <form
          ref={formRef}
          onSubmit={handleSubmit}
          className="mx-auto max-w-3xl w-full gap-3 px-4 py-3 flex items-center"
        >
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Escribe tu mensaje..."
            className="flex-1 px-5 py-3 rounded-full border border-border focus:outline-none focus:ring-2 focus:ring-volare-blue transition-all duration-300 bg-transparent"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="bg-white text-black hover:bg-gray-100 transition-colors duration-300 rounded-full p-3 disabled:opacity-50 dark:bg-white dark:text-black"
          >
            {loading ? '...' : <PaperPlaneIcon className="w-5 h-5" />}
          </button>
        </form>
      </div>
    </div>
  );
}
