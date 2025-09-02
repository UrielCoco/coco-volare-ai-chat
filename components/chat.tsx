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

// ---------- Helpers ----------
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

type ParsedBlock =
  | { type: 'text'; text: string }
  | { type: 'itinerary'; data: any }
  | { type: 'json'; data: any }
  | { type: 'ack'; data: any };

function splitIntoBlocks(full: string): ParsedBlock[] {
  // Soporta:
  // ```cv:itinerary { ... }```
  // ```json { ... }```
  // ```cv:ack { ... }```
  const blocks: ParsedBlock[] = [];
  let cursor = 0;
  const rx = /```([^\n]+)\n?/g;
  let m: RegExpExecArray | null;

  while ((m = rx.exec(full))) {
    const fenceStart = m.index;
    const fenceLang = (m[1] || '').trim().toLowerCase();

    if (fenceStart > cursor) {
      const chunk = full.slice(cursor, fenceStart);
      if (chunk.trim().length) blocks.push({ type: 'text', text: chunk });
    }

    const afterOpen = rx.lastIndex;
    const closeIdx = full.indexOf('```', afterOpen);
    if (closeIdx === -1) {
      const rest = full.slice(fenceStart);
      if (rest.trim().length) blocks.push({ type: 'text', text: rest });
      cursor = full.length;
      break;
    }

    const inner = full.slice(afterOpen, closeIdx).trim();
    let parsed: any = null;

    if (inner.startsWith('{')) {
      try {
        parsed = JSON.parse(inner);
      } catch {
        const balanced = extractBalancedJson(inner, inner.indexOf('{'));
        if (balanced) {
          try { parsed = JSON.parse(balanced); } catch {}
        }
      }
    }

    if (fenceLang === 'cv:itinerary' && parsed) {
      blocks.push({ type: 'itinerary', data: parsed });
    } else if (fenceLang === 'json' && parsed) {
      blocks.push({ type: 'json', data: parsed });
    } else if ((fenceLang === 'cv:ack' || fenceLang === 'ack') && parsed) {
      blocks.push({ type: 'ack', data: parsed });
    } else {
      const raw = full.slice(fenceStart, closeIdx + 3);
      if (raw.trim().length) blocks.push({ type: 'text', text: raw });
    }

    cursor = closeIdx + 3;
  }

  if (cursor < full.length) {
    const tail = full.slice(cursor);
    if (tail.trim().length) blocks.push({ type: 'text', text: tail });
  }
  return blocks;
}

