'use client';

import { useEffect, useRef, useState } from 'react';
import Messages from './messages';
import { v4 as uuidv4 } from 'uuid';
import { PaperPlaneIcon } from '@radix-ui/react-icons';

// ⚠️ Usa SIEMPRE los tipos del proyecto:
import type { ChatMessage, UIMessagePart } from '@/lib/types';

const THREAD_KEY = 'cv_thread_id';

// -------- helpers de parseo --------
function normalizeJSON(s: string) {
  return s
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/,\s*([}\]])/g, '$1'); // comas colgantes comunes
}

function findBlock(reply: string, label: 'cv:itinerary' | 'cv:quote'): string | null {
  const re = new RegExp('```\\s*' + label + '\\s*([\\s\\S]*?)```', 'i');
  const m = reply.match(re);
  return m?.[1]?.trim() ?? null;
}

function parseItinerary(reply: string): any | null {
  const candidates: string[] = [];
  const tagged = findBlock(reply, 'cv:itinerary');
  if (tagged) candidates.push(tagged);

  const mJson = reply.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (mJson?.[1]) candidates.push(mJson[1].trim());

  const t = reply.trim();
  if (t.startsWith('{') && t.endsWith('}')) candidates.push(t);

  for (const raw of candidates) {
    try {
      const obj = JSON.parse(normalizeJSON(raw));
      if (obj && Array.isArray(obj.days) && obj.days.length > 0) return obj;
    } catch {}
  }
  return null;
}

function parseQuote(reply: string): any | null {
  const block = findBlock(reply, 'cv:quote');
  if (!block) return null;
  try {
    return JSON.parse(normalizeJSON(block));
  } catch {
    return null;
  }
}

// ----------------------------------

export default function Chat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const composerRef = useRef<HTMLDivElement | null>(null);
  const [composerH, setComposerH] = useState<number>(96);

  // medir altura composer y exponer --composer-h
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

  // threadId por sesión de pestaña (memoria mientras la ventana está abierta)
  const getThreadId = () => {
    try {
      return sessionStorage.getItem(THREAD_KEY) || localStorage.getItem(THREAD_KEY) || null;
    } catch { return null; }
  };
  const setThreadId = (id: string) => {
    try {
      sessionStorage.setItem(THREAD_KEY, id);
      localStorage.setItem(THREAD_KEY, id);
      (window as any).cvThreadId = id;
    } catch {}
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || loading) return;

    // mensaje del usuario con tipos del proyecto
    const userMsg: ChatMessage = {
      id: uuidv4(),
      role: 'user',
      parts: [{ type: 'text', text } as UIMessagePart],
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const threadId = (window as any).cvThreadId || getThreadId();
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: { role: 'user', parts: [{ text }] }, threadId }),
      });

      const ct = res.headers.get('content-type') || '';
      if (!res.ok) {
        const t = ct.includes('application/json') ? JSON.stringify(await res.json()) : await res.text();
        throw new Error(`HTTP ${res.status}: ${t.slice(0, 300)}`);
      }
      if (!ct.includes('application/json')) throw new Error('Respuesta no-JSON');

      const data = await res.json() as { reply: string; threadId: string };
      if (data?.threadId) setThreadId(data.threadId);

      const reply = (data?.reply ?? '').toString();

      // Parseo especial → produce UIMessagePart[]
      const parts: UIMessagePart[] = (() => {
        const itin = parseItinerary(reply);
        if (itin) return [{ type: 'itinerary', itinerary: itin } as unknown as UIMessagePart];
        const quote = parseQuote(reply);
        if (quote) return [{ type: 'quote', quote } as unknown as UIMessagePart];
        return [{ type: 'text', text: reply } as UIMessagePart];
      })();

      const assistantMsg: ChatMessage = {
        id: uuidv4(),
        role: 'assistant',
        parts,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      console.error('[CV][client] /api/chat error', err);
      setMessages((prev) => [
        ...prev,
        {
          id: uuidv4(),
          role: 'assistant',
          parts: [{ type: 'text', text: 'Tuvimos un problema. ¿Destino, fechas y nº de personas?' } as UIMessagePart],
        } as ChatMessage,
      ]);
    } finally {
      setLoading(false);
    }
  };

  const SPACER = `calc(${composerH}px + env(safe-area-inset-bottom) + 8px)`;

const hasVisibleChat = messages.some(
  (m: any) => m?.role === 'user' || m?.role === 'assistant'
);
const showBackdrop = !hasVisibleChat ; // ← muestra GIF aunque existan 'system'

  return (
    <div
  className="relative flex flex-col w-full min-h-[100dvh] bg-white"
  style={{ ['--composer-h' as any]: `${composerH}px` }}
>
  {/* 🎬 Pre-chat: fondo blanco + GIF centrado (≈ 1/3 pantalla). SIN z negativo */}
  {showBackdrop && (
    <div className="absolute inset-0 z-0 grid place-items-center bg-white">
      <img
        src="/images/Texts.gif"
        alt="Coco Volare"
        className="w-auto h-auto object-contain "
        onError={(e) => {
          // Fallback por si el nombre cambió a minúsculas
          const img = e.currentTarget as HTMLImageElement;
          if (!img.dataset.triedfallback) {
            img.dataset.triedfallback = '1';
            img.src = '/images/texts.gif';
          }
        }}
      />
    </div>
  )}

  {/* Conversación encima del GIF */}
  <div
    className="relative z-10 flex-1 min-h-0 overflow-y-auto px-0 py-0 scroll-smooth"
    style={{ paddingBottom: `calc(${composerH}px + env(safe-area-inset-bottom) + 8px)`,
             scrollPaddingBottom: `calc(${composerH}px + env(safe-area-inset-bottom) + 8px)` }}
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

      {/* Composer */}
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
              className="flex-1 rounded-full px-4 py-3 bg-black text-white placeholder-white/50
                         border border-[#b69965]/40 focus:outline-none focus:ring-2 focus:ring-[#b69965]/60"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="h-12 w-12 rounded-full grid place-items-center bg-[#b69965] text-black disabled:opacity-50"
              title="Enviar" aria-label="Enviar"
            >
              {loading ? '…' : <PaperPlaneIcon className="w-5 h-5" />}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
