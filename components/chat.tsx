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

// ---------- Helpers de extracción (respaldos para cv:kommo en texto) ----------
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

function extractKommoBlocksFromText(text: string): Array<{ raw: string; json: any }> {
  const blocks: Array<{ raw: string; json: any }> = [];
  if (!text) return blocks;

  // Fence completa
  const rxFence = /```\s*cv:kommo\s*([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  while ((m = rxFence.exec(text))) {
    const candidate = (m[1] || '').trim();
    try {
      const json = JSON.parse(candidate);
      if (json && Array.isArray(json.ops)) blocks.push({ raw: candidate, json });
    } catch {}
  }
  if (blocks.length) return blocks;

  // Fallback: fence sin cerrar pero JSON balanceado
  const at = text.toLowerCase().indexOf('```cv:kommo');
  if (at >= 0) {
    const openBrace = text.indexOf('{', at);
    if (openBrace >= 0) {
      const jsonSlice = extractBalancedJson(text, openBrace);
      if (jsonSlice) {
        try {
          const json = JSON.parse(jsonSlice);
          if (json && Array.isArray(json.ops)) blocks.push({ raw: jsonSlice, json });
        } catch {}
      }
    }
  }
  return blocks;
}

// Oculta cualquier fence ```cv:... incompleto del texto visible
function visibleWithoutIncompleteFence(text: string): string {
  const start = text.search(/```cv:(itinerary|quote)\b/i);
  if (start === -1) return text; // sin fence
  const closed = /```cv:(itinerary|quote)\b[\s\S]*```/i.test(text);
  if (closed) return text; // fence ya cerró (lo verá Messages como tarjeta)
  return text.slice(0, start); // oculta la cola incompleta
}

export default function Chat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const threadIdRef = useRef<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLFormElement | null>(null);

  // evita duplicados de Kommo por contenido
  const kommoHashesRef = useRef<Set<string>>(new Set());

  // manejar múltiples mensajes del assistant en un mismo run
  const runFinalsCountRef = useRef<number>(0);

  // marcador especial para chip "pensando"
  const thinkingIdRef = useRef<string | null>(null);

  // altura dinámica del composer
  const [composerH, setComposerH] = useState<number>(84);

  // auto-scroll: solo en NUEVO mensaje
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

  // --- despacho a Kommo ---
  function dispatchKommoOps(ops: any[], rawKey: string) {
    const key = 'k_' + rawKey.slice(0, 40);
    if (kommoHashesRef.current.has(key)) return;
    kommoHashesRef.current.add(key);
    fetch('/api/kommo/dispatch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ops, threadId: threadIdRef.current }),
      keepalive: true,
    }).catch(() => {});
  }

  // crea un mensaje placeholder con “…” (si quieres mantener tu estilo)
  function ensureTypingPlaceholder(): string {
    const id = `a_typing_${Date.now()}`;
    const placeholder: ChatMessage = {
      id,
      role: 'assistant',
      parts: [{ type: 'text', text: '…' }] as any,
      createdAt: new Date().toISOString(),
    } as any;
    setMessages((prev) => [...prev, placeholder]);
    return id;
  }

  // chip "pensando •••" que dura hasta 'done'
  function addThinkingChip(): string {
    const id = `a_thinking_${Date.now()}`;
    thinkingIdRef.current = id;
    const chip: ChatMessage = {
      id,
      role: 'assistant',
      parts: [{ type: 'text', text: 'pensando •••' }] as any,
      createdAt: new Date().toISOString(),
    } as any;
    setMessages((prev) => [...prev, chip]);
    return id;
  }
  function removeThinkingChip() {
    const id = thinkingIdRef.current;
    if (!id) return;
    thinkingIdRef.current = null;
    setMessages((prev) => prev.filter((m) => m.id !== id));
  }

  async function handleStream(userText: string) {
    setIsLoading(true);
    runFinalsCountRef.current = 0;

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
      let rawText = ''; // acumulado crudo del mensaje "de contenido"

      // placeholders
      ensureTypingPlaceholder(); // tu burbuja “…” (por compat)
      addThinkingChip();         // chip "pensando" que solo se quita en 'done'

      // id del mensaje de contenido (texto real)
      let contentMsgId: string | null = null;

      // helpers para escribir en el mensaje de contenido
      const applyText = (chunk: string, replace = false) => {
        if (!contentMsgId) return;
        setMessages((prev) => {
          const next = [...prev];
          const idx = next.findIndex((m) => m.id === contentMsgId);
          if (idx >= 0) {
            const curr = next[idx] as any;
            const before = curr.parts?.[0]?.text ?? '';
            curr.parts = [{ type: 'text', text: replace ? chunk : before + chunk }];
            next[idx] = curr;
          }
          return next;
        });
      };

      // intenta despachar Kommo si ya llegó un bloque (en delta/final)
      const maybeDispatchKommo = () => {
        const blocks = extractKommoBlocksFromText(rawText);
        for (const b of blocks) {
          try {
            if (b.json && Array.isArray(b.json.ops) && b.json.ops.length) {
              dispatchKommoOps(b.json.ops, b.raw);
            }
          } catch {}
        }
      };

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
            try {
              const data = JSON.parse(dataLine || '{}');
              if (data?.threadId) {
                threadIdRef.current = data.threadId;
                try { window.sessionStorage.setItem(THREAD_KEY, data.threadId); } catch {}
              }
              ulog('sse.meta', { threadId: data?.threadId });
            } catch {}
            continue;
          }

          if (event === 'delta') {
            try {
              const data = JSON.parse(dataLine || '{}');
              if (typeof data?.value === 'string' && data.value.length) {
                rawText += data.value;

                // si es el primer delta, crea el mensaje de contenido
                if (!contentMsgId) {
                  contentMsgId = `a_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
                  const newMsg: ChatMessage = {
                    id: contentMsgId,
                    role: 'assistant',
                    parts: [{ type: 'text', text: '' }] as any,
                    createdAt: new Date().toISOString(),
                  } as any;
                  setMessages((prev) => [...prev, newMsg]);
                }

                // texto visible SIN fence incompleto
                const visible = visibleWithoutIncompleteFence(rawText);
                applyText(visible, true);
                maybeDispatchKommo();

                ulog('sse.delta', { add: data.value.length, visible: visible.length });
              }
            } catch {}
            continue;
          }

          if (event === 'final') {
            try {
              const data = JSON.parse(dataLine || '{}');
              if (typeof data?.text === 'string') {
                rawText += data.text;

                if (!contentMsgId) {
                  contentMsgId = `a_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
                  const newMsg: ChatMessage = {
                    id: contentMsgId,
                    role: 'assistant',
                    parts: [{ type: 'text', text: '' }] as any,
                    createdAt: new Date().toISOString(),
                  } as any;
                  setMessages((prev) => [...prev, newMsg]);
                }

                const visible = visibleWithoutIncompleteFence(rawText);
                applyText(visible, true);

                runFinalsCountRef.current += 1;

                // Despacho Kommo si vino en este final
                const blocks = extractKommoBlocksFromText(data.text);
                for (const b of blocks) {
                  try {
                    if (b.json && Array.isArray(b.json.ops) && b.json.ops.length) {
                      dispatchKommoOps(b.json.ops, b.raw);
                    }
                  } catch {}
                }

                ulog('sse.final', { totalVisible: visible.length });
              }
            } catch {}
            continue;
          }

          if (event === 'error') {
            ulog('sse.error', {});
            // mostramos pequeña alerta en el último placeholder "…"
            setMessages((prev) => {
              const next = [...prev];
              const idx = next.findIndex(
                (m: any) => m.role === 'assistant' && m.parts?.[0]?.text === '…'
              );
              if (idx >= 0) {
                (next[idx] as any).parts = [
                  { type: 'text', text: '⚠️ hubo un problema momentáneo.' },
                ];
              }
              return next;
            });
            continue;
          }

          if (event === 'done') {
            ulog('sse.done', {});
            setIsLoading(false);

            // limpia sólo el placeholder “…” si quedó huérfano
            setMessages((prev) => {
              const next = [...prev];
              const idx = next.findIndex(
                (m: any) => m.role === 'assistant' && m.parts?.[0]?.text === '…'
              );
              if (idx >= 0) next.splice(idx, 1);
              return next;
            });

            // quita el chip "pensando"
            removeThinkingChip();
            continue;
          }
        }
      }
    } catch (err) {
      console.error('[CV][chat] stream error', err);
      setIsLoading(false);

      // limpia chip pensando si quedó
      removeThinkingChip();

      setMessages((prev) => {
        const next = [...prev];
        const idx = next.findIndex(
          (m: any) => m.role === 'assistant' && m.parts?.[0]?.text === '…'
        );
        if (idx >= 0) {
          (next[idx] as any).parts = [
            { type: 'text', text: '⚠️ No pude conectarme. Intenta otra vez.' },
          ];
        }
        return next;
      });
    }
  }

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
          >
            ➤
          </button>
        </div>
      </form>
    </div>
  );
}
