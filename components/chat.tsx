'use client';

import { useEffect, useRef, useState } from 'react';
import Messages from './messages';
import type { ChatMessage } from '@/lib/types';

const THREAD_KEY = 'cv_thread_id_session';

// logs de UI
function ulog(event: string, meta: any = {}) {
  try { console.debug('[CV][ui]', event, meta); } catch {}
}

// ---------- Helpers para fences ----------
function extractBalancedJson(src: string, startIdx: number): string | null {
  let inString = false, escape = false, depth = 0, first = -1;
  for (let i = startIdx; i < src.length; i++) {
    const ch = src[i];
    if (inString) {
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === '"') { inString = false; continue; }
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{') { if (depth === 0) first = i; depth++; continue; }
    if (ch === '}') { depth--; if (depth === 0 && first >= 0) return src.slice(first, i + 1); }
  }
  return null;
}

function findFence(text: string, tag: string) {
  // soporta ```cv:itinerary``` y abreviado ```cv:it```
  const rx = new RegExp('```\\s*cv:' + tag + '\\s*([\\s\\S]*?)```', 'i');
  const m = rx.exec(text);
  if (!m) return { found: false as const };
  let json: any = null;
  try { json = JSON.parse((m[1] || '').trim()); } catch { /* noop */ }
  return { found: true as const, complete: true as const, raw: m[0], data: json };
}

function findUnclosedFence(text: string, tag: string) {
  const at = text.toLowerCase().indexOf('```cv:' + tag);
  if (at < 0) return { found: false as const };
  const openBrace = text.indexOf('{', at);
  if (openBrace < 0) return { found: true as const, complete: false as const };
  const jsonSlice = extractBalancedJson(text, openBrace);
  if (!jsonSlice) return { found: true as const, complete: false as const };
  try {
    const data = JSON.parse(jsonSlice);
    return { found: true as const, complete: true as const, raw: '```cv:' + tag + '\n' + jsonSlice + '\n```', data };
  } catch {
    return { found: true as const, complete: false as const };
  }
}

// ---------- Chat ----------
export default function Chat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const threadIdRef = useRef<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLFormElement | null>(null);

  // evita tarjetas duplicadas (misma cadena json)
  const cardHashRef = useRef<Set<string>>(new Set());

  // solo 1 “pensando…”
  const typingIdRef = useRef<string | null>(null);
  const typingTimeoutRef = useRef<any>(null);

  // altura dinámica del composer
  const [composerH, setComposerH] = useState<number>(84);

  // auto-scroll
  const lastMsgIdRef = useRef<string | null>(null);
  const scrollToBottom = (behavior: ScrollBehavior = 'auto') => {
    const scroller = listRef.current;
    if (!scroller) return;
    endRef.current?.scrollIntoView({ behavior, block: 'end' });
    scroller.scrollTo({ top: scroller.scrollHeight, behavior });
  };

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

  // auto-scroll en nuevo mensaje
  useEffect(() => {
    const last = messages[messages.length - 1]?.id;
    if (!last) return;
    if (lastMsgIdRef.current !== last) {
      lastMsgIdRef.current = last;
      requestAnimationFrame(() => scrollToBottom('smooth'));
    }
  }, [messages]);

  // ---- helpers typing ----
  const createTyping = () => {
    if (typingIdRef.current) return typingIdRef.current; // ya existe
    const id = `a_typing_${Date.now()}`;
    const placeholder: ChatMessage = {
      id,
      role: 'assistant',
      // mostramos “…” y lo iremos reemplazando por deltas
      parts: [{ type: 'text', text: '…' } as any] as any,
      createdAt: new Date().toISOString(),
      // marca para poder limpiarlo luego sin depender de texto exacto
      // @ts-ignore
      meta: { isTyping: true },
    } as any;
    setMessages((prev) => [...prev, placeholder]);
    typingIdRef.current = id;
    ulog('typing.create', { id });

    // failsafe: si por alguna razón no llega 'done', limpialo en 60s
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      ulog('typing.failsafe');
      removeTyping();
    }, 60_000);

    return id;
  };

  const updateTypingText = (chunk: string, replace = false) => {
    const id = typingIdRef.current;
    if (!id) return;
    setMessages((prev) => {
      const next = [...prev];
      const idx = next.findIndex((m: any) => m.id === id);
      if (idx >= 0) {
        const curr = next[idx] as any;
        const before = curr.parts?.[0]?.text ?? '';
        curr.parts = [{ type: 'text', text: replace ? chunk : before + chunk }];
        // conserva la marca de typing
        curr.meta = { ...(curr.meta || {}), isTyping: true };
        next[idx] = curr;
      }
      return next;
    });
  };

  const removeTyping = () => {
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }
    const id = typingIdRef.current;
    if (!id) return;
    setMessages((prev) => {
      const next = prev.filter((m: any) => m.id !== id);
      return next;
    });
    ulog('typing.remove', { id });
    typingIdRef.current = null;
  };

  // ---- tarjetas ----
  function maybePushItineraryCardFrom(text: string) {
    // busca fence cerrado (primero exacto, luego intento balanceado)
    const it =
      findFence(text, 'itinerary').found
        ? (findFence(text, 'itinerary') as any)
        : findFence(text, 'it').found
        ? (findFence(text, 'it') as any)
        : findUnclosedFence(text, 'itinerary') as any;

    if (!it?.found || !it?.complete || !it?.data) return;

    try {
      const raw = JSON.stringify(it.data);
      const key = raw.slice(0, 80);
      if (cardHashRef.current.has(key)) return; // evita duplicado
      cardHashRef.current.add(key);

      const id = `a_card_${Date.now()}`;
      const newMsg: ChatMessage = {
        id,
        role: 'assistant',
        // guardamos el json para que Messages/ItineraryCard lo detecte
        parts: [{ type: 'text', text: '```cv:itinerary\n' + raw + '\n```' } as any] as any,
        createdAt: new Date().toISOString(),
      } as any;
      setMessages((prev) => [...prev, newMsg]);
      ulog('card.itinerary.add', { id });
    } catch { /* noop */ }
  }

  // ---- stream principal ----
  async function handleStream(userText: string) {
    setIsLoading(true);
    const typingId = createTyping();
    let firstDelta = true;
    let agg = '';

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
      if (!res.body) throw new Error('Stream no soportado.');

      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
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
            .replace('event:', '').trim();
          const dataLine = (lines.find((l) => l.startsWith('data:')) || '')
            .replace('data:', '').trim();

          if (!event) continue;

          if (event === 'meta') {
            try {
              const data = JSON.parse(dataLine || '{}');
              if (data?.threadId) {
                threadIdRef.current = data.threadId;
                try { window.sessionStorage.setItem(THREAD_KEY, data.threadId); } catch {}
              }
              ulog('sse.meta', data);
            } catch {}
          }
          else if (event === 'delta') {
            let val = '';
            try { val = JSON.parse(dataLine || '{}')?.value || ''; } catch {}
            if (!val) { ulog('sse.delta.empty'); continue; }

            if (firstDelta) {
              // primer delta: limpia “…” y arranca
              updateTypingText('', true);
              firstDelta = false;
            }
            agg += val;
            updateTypingText(val, false);
            ulog('sse.delta', { len: val.length });

            // mientras van llegando deltas, detecta si ya cerró fence
            maybePushItineraryCardFrom(agg);
          }
          else if (event === 'final') {
            const text = (() => { try { return JSON.parse(dataLine || '{}')?.text || ''; } catch { return ''; } })();
            ulog('sse.final', { len: text.length });

            if (text) {
              // si veníamos con el typing, reemplázalo por el final consolidado
              updateTypingText(text, true);
              agg = text;
              // intenta tarjeta si el fence ya cerró
              maybePushItineraryCardFrom(text);
            }
          }
          else if (event === 'done') {
            ulog('sse.done');
            removeTyping();
            setIsLoading(false);
          }
          else if (event === 'error') {
            const err = (() => { try { return JSON.parse(dataLine || '{}'); } catch { return {}; } })();
            ulog('sse.error', err);
            // muestra error en el typing actual
            updateTypingText('⚠️ Ocurrió un problema. Intenta otra vez.', true);
          }
        }
      }
    } catch (err) {
      ulog('ui.stream.error', { msg: (err as any)?.message });
      updateTypingText('⚠️ No pude conectarme. Intenta otra vez.', true);
    } finally {
      // si por cualquier cosa el backend no mandó 'done', limpia aquí
      setIsLoading(false);
      setTimeout(() => removeTyping(), 300); // da un respiro al último repaint
    }
  }

  // ---- submit ----
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || isLoading) return;

    const userId = `u_${Date.now()}`;
    const userMsg: ChatMessage = {
      id: userId,
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
            className="rounded-full px-4 py-3 font-medium hover:opacity-90 transition bg-[#bba36d] text-black shadow"
            aria-label="Enviar"
            disabled={isLoading}
          >
            ➤
          </button>
        </div>
      </form>
    </div>
  );
}
