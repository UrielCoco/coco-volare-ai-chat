'use client';

import { useEffect, useRef, useState } from 'react';
import Messages from './messages';
import type { ChatMessage } from '@/lib/types';
import { v4 as uuidv4 } from 'uuid';
import { PaperPlaneIcon } from '@radix-ui/react-icons';

/* ========= Helpers de sesión (frontend) ========= */
const CV_SESSION_KEY = 'cv_session';

async function fetchJson(input: RequestInfo, init?: RequestInit) {
  const res = await fetch(input, init);
  const text = await res.text();
  try {
    const json = JSON.parse(text);
    if (!res.ok) throw Object.assign(new Error(json?.error || res.statusText), { status: res.status, json });
    return json;
  } catch {
    if (!res.ok) throw Object.assign(new Error(text || res.statusText), { status: res.status, text });
    return text as any;
  }
}

async function ensureWebSession(): Promise<{ sessionId: string; threadId: string }> {
  let sid = '';
  try { sid = localStorage.getItem(CV_SESSION_KEY) || ''; } catch {}

  const url = sid ? `/api/chat/session?sid=${encodeURIComponent(sid)}` : `/api/chat/session`;
  const data = await fetchJson(url, {
    method: 'GET',
    headers: sid ? { 'x-cv-session': sid } : undefined,
    cache: 'no-store',
  });

  const sessionId = String(data?.sessionId || '');
  const threadId  = String(data?.threadId  || '');

  if (sessionId) {
    try { localStorage.setItem(CV_SESSION_KEY, sessionId); } catch {}
    (window as any).cvSessionId = sessionId;
  }
  if (threadId) (window as any).cvThreadId = threadId;

  return { sessionId, threadId };
}

function peekSessionId(): string {
  try { return localStorage.getItem(CV_SESSION_KEY) || ''; } catch { return ''; }
}

/* ========= Componente ========= */
export default function Chat() {
  // 👇 Usa ChatMessage con `parts`
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // 🔹 Refs para calcular altura del composer
  const formRef = useRef<HTMLFormElement | null>(null);
  const composerRef = useRef<HTMLDivElement | null>(null);
  const [composerH, setComposerH] = useState<number>(96);

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

  // ✅ Asegura sesión al montar (y enfoca input)
  useEffect(() => {
    inputRef.current?.focus();
    ensureWebSession().catch((e) => {
      console.warn('CV: ensureWebSession failed (fallback seguirá funcionando):', e);
    });
  }, []);

  // ✅ Envío del mensaje (siempre con x-cv-session)
  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const raw = input.trim();
    if (!raw) return;

    // Mensaje del usuario con `parts`
    const userMessage: ChatMessage = {
      id: uuidv4(),
      role: 'user',
      parts: [{ type: 'text', text: raw }],
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    try {
      await ensureWebSession();
      const sid = peekSessionId();

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(sid ? { 'x-cv-session': sid } : {}),
        },
        body: JSON.stringify({
          // El backend espera el formato de OpenAI (string)
          messages: [{ role: 'user', content: raw }],
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

      const data = await response.json(); // { reply, threadId, toolEvents, ... }
      if (data?.threadId) (window as any).cvThreadId = data.threadId;
      if (Array.isArray(data?.toolEvents)) console.log('CV toolEvents:', data.toolEvents);

      const assistantText =
        typeof data?.reply === 'string'
          ? data.reply
          : (data?.reply?.text ?? 'Sin respuesta');

      // Mensaje del assistant con `parts`
      const assistantMessage: ChatMessage = {
        id: uuidv4(),
        role: 'assistant',
        parts: [{ type: 'text', text: assistantText }],
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error) {
      console.error('Error sending message:', error);
      alert('No se pudo enviar el mensaje. Intenta de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  const SPACER = `calc(${composerH}px + env(safe-area-inset-bottom) + 8px)`;

  return (
    <div
      className="relative flex flex-col w-full min-h-[100dvh] mx-auto bg-transparent dark:bg-transparent"
      style={{ ['--composer-h' as any]: `${composerH}px` }}
    >
      {/* Área de conversación */}
      <div
        className="flex-1 min-h-0 overflow-y-auto px-0 py-0 scroll-smooth"
        style={{ paddingBottom: SPACER, scrollPaddingBottom: SPACER }}
      >
        {/* Messages espera `items` */}
        <Messages items={messages} />
      </div>

      {/* Composer */}
      <div
        className="fixed inset-x-0 bottom-0 z-50 bg-black"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div ref={composerRef} className="mx-auto max-w-3xl px-2 sm:px-4 py-2 sm:py-4">
          <form ref={formRef} onSubmit={handleSubmit} className="w-full flex items-center gap-2 sm:gap-3">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="..."
              className="min-w-0 flex-1 px-3 sm:px-5 py-3 rounded-full border border-gray-700
                         bg-white/70 dark:bg-white/20 text-black dark:text-white placeholder-gray-500
                         focus:outline-none focus:ring-2 focus:ring-volare-blue transition-all duration-300
                         text-[16px] md:text-base"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
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
