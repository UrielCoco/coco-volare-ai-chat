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
  try {
    sid = localStorage.getItem(CV_SESSION_KEY) || '';
  } catch {}

  const url = sid ? `/api/chat/session?sid=${encodeURIComponent(sid)}` : `/api/chat/session`;
  const data = await fetchJson(url, {
    method: 'GET',
    headers: sid ? { 'x-cv-session': sid } : undefined,
    cache: 'no-store',
  });

  const sessionId = String(data?.sessionId || '');
  const threadId = String(data?.threadId || '');

  if (sessionId) {
    try {
      localStorage.setItem(CV_SESSION_KEY, sessionId);
    } catch {}
    (window as any).cvSessionId = sessionId;
  }
  if (threadId) (window as any).cvThreadId = threadId;

  return { sessionId, threadId };
}

function peekSessionId(): string {
  try {
    return localStorage.getItem(CV_SESSION_KEY) || '';
  } catch {
    return '';
  }
}

/* ========= Componente ========= */
export default function Chat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  // Refs/UI
  const inputRef = useRef<HTMLInputElement | null>(null);
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
          try {
            update();
          } catch {}
        });
        ro.observe(el);
      }
    } catch {}

    const onResize = () => update();
    window.addEventListener('resize', onResize);

    return () => {
      try {
        ro && ro.disconnect();
      } catch {}
      window.removeEventListener('resize', onResize);
    };
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
    ensureWebSession().catch((e) => {
      console.warn('CV: ensureWebSession fallback:', e);
    });
  }, []);

  // ✅ Envío con SSE (sin placeholder de asistente)
  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const raw = input.trim();
    if (!raw) return;

    // 1) Agrega el mensaje del usuario
    const userMessage: ChatMessage = {
      id: uuidv4(),
      role: 'user',
      // @ts-ignore
      parts: [{ type: 'text', text: raw }],
    };
    setMessages((prev) => [...prev, userMessage]);

    // Limpia input y muestra indicador de escribiendo…
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
        body: JSON.stringify({ message: raw }),
      });

      if (!response.ok || !response.body) {
        const txt = await response.text().catch(() => '');
        throw new Error(`HTTP ${response.status}: ${txt.slice(0, 200)}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let createdAssistant = false;
      let assistantId = ''; // lo creamos hasta el primer delta
      let finished = false;
      let accumulated = '';

      while (!finished) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const chunks = buffer.split('\n\n');
        buffer = chunks.pop() || '';

        for (const chunk of chunks) {
          const line = chunk.trim();
          if (!line.startsWith('data:')) continue;

          const payloadStr = line.slice(5).trim();
          if (!payloadStr) continue;

          let payload: any = null;
          try {
            payload = JSON.parse(payloadStr);
          } catch {
            continue;
          }

          if (payload.type === 'delta') {
            const delta = String(payload.text || '');
            if (!delta) continue;

            accumulated += delta;

            // Crea el mensaje del asistente en el PRIMER delta
            if (!createdAssistant) {
              assistantId = uuidv4();
              const assistantMessage: ChatMessage = {
                id: assistantId,
                role: 'assistant',
                // @ts-ignore
                parts: [{ type: 'text', text: delta }],
              };
              setMessages((prev) => [...prev, assistantMessage]);
              // Apaga el indicador de “escribiendo” (evita doble burbuja)
              setLoading(false);
              createdAssistant = true;
              continue;
            }

            // Para siguientes deltas, solo concatena
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      // @ts-ignore
                      parts: [{ type: 'text', text: String(((m as any).parts?.[0]?.text ?? '') + delta) }],
                    }
                  : m,
              ),
            );
          } else if (payload.type === 'done') {
            const finalText = String(payload.text || accumulated);
            if (createdAssistant) {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, parts: [{ type: 'text', text: finalText }] as any }
                    : m,
                ),
              );
            } else if (finalText) {
              // (poco común) si no hubo deltas y llegó final directo
              assistantId = uuidv4();
              setMessages((prev) => [
                ...prev,
                { id: assistantId, role: 'assistant', parts: [{ type: 'text', text: finalText }] as any },
              ]);
            }
          } else if (payload.type === 'error') {
            throw new Error(payload.error || 'Stream error');
          } else if (payload.type === 'eof') {
            finished = true;
            break;
          }
        }
      }
    } catch (error) {
      console.error('Error sending message:', error);
      alert('No se pudo enviar el mensaje. Intenta de nuevo.');
    } finally {
      // Asegura que el “escribiendo…” se apague
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
        <Messages
          messages={messages}
          isLoading={loading}   // ← solo un globito “…” mientras llega el primer delta
          votes={[]}
          setMessages={setMessages as any}
          regenerate={async () => {}}
          isReadonly={false}
          chatId="local-chat"
        />
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