// ---------- Component ----------
export default function Chat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const threadIdRef = useRef<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLFormElement | null>(null);

  const kommoHashesRef = useRef<Set<string>>(new Set());
  const runFinalsCountRef = useRef<number>(0);
  const activeAssistantIdRef = useRef<string | null>(null);
  const suppressUntilFinalRef = useRef<boolean>(false); // si hay fence, ocultar deltas

  const [composerH, setComposerH] = useState<number>(84);
  const lastMsgIdRef = useRef<string | null>(null);

  const scrollToBottom = (behavior: ScrollBehavior = 'auto') => {
    const scroller = listRef.current;
    if (!scroller) return;
    endRef.current?.scrollIntoView({ behavior, block: 'end' });
    scroller.scrollTo({ top: scroller.scrollHeight, behavior });
  };

  useEffect(() => {
    try {
      const ss = window.sessionStorage.getItem(THREAD_KEY);
      if (ss) {
        threadIdRef.current = ss;
        ulog('thread.restore', { threadId: ss });
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (!composerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const h = Math.ceil(entries[0].contentRect.height);
      if (h && h !== composerH) setComposerH(h);
    });
    ro.observe(composerRef.current);
    return () => ro.disconnect();
  }, [composerH]);

  useEffect(() => {
    const last = messages[messages.length - 1]?.id;
    if (!last) return;
    if (lastMsgIdRef.current !== last) {
      lastMsgIdRef.current = last;
      requestAnimationFrame(() => scrollToBottom('smooth'));
    }
  }, [messages]);

  // --- Kommo dispatch (silencioso) ---
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

  function replaceActiveWithParts(parts: ParsedBlock[]) {
    setMessages((prev) => {
      const next = [...prev];
      const aid = activeAssistantIdRef.current;
      const idx = aid ? next.findIndex((m) => m.id === aid) : -1;

      const builtParts: any[] = [];
      for (const b of parts) {
        if (b.type === 'text') builtParts.push({ type: 'text', text: b.text });
        if (b.type === 'itinerary') builtParts.push({ type: 'itinerary', data: b.data });
        if (b.type === 'json') builtParts.push({ type: 'json', data: b.data });
        if (b.type === 'ack') builtParts.push({ type: 'ack', data: b.data });
      }

      if (idx >= 0) {
        const curr = next[idx] as any;
        curr.parts = builtParts.length ? builtParts : [{ type: 'text', text: '' }];
        next[idx] = curr;
      }
      return next;
    });
  }

  function appendDeltaToActiveText(delta: string, replace = false) {
    setMessages((prev) => {
      const next = [...prev];
      const aid = activeAssistantIdRef.current;
      const idx = aid ? next.findIndex((m) => m.id === aid) : -1;
      if (idx >= 0) {
        const curr: any = next[idx];
        const first = curr.parts?.[0];
        if (!first || first.type !== 'text') {
          curr.parts = [{ type: 'text', text: '' }, ...(curr.parts || [])];
        }
        const before = curr.parts[0].text || '';
        curr.parts[0].text = replace ? delta : before + delta;
        next[idx] = curr;
      }
      return next;
    });
  }

  async function handleStream(userText: string) {
    setIsLoading(true);
    runFinalsCountRef.current = 0;
    activeAssistantIdRef.current = null;
    suppressUntilFinalRef.current = false;

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
      let fullText = '';

      let typingId = ensureTypingPlaceholder();
      activeAssistantIdRef.current = typingId;

      const maybeDispatchKommoFrom = (text: string) => {
        const rxFence = /```\\s*cv:kommo\\s*([\\s\\S]*?)```/gi;
        let m: RegExpExecArray | null;
        while ((m = rxFence.exec(text))) {
          const payload = (m[1] || '').trim();
          try {
            const json = JSON.parse(payload);
            if (json && Array.isArray(json.ops)) {
              dispatchKommoOps(json.ops, payload.slice(0, 40));
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
            } catch {}
          } else if (event === 'kommo') {
            try {
              const data = JSON.parse(dataLine || '{}');
              const ops = Array.isArray(data?.ops) ? data.ops : [];
              if (ops.length) {
                const rawKey = JSON.stringify(ops).slice(0, 40);
                dispatchKommoOps(ops, rawKey);
              }
            } catch {}
            continue;
          } else if (event === 'delta') {
            try {
              const data = JSON.parse(dataLine || '{}');
              if (typeof data?.value === 'string' && data.value.length) {
                fullText += data.value;

                // Si aparece un fence, ocultamos deltas hasta el final
                if (/```\\s*(cv:itinerary|json|cv:kommo|cv:ack)/i.test(fullText)) {
                  suppressUntilFinalRef.current = true;
                }

                if (!suppressUntilFinalRef.current) {
                  if (fullText.length === data.value.length) {
                    appendDeltaToActiveText('', true); // limpiar "…"
                  }
                  appendDeltaToActiveText(data.value);
                }

                maybeDispatchKommoFrom(fullText);
              }
            } catch {}
          } else if (event === 'final') {
            try {
              const data = JSON.parse(dataLine || '{}');
              if (typeof data?.text === 'string') {
                const text = data.text;

                const parts = splitIntoBlocks(text);
                replaceActiveWithParts(parts);

                fullText = '';
                suppressUntilFinalRef.current = false;
                runFinalsCountRef.current += 1;

                // si el run continúa, mantenemos "pensando…" con un nuevo placeholder
                const id2 = ensureTypingPlaceholder();
                activeAssistantIdRef.current = id2;

                maybeDispatchKommoFrom(text);
              }
            } catch {}
          } else if (event === 'done' || event === 'error') {
            setIsLoading(false);
            // limpia cualquier "…" restante
            setMessages((prev) => {
              const next = [...prev];
              for (let i = next.length - 1; i >= 0; i--) {
                const m: any = next[i];
                if (m.role === 'assistant' && m.parts?.length === 1 && m.parts[0]?.text === '…') {
                  next.splice(i, 1);
                }
              }
              return next;
            });
          }
        }
      }
    } catch (err) {
      console.error('[CV][chat] stream error', err);
      setIsLoading(false);
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
            disabled={isLoading}
            className="rounded-full px-4 py-3 font-medium hover:opacity-90 transition bg-[#bba36d] text-black shadow disabled:opacity-60"
            aria-label="Enviar"
            title={isLoading ? 'Esperando respuesta…' : 'Enviar'}
          >
            ➤
          </button>
        </div>
      </form>
    </div>
  );
}
