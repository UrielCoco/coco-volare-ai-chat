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
  const [composerH, setComposerH] = useState<number>(96); // fallback por defecto

  // ✅ Medición segura del alto del composer
  useEffect(() => {
    const el = formRef.current;
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

    window.addEventListener('resize', update);

    return () => {
      try { ro && ro.disconnect(); } catch {}
      window.removeEventListener('resize', update);
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

  return (
    <div
      className="relative flex flex-col w-full min-h-[100dvh] mx-auto bg-transparent dark:bg-transparent"
      style={{ ['--composer-h' as any]: `${composerH}px` }}
    >
      {/* Área de conversación */}
      <div className="flex-1 overflow-y-auto px-0 py-0 scroll-smooth">
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

      <form
        ref={formRef}
        onSubmit={handleSubmit}
        className="fixed bottom-0 left-0 right-0 w-full mx-auto bg-black border-t border-transparent dark:border-transparent flex p-4 sm:p-9 gap-3 items-center z-50"
      >
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="..."
          className="flex-1 px-5 py-3 rounded-full border border-gray-700 bg-white/70 dark:bg-white/70 text-black dark:text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-volare-blue transition-all duration-300"
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="bg-white text-black hover:bg-gray-100 transition-colors duration-300 rounded-full p-3 disabled:opacity-50"
        >
          {loading ? '...' : <PaperPlaneIcon className="w-5 h-5" />}
        </button>
      </form>
    </div>
  );
}
