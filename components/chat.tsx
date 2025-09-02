'use client';

import { useEffect, useRef, useState } from 'react';
import Messages from './messages';
import type { ChatMessage } from '@/lib/types';

const THREAD_KEY = 'cv_thread_id_session';

function ulog(event: string, meta: any = {}) {
  try {
    console.debug('[CV][ui]', event, meta);
  } catch {}
}

/** ---- Utils JSON fence ---- */
type FenceType = 'itinerary' | 'kommo' | 'quote';
const FENCE_START_RE = /```cv:(itinerary|kommo|quote)/i;
const FENCE_END = '```';

export default function Chat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const listRef = useRef<HTMLDivElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLFormElement | null>(null);
  const [composerH, setComposerH] = useState<number>(84);

  const threadIdRef = useRef<string | null>(null);

  // ids de mensajes creados durante un run
  const thinkingIdRef = useRef<string | null>(null);
  const preTextIdRef = useRef<string | null>(null);
  const postTextIdRef = useRef<string | null>(null);

  // dedupe de tarjetas y kommo (por hash del JSON)
  const cardHashesRef = useRef<Set<string>>(new Set());
  const kommoHashesRef = useRef<Set<string>>(new Set());

  // parser incremental
  const modeRef = useRef<'text' | 'fence'>('text');
  const fenceTypeRef = useRef<FenceType | null>(null);
  const fenceBufRef = useRef<string>('');
  const firstFenceClosedRef = useRef<boolean>(false);

  // scroll automático en nuevos mensajes
  const lastMsgIdRef = useRef<string | null>(null);
  useEffect(() => {
    const last = messages[messages.length - 1]?.id;
    if (!last) return;
    if (lastMsgIdRef.current !== last) {
      lastMsgIdRef.current = last;
      requestAnimationFrame(() =>
        endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }),
      );
    }
  }, [messages]);

  // restaurar thread
  useEffect(() => {
    try {
      const ss = window.sessionStorage.getItem(THREAD_KEY);
      if (ss) {
        threadIdRef.current = ss;
        ulog('thread.restore', { threadId: ss });
      }
    } catch {}
  }, []);

  // medir composer
  useEffect(() => {
    if (!composerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const h = Math.ceil(entries[0].contentRect.height);
      if (h && h !== composerH) setComposerH(h);
    });
    ro.observe(composerRef.current);
    return () => ro.disconnect();
  }, [composerH]);

  /** ---- helpers UI ---- */
  function addMessage(part: any): string {
    const id = `${part.type}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const msg: ChatMessage = {
      id,
      role: 'assistant',
      parts: [part] as any,
      createdAt: new Date().toISOString(),
    } as any;
    setMessages((prev) => [...prev, msg]);
    return id;
  }

  function ensureThinking() {
    if (thinkingIdRef.current) return thinkingIdRef.current;
    const id = addMessage({ type: 'thinking' });
    thinkingIdRef.current = id;
    return id;
  }

  function removeThinking() {
    const id = thinkingIdRef.current;
    if (!id) return;
    setMessages((prev) => prev.filter((m) => m.id !== id));
    thinkingIdRef.current = null;
  }

  function ensureText(which: 'pre' | 'post') {
    const ref = which === 'pre' ? preTextIdRef : postTextIdRef;
    if (ref.current) return ref.current;
    const id = addMessage({ type: 'text', text: '' });
    ref.current = id;
    return id;
  }

  function appendText(which: 'pre' | 'post', chunk: string) {
    if (!chunk) return;
    const id = ensureText(which);
    setMessages((prev) => {
      const next = [...prev];
      const idx = next.findIndex((m) => m.id === id);
      if (idx >= 0) {
        const t = (next[idx] as any).parts?.[0]?.text ?? '';
        (next[idx] as any).parts = [{ type: 'text', text: t + chunk }];
      }
      return next;
    });
  }

  function addItineraryCard(json: any, rawKey: string) {
    try {
      const key = 'i_' + rawKey.slice(0, 64);
      if (cardHashesRef.current.has(key)) return; // dedupe
      cardHashesRef.current.add(key);

      addMessage({ type: 'itinerary', itinerary: json });
      ulog('card.inserted', { days: Array.isArray(json?.days) ? json.days.length : 0 });
    } catch {
      // noop
    }
  }

  function dispatchKommoOps(ops: any[], rawKey: string) {
    if (!ops?.length) return;
    const key = 'k_' + rawKey.slice(0, 64);
    if (kommoHashesRef.current.has(key)) return;
    kommoHashesRef.current.add(key);
    fetch('/api/kommo/dispatch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ops, threadId: threadIdRef.current }),
      keepalive: true,
    }).catch(() => {});
    ulog('kommo.sent', { ops: ops.length });
  }

  /** Parser incremental de fences durante el stream */
  function processChunk(chunk: string) {
    let rest = chunk;

    while (rest.length) {
      // Estamos fuera de fence → buscar inicio
      if (modeRef.current === 'text') {
        const m = rest.match(FENCE_START_RE);
        if (!m || m.index === undefined || m.index < 0) {
          // todo el pedazo es texto visible
          appendText(firstFenceClosedRef.current ? 'post' : 'pre', rest);
          return;
        }

        // texto antes del fence
        if (m.index > 0) {
          appendText(firstFenceClosedRef.current ? 'post' : 'pre', rest.slice(0, m.index));
        }

        // entrar a fence
        modeRef.current = 'fence';
        fenceTypeRef.current = m[1].toLowerCase() as FenceType;
        fenceBufRef.current = '';
        rest = rest.slice(m.index + m[0].length);
        continue;
      }

      // Estamos dentro de un fence → buscar cierre ```
      const endIdx = rest.indexOf(FENCE_END);
      if (endIdx === -1) {
        fenceBufRef.current += rest;
        return; // seguimos esperando el cierre
      }

      // completó el fence
      fenceBufRef.current += rest.slice(0, endIdx);
      const jsonText = fenceBufRef.current.trim();

      try {
        const parsed = JSON.parse(jsonText);
        if (fenceTypeRef.current === 'itinerary') {
          addItineraryCard(parsed, jsonText);
        } else if (fenceTypeRef.current === 'kommo') {
          const ops = Array.isArray(parsed?.ops) ? parsed.ops : [];
          dispatchKommoOps(ops, jsonText);
        }
      } catch (e) {
        ulog('fence.parse.error', { type: fenceTypeRef.current, msg: String(e) });
      }

      // marcamos que ya cerró el primer fence (para enviar lo siguiente a "post")
      if (!firstFenceClosedRef.current) firstFenceClosedRef.current = true;

      // salir de fence y continuar con el resto del chunk
      modeRef.current = 'text';
      fenceTypeRef.current = null;
      fenceBufRef.current = '';
      rest = rest.slice(endIdx + FENCE_END.length);
    }
  }

  async function handleStream(userText: string) {
    setIsLoading(true);

    // reset estado de run
    preTextIdRef.current = null;
    postTextIdRef.current = null;
    cardHashesRef.current.clear();
    kommoHashesRef.current.clear();
    modeRef.current = 'text';
    fenceTypeRef.current = null;
    fenceBufRef.current = '';
    firstFenceClosedRef.current = false;

    // thinking SIEMPRE, hasta 'done'
    ensureThinking();

    try {
      const res = await fetch('/api/chat?stream=1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: { role: 'user', parts: [{ type: 'text', text: userText }] },
          threadId: threadIdRef.current,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (!res.body) throw new Error('Stream no soportado');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      let buffer = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';

        for (const ev of events) {
          const lines = ev.split('\n');
          const event = (lines.find((l) => l.startsWith('event:')) || '')
            .replace('event:', '')
            .trim();
          const dataLine = (lines.find((l) => l.startsWith('data:')) || '')
            .replace('data:', '')
            .trim();

          if (!event) continue;

          if (event === 'meta') {
            const data = JSON.parse(dataLine || '{}');
            if (data?.threadId) {
              threadIdRef.current = data.threadId;
              try {
                window.sessionStorage.setItem(THREAD_KEY, data.threadId);
              } catch {}
            }
            ulog('sse.meta', { threadId: data?.threadId });
          } else if (event === 'delta') {
            const data = JSON.parse(dataLine || '{}');
            const val: string = data?.value ?? '';
            if (val) {
              processChunk(val);
              ulog('sse.delta', { len: val.length });
            }
          } else if (event === 'final') {
            const data = JSON.parse(dataLine || '{}');
            const text: string = data?.text ?? '';
            if (text) {
              processChunk(text);
              ulog('sse.final', { len: text.length });
            }
          } else if (event === 'done') {
            ulog('sse.done');
            removeThinking();
            setIsLoading(false);
          } else if (event === 'error') {
            ulog('sse.error', { data: dataLine });
            removeThinking();
            setIsLoading(false);
            addMessage({
              type: 'text',
              text: '⚠️ Ocurrió un problema procesando tu solicitud. Intenta de nuevo.',
            });
          }
        }
      }
    } catch (err) {
      console.error('[CV][ui] stream error', err);
      removeThinking();
      setIsLoading(false);
      addMessage({
        type: 'text',
        text: '⚠️ No pude conectarme. Intenta otra vez.',
      });
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;
    const text = input.trim();
    if (!text) return;

    const userMsg: ChatMessage = {
      id: `u_${Date.now()}`,
      role: 'user',
      parts: [{ type: 'text', text }] as any,
      createdAt: new Date().toISOString(),
    } as any;
    setMessages((prev) => [...prev, userMsg]);
    setInput('');

    await handleStream(text);
  };

  return (
    <div className="relative flex flex-col w-full min-h-[100dvh] bg-background">
      {/* lista scrolleable */}
      <div
        ref={listRef}
        className="flex-1 overflow-y-auto"
        style={{ paddingBottom: `${composerH + 24}px` }}
      >
        <div className="mx-auto max-w-3xl w-full px-4">
          <Messages
            messages={messages}
            isLoading={isLoading}
            setMessages={({ messages }) => setMessages(messages)}
            regenerate={async () => {}}
          />
          <div ref={endRef} />
        </div>
      </div>

      {/* composer */}
      <form
        ref={composerRef}
        onSubmit={handleSubmit}
        className="sticky bottom-0 left-0 right-0 w-full bg-background/70 backdrop-blur"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="mx-auto max-w-3xl flex items-center gap-2 px-3 py-4">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Escribe tu mensaje…"
            className="flex-1 rounded-full bg-muted px-5 py-3 outline-none text-foreground placeholder:text-muted-foreground shadow"
          />
          <button
            type="submit"
            disabled={isLoading}
            className="rounded-full px-4 py-3 font-medium hover:opacity-90 transition bg-[#bba36d] text-black shadow disabled:opacity-50"
            aria-label="Enviar"
          >
            ➤
          </button>
        </div>
      </form>
    </div>
  );
}
