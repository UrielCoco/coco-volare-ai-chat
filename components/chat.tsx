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

// ---------- Desduplicación de fences visibles (cv:itinerary / cv:quote) ----------
// Regla: si en un MISMO texto vienen 2+ fences VISIBLES idénticos, se elimina(n) todos
// menos el ÚLTIMO para no duplicar tarjetas en la UI.
function dedupeVisibleFencesKeepLast(text: string): string {
  if (!text) return text;

  const rx = /```cv:(itinerary|quote)\s*([\s\S]*?)```/gi;
  const matches: Array<{ idx: number; start: number; end: number; raw: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = rx.exec(text))) {
    matches.push({
      idx: matches.length,
      start: m.index,
      end: m.index + m[0].length,
      raw: m[0],
    });
  }
  if (matches.length <= 1) return text;

  // Agrupar por contenido RAW del fence (idénticos byte a byte)
  const groups = new Map<string, number[]>();
  matches.forEach((mm, i) => {
    const key = mm.raw;
    const arr = groups.get(key) || [];
    arr.push(i);
    groups.set(key, arr);
  });

  // Marcar para eliminar todos menos el último de cada grupo con tamaño > 1
  const toDrop = new Set<number>();
  Array.from(groups.entries()).forEach(([, idxs]) => {
    if (idxs.length > 1) {
      idxs.slice(0, -1).forEach((i) => toDrop.add(i));
    }
  });
  if (toDrop.size === 0) return text;

  // Reconstruir texto saltando los rangos drop
  let out = '';
  let cursor = 0;
  matches.forEach((mm, i) => {
    if (toDrop.has(i)) {
      out += text.slice(cursor, mm.start);
      cursor = mm.end; // saltar este fence duplicado
    }
  });
  out += text.slice(cursor);

  ulog('ui.fence.dedup', {
    total: matches.length,
    dropped: toDrop.size,
    kept: matches.length - toDrop.size,
  });

  return out;
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

  // controla finales dentro del MISMO stream (pueden ser varios runs: reprompt “?”)
  const runFinalsCountRef = useRef<number>(0);
  const activeAssistantIdRef = useRef<string | null>(null); // id del mensaje “en curso”

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

  // crea un mensaje placeholder con “…” (typing)
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

  async function handleStream(userText: string) {
    setIsLoading(true);
    runFinalsCountRef.current = 0;
    activeAssistantIdRef.current = null;

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
      let fullText = ''; // acumulado del mensaje “en curso”

      // typing placeholder desde el arranque
      let typingId = ensureTypingPlaceholder();
      activeAssistantIdRef.current = typingId;

      // helpers para escribir en el mensaje ACTIVO (placeholder o el último)
      const applyText = (chunk: string, replace = false) => {
        setMessages((prev) => {
          const next = [...prev];
          const aid = activeAssistantIdRef.current;
          const idx = aid ? next.findIndex((m) => m.id === aid) : -1;
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
        const blocks = extractKommoBlocksFromText(fullText);
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
            } catch {}
          } else if (event === 'kommo') {
            try {
              const data = JSON.parse(dataLine || '{}');
              const ops = Array.isArray(data?.ops) ? data.ops : [];
              ulog('sse.kommo', { count: ops.length });
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
                if (fullText.length === 0) {
                  // primer delta: limpia el “…”
                  applyText('', true);
                }
                fullText += data.value;
                applyText(data.value);
                maybeDispatchKommo();
              }
            } catch {}
          } else if (event === 'final') {
            try {
              const data = JSON.parse(dataLine || '{}');
              if (typeof data?.text === 'string') {
                // ---- desduplicar fences visibles manteniendo el ÚLTIMO idéntico
                const textRaw = data.text;
                const text = dedupeVisibleFencesKeepLast(textRaw);

                const hasBlock = /```cv:(itinerary|quote)\b/.test(text);

                // reinicia buffer para el siguiente mensaje potencial
                fullText = '';

                if (runFinalsCountRef.current === 0) {
                  // Primer final del stream → reemplaza el primer placeholder
                  applyText(text, true);

                  // Si NO hay bloque visible, dejamos un 2º placeholder “pensando…”
                  if (!hasBlock) {
                    const id2 = ensureTypingPlaceholder();
                    activeAssistantIdRef.current = id2;
                  }
                } else {
                  // FINAL SUBSECUENTE (p.ej. tras reprompt "?"):
                  // Reemplazamos el placeholder activo (no creamos nuevo bubble).
                  applyText(text, true);
                }

                runFinalsCountRef.current += 1;

                // Despacho Kommo si vino en este final
                const blocks = extractKommoBlocksFromText(text);
                for (const b of blocks) {
                  try {
                    if (b.json && Array.isArray(b.json.ops) && b.json.ops.length) {
                      dispatchKommoOps(b.json.ops, b.raw);
                    }
                  } catch {}
                }
              }
            } catch {}
          } else if (event === 'done' || event === 'error') {
            setIsLoading(false);
            // Limpia TODOS los placeholders “…” sobrantes
            setMessages((prev) => {
              const next = prev.filter(
                (m: any) => !(m.role === 'assistant' && m.parts?.[0]?.text === '…')
              );
              return [...next];
            });
          }
        }
      }
    } catch (err) {
      console.error('[CV][chat] stream error', err);
      setIsLoading(false);
      setMessages((prev) => {
        // Si hay algún placeholder, muéstrale error
        const next = [...prev];
        for (let i = next.length - 1; i >= 0; i--) {
          const m: any = next[i];
          if (m.role === 'assistant' && m.parts?.[0]?.text === '…') {
            (next[i] as any).parts = [
              { type: 'text', text: '⚠️ No pude conectarme. Intenta otra vez.' },
            ];
            break;
          }
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
