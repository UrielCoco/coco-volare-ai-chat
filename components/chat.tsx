'use client';

import { useEffect, useRef, useState } from 'react';
import Messages from './messages';
import type { ChatMessage } from '@/lib/types';

const THREAD_KEY = 'cv_thread_id_session';

function ulog(event: string, meta: any = {}) {
  try { console.debug('[CV][ui]', event, meta); } catch {}
}

// ---------- Visibilidad: ignora bloques ocultos cv:kommo ----------
function stripHidden(s: string) {
  if (!s) return '';
  return s.replace(/```cv:kommo[\s\S]*?```/gi, '').trim();
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

  // fenced
  const re = /```cv:kommo\s*([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const raw = m[1] || '';
    try {
      blocks.push({ raw, json: JSON.parse(raw) });
    } catch {
      // intenta extraer JSON balanceado dentro
      const braceIdx = raw.indexOf('{');
      if (braceIdx >= 0) {
        const json = extractBalancedJson(raw, braceIdx);
        if (json) {
          try { blocks.push({ raw, json: JSON.parse(json) }); } catch {}
        }
      }
    }
  }
  return blocks;
}

// ---------- UI ----------
export default function Chat({
  initialMessages = [],
  chatId,
  isReadonly,
}: {
  initialMessages?: ChatMessage[];
  chatId?: string;
  isReadonly?: boolean;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages as any);
  const [isLoading, setIsLoading] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [input, setInput] = useState('');

  // placeholder "…" activo
  const [typingIds, setTypingIds] = useState<string[]>([]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // evita duplicados de Kommo por contenido
  const kommoHashesRef = useRef<Set<string>>(new Set());

  // controla finales dentro del MISMO stream (pueden ser varios runs: reprompt “?”)
  const runVisibleRef = useRef<boolean>(false);
  const runFinalsCountRef = useRef<number>(0);
  const activeAssistantIdRef = useRef<string | null>(null); // id del mensaje en curso

  function scrollToBottom() {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }

  useEffect(() => { scrollToBottom(); }, [messages, typingIds.length]);

  useEffect(() => {
    try {
      const savedThread = sessionStorage.getItem(THREAD_KEY);
      if (savedThread) setThreadId(savedThread);
    } catch {}
  }, []);

  function ensureTypingPlaceholder() {
    const id = `typing_${Math.random().toString(36).slice(2)}`;
    setTypingIds((prev) => prev.includes(id) ? prev : [...prev, id]);
    // agrega burbuja visual
    setMessages((prev) => [...prev, { role: 'assistant', parts: [{ type: 'text', text: '…' }] } as any]);
    return id;
  }

  function removeTypingPlaceholders() {
    setTypingIds([]);
    setMessages((prev) => prev.filter((m) => !(m.role === 'assistant' && m.parts?.[0]?.text === '…')));
  }

  function ensureActiveAssistantBubble() {
    if (!activeAssistantIdRef.current) {
      activeAssistantIdRef.current = ensureTypingPlaceholder();
    }
  }

  function applyText(textDelta: string, replace = false) {
    setMessages((prev) => {
      const next = [...prev];
      for (let i = next.length - 1; i >= 0; i--) {
        const m = next[i];
        if (m.role === 'assistant') {
          const cur = m.parts?.[0]?.text ?? '';
          const newText = replace ? textDelta : (cur + textDelta);
          next[i] = { ...m, parts: [{ type: 'text', text: newText }] } as any;
          break;
        }
      }
      return next;
    });
  }

  function dedupeVisibleFencesKeepLast(text: string) {
    if (!text) return text;
    // Dedup de fences idénticos (misma etiqueta y mismo JSON) conservando el último
    const fences = [...text.matchAll(/```cv:(itinerary|quote)\s*([\s\S]*?)```/gi)];
    if (fences.length <= 1) return text;
    const lines = text.split('\n');
    const keepIdx = new Set<number>();
    let lastKey = '';
    for (let i = fences.length - 1; i >= 0; i--) {
      const lbl = fences[i][1].toLowerCase();
      const raw = fences[i][2].trim();
      const key = `${lbl}:${raw}`;
      if (!lastKey) { lastKey = key; keepIdx.add(i); }
      else if (key !== lastKey) keepIdx.add(i);
    }
    // reconstrucción simple: elimina fences duplicados exactos previos
    let idxFence = 0;
    const rebuilt: string[] = [];
    let cursor = 0;
    for (const f of fences) {
      const start = f.index ?? text.indexOf(f[0], cursor);
      const end = start + f[0].length;
      rebuilt.push(text.slice(cursor, start));
      if (keepIdx.has(idxFence)) rebuilt.push(f[0]);
      cursor = end;
      idxFence++;
    }
    rebuilt.push(text.slice(cursor));
    return rebuilt.join('');
  }

  function extractKommoOpsFromDelta(deltaChunk: string): any[] {
    // rápido: cuando el delta trae bloque cv:kommo completo
    const m = deltaChunk.match(/```cv:kommo\s*([\s\S]*?)```/i);
    if (!m) return [];
    try {
      const json = JSON.parse(m[1]);
      return Array.isArray(json?.ops) ? json.ops : [];
    } catch {
      return [];
    }
  }

  function dispatchKommoOps(ops: any[], rawKey: string) {
    const h = kommoHashesRef.current;
    if (h.has(rawKey)) return;
    h.add(rawKey);
    // TODO: aquí va tu integración real a Kommo (ya la tienes); dejamos el hook.
    ulog('kommo.dispatch', { count: ops.length });
  }

  function maybeDispatchKommo() {
    // intenta detectar ops en el texto visible del último assistant
    const last = [...messages].reverse().find((m) => m.role === 'assistant');
    const txt = last?.parts?.[0]?.text || '';
    const blocks = extractKommoBlocksFromText(txt);
    for (const b of blocks) {
      try {
        const ops = (b?.json && Array.isArray(b.json.ops)) ? b.json.ops : [];
        if (ops.length) {
          const rawKey = JSON.stringify(ops).slice(0, 40);
          dispatchKommoOps(ops, rawKey);
        }
      } catch {}
    }
  }

  async function sendMessage() {
    if (isReadonly) return;
    const content = input.trim();
    if (!content) return;

    const id = crypto.randomUUID();
    const userMsg: ChatMessage = { id, role: 'user', parts: [{ type: 'text', text: content }] } as any;
    setMessages((prev) => [...prev, userMsg]);
    setInput('');

    setIsLoading(true);
    runFinalsCountRef.current = 0;
    runVisibleRef.current = false;

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    const qs: Record<string, string> = {};
    if (threadId) qs.threadId = threadId;
    if (chatId) qs.chatId = chatId;
    const url = `/app/(chat)/api/chat/route?${new URLSearchParams(qs)}`;

    // placeholder
    const typingId = ensureTypingPlaceholder();
    activeAssistantIdRef.current = typingId;

    try {
      const res = await fetch(url, {
        method: 'POST',
        body: JSON.stringify({ message: content }),
        headers: { 'Content-Type': 'application/json' },
        signal: ac.signal,
      });
      if (!res.ok || !res.body) {
        setIsLoading(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullText = '';

      const setTidFromMeta = (t?: string) => {
        if (t && !threadId) {
          setThreadId(t);
          try { sessionStorage.setItem(THREAD_KEY, t); } catch {}
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // parse SSE
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const dataLine = line.slice(5).trim();
          if (!dataLine) continue;
          let obj: any = null;
          try { obj = JSON.parse(dataLine); } catch {}
          const event = obj?.event as string || obj?.e as string || '';

          if (event === 'meta') {
            setTidFromMeta(obj?.threadId);
            continue;
          } else if (event === 'hb') {
            // heartbeat: no-op (mantiene vivo el loader)
            continue;
          } else if (event === 'kommo') {
            try {
              const ops = (obj?.ops && Array.isArray(obj.ops)) ? obj.ops : [];
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
                ensureActiveAssistantBubble();

                const incoming = data.value;
                const visible = stripHidden(incoming);

                // primer delta visible → limpia el “...”
                if (fullText.length === 0 && visible.length > 0) {
                  applyText('', true);
                }

                fullText += incoming;
                applyText(incoming);
                if (visible.length > 0) runVisibleRef.current = true;

                maybeDispatchKommo();
              }
            } catch {}
          } else if (event === 'final') {
            try {
              const data = JSON.parse(dataLine || '{}');
              if (typeof data?.text === 'string') {
                const textRaw = data.text;
                const text = dedupeVisibleFencesKeepLast(textRaw);

                const hasBlock = /```cv:(itinerary|quote)\b/i.test(text);
                const visible = stripHidden(text);

                fullText = '';
                ensureActiveAssistantBubble();

                // Si no hay nada visible ni bloques renderizables → mantener placeholder y esperar siguiente run
                if (!hasBlock && visible.length === 0) {
                  const id2 = ensureTypingPlaceholder();
                  activeAssistantIdRef.current = id2;
                  // no marcamos visible
                  return;
                }

                if (runFinalsCountRef.current === 0) {
                  applyText(text, true);
                  if (!hasBlock) {
                    const id2 = ensureTypingPlaceholder();
                    activeAssistantIdRef.current = id2;
                  }
                } else {
                  applyText(text, true);
                }

                if (visible.length > 0 || hasBlock) runVisibleRef.current = true;

                runFinalsCountRef.current += 1;

                const blocks = extractKommoBlocksFromText(text);
                for (const b of blocks) {
                  try {
                    const ops = (b?.json && Array.isArray(b.json.ops)) ? b.json.ops : [];
                    if (ops.length) {
                      const rawKey = JSON.stringify(ops).slice(0, 40);
                      dispatchKommoOps(ops, rawKey);
                    }
                  } catch {}
                }
              }
            } catch {}
          } else if (event === 'done') {
            setIsLoading(false);
            setMessages((prev) => {
              if (!runVisibleRef.current) return prev;
              return prev.filter((m: any) => !(m.role === 'assistant' && m.parts?.[0]?.text === '…'));
            });
            runVisibleRef.current = false;
          } else if (event === 'error') {
            // ⚠️ NO limpiar ni cerrar: el server puede auto-reprompt y seguir streameando.
            ulog('sse.error.ignored', { data: dataLine });
            // dejamos la barra "pensando…" activa
          }
        }
      }
    } catch (err) {
      console.error('[CV][chat] stream error', err);
      setIsLoading(false);
      // no quites de golpe los placeholders; el usuario puede reintentar
    } finally {
      abortRef.current = null;
    }
  }

  async function regenerate() {
    if (isReadonly) return;
    // simple: re-envía último prompt del usuario
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    if (!lastUser) return;
    setInput(lastUser.parts?.[0]?.text || '');
  }

  return (
    <div className="w-full h-full flex flex-col">
      <div className="flex-1 overflow-y-auto px-2 sm:px-4">
        <Messages
          messages={messages}
          isLoading={isLoading}
          setMessages={({ messages: m }) => setMessages(m)}
          regenerate={regenerate}
          isReadonly={isReadonly}
          chatId={chatId}
        />
        <div ref={messagesEndRef} />
      </div>

      {!isReadonly && (
        <form
          className="w-full p-3 sm:p-4 border-t border-zinc-800 flex gap-2 items-center"
          onSubmit={(e) => { e.preventDefault(); sendMessage(); }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Escribe tu mensaje…"
            className="flex-1 bg-black/40 border border-zinc-800 rounded-xl px-4 py-3 outline-none focus:border-zinc-600"
          />
          <button
            type="submit"
            disabled={isLoading}
            className="px-4 py-2 rounded-xl bg-amber-500 text-black font-semibold disabled:opacity-50"
          >
            Enviar
          </button>
        </form>
      )}
    </div>
  );
}
