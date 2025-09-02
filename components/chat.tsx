'use client';

import { useEffect, useRef, useState } from 'react';
import Messages from './messages';
import type { ChatMessage } from '@/lib/types';

const THREAD_KEY = 'cv_thread_id_session';

function ulog(event: string, meta: any = {}) {
  try { console.debug('[CV][ui]', event, meta); } catch {}
}

// -------------------- Kommo helpers --------------------
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
    const rest = text.slice(at + '```cv:kommo'.length);
    const json = extractBalancedJson(rest, rest.indexOf('{'));
    if (json) {
      try {
        const parsed = JSON.parse(json);
        if (parsed && Array.isArray(parsed.ops)) blocks.push({ raw: json, json: parsed });
      } catch {}
    }
  }
  return blocks;
}

// -------------------- Segmentación texto/JSON --------------------

// Quita SOLO fences cv:kommo del texto visible
function stripKommoFences(text: string): string {
  if (!text) return text;
  return text.replace(/```cv:kommo[\s\S]*?```/gi, '').trim();
}

// Devuelve una lista ordenada de segmentos [{type:'text'|'json', text}], soporta múltiples fences y JSON balanceado "suelto"
function tokenizeTextJsonSegments(rawInput: string): Array<{type:'text'|'json', text:string}> {
  const out: Array<{type:'text'|'json', text:string}> = [];
  if (!rawInput || !rawInput.trim()) return out;

  // 1) quitar cv:kommo del render (sigue yendo a CRM por otra vía)
  let s = stripKommoFences(rawInput);

  // 2) encontrar todas las fences (cv:itinerary | cv:quote | json)
  const fenceRx = /```[ \t]*(cv:itinerary|cv:quote|json)[ \t]*\n?([\s\S]*?)```/gi;
  let cursor = 0;
  let m: RegExpExecArray | null;
  while ((m = fenceRx.exec(s))) {
    const start = m.index;
    const end = m.index + m[0].length;

    const before = s.slice(cursor, start);
    if (before.trim()) out.push({ type: 'text', text: before.trim() });

    const rawJson = (m[2] || '').trim();
    try {
      const pretty = JSON.stringify(JSON.parse(rawJson), null, 2);
      out.push({ type: 'json', text: pretty });
    } catch {
      // si la fence no parsea como JSON, la dejamos como texto literal
      out.push({ type: 'text', text: m[0] });
    }

    cursor = end;
  }

  // 3) resto después de la última fence -> buscar JSON balanceado suelto (múltiples)
  s = s.slice(cursor);

  const pushText = (t: string) => { if (t && t.trim()) out.push({ type: 'text', text: t.trim() }); };

  let i = 0, textStart = 0;
  while (i < s.length) {
    if (s[i] === '{') {
      // buscar cierre balanceado
      let j = i, depth = 0, inStr = false, esc = false, closed = false;
      for (; j < s.length; j++) {
        const ch = s[j];
        if (inStr) {
          if (esc) { esc = false; continue; }
          if (ch === '\\') { esc = true; continue; }
          if (ch === '"') { inStr = false; continue; }
          continue;
        }
        if (ch === '"') { inStr = true; continue; }
        if (ch === '{') { depth++; continue; }
        if (ch === '}') { depth--; if (depth === 0) { closed = true; j++; break; } }
      }
      if (closed) {
        const before = s.slice(textStart, i);
        pushText(before);
        const cand = s.slice(i, j);
        try {
          const pretty = JSON.stringify(JSON.parse(cand), null, 2);
          out.push({ type: 'json', text: pretty });
          textStart = j;
          i = j;
          continue;
        } catch {
          // no era JSON válido → seguir escaneando
        }
      }
    }
    i++;
  }

  const rest = s.slice(textStart);
  pushText(rest);

  // 4) compactar textos contiguos
  const compact: Array<{type:'text'|'json', text:string}> = [];
  for (const seg of out) {
    if (seg.type === 'text' && compact.length && compact[compact.length-1].type === 'text') {
      compact[compact.length-1].text += '\n\n' + seg.text;
    } else {
      compact.push(seg);
    }
  }
  return compact.filter(sg => sg.text.trim().length);
}

export default function Chat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const threadIdRef = useRef<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLFormElement | null>(null);

  // evita duplicar ejecuciones de kommo
  const kommoHashesRef = useRef<Set<string>>(new Set());
  // cuenta de mensajes finalizados dentro del mismo RUN
  const runFinalsCountRef = useRef<number>(0);

  const [composerH, setComposerH] = useState<number>(84);
  const lastMsgIdRef = useRef<string | null>(null);

  const scrollToBottom = (behavior: ScrollBehavior = 'auto') => {
    const scroller = listRef.current;
    if (!scroller) return;
    endRef.current?.scrollIntoView({ behavior, block: 'end' });
    scroller.scrollTo({ top: scroller.scrollHeight, behavior });
  };

  // restaurar thread desde sessionStorage
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

  // auto-scroll al añadir nuevo mensaje
  useEffect(() => {
    const last = messages[messages.length - 1]?.id;
    if (!last) return;
    if (lastMsgIdRef.current !== last) {
      lastMsgIdRef.current = last;
      requestAnimationFrame(() => scrollToBottom('smooth'));
    }
  }, [messages]);

  // ---- despacho CRM Kommo (interno, no visible) ----
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

  async function handleStream(userText: string) {
    // loader on desde inicio de RUN
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
      let currentMsgBuffer = '';
      let fullTextForKommo = '';

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
            continue;
          }

          if (event === 'kommo') {
            try {
              const data = JSON.parse(dataLine || '{}');
              const ops = Array.isArray(data?.ops) ? data.ops : [];
              if (ops.length) {
                const rawKey = JSON.stringify(ops).slice(0, 40);
                dispatchKommoOps(ops, rawKey);
              }
            } catch {}
            continue;
          }

          if (event === 'delta') {
            try {
              const data = JSON.parse(dataLine || '{}');
              if (typeof data?.value === 'string' && data.value.length) {
                currentMsgBuffer += data.value;
                fullTextForKommo += data.value;

                // Detectar y despachar cv:kommo durante streaming
                const blocks = extractKommoBlocksFromText(fullTextForKommo);
                for (const b of blocks) {
                  try {
                    if (b.json && Array.isArray(b.json.ops) && b.json.ops.length) {
                      dispatchKommoOps(b.json.ops, b.raw);
                    }
                  } catch {}
                }
              }
            } catch {}
            continue;
          }

          if (event === 'final') {
            try {
              const data = JSON.parse(dataLine || '{}');
              const text = String(data?.text ?? '');
              const finalTextRaw = text || currentMsgBuffer;
              currentMsgBuffer = '';

              if (finalTextRaw && finalTextRaw.trim().length) {
                // dividir en múltiples segmentos en el orden original
                const segments = tokenizeTextJsonSegments(finalTextRaw);

                const pushAssistant = (txt: string) => {
                  const id = `a_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
                  const newMsg: ChatMessage = {
                    id,
                    role: 'assistant',
                    parts: [{ type: 'text', text: txt }] as any,
                    createdAt: new Date().toISOString(),
                  } as any;
                  setMessages((prev) => [...prev, newMsg]);
                };

                for (const seg of segments) {
                  pushAssistant(seg.text);
                }
              }

              runFinalsCountRef.current += 1;

              // Despachar Kommo si solo vino en el final
              const kommoBlocks = extractKommoBlocksFromText(finalTextRaw);
              for (const b of kommoBlocks) {
                try {
                  if (b.json && Array.isArray(b.json.ops) && b.json.ops.length) {
                    dispatchKommoOps(b.json.ops, b.raw);
                  }
                } catch {}
              }
            } catch {}
            continue;
          }

          if (event === 'done' || event === 'error') {
            // loader off SOLO cuando terminó el RUN
            setIsLoading(false);
          }
        }
      }
    } catch (err) {
      console.error('[CV][chat] stream error', err);
      setIsLoading(false);
      setMessages((prev) => [
        ...prev,
        {
          id: `a_err_${Date.now()}`,
          role: 'assistant',
          parts: [{ type: 'text', text: '⚠️ No pude conectarme. Intenta otra vez.' }] as any,
          createdAt: new Date().toISOString(),
        } as any,
      ]);
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || isLoading) return;

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
    <div className="flex flex-col min-h-[100svh] w-full">
      <div ref={listRef} className="relative flex-1 overflow-y-auto">
        {/* Capa de fondo con GIF, centrado y responsivo (máx 60% pantalla) */}
        <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
          <img
            src="/images/Texts.gif"
            alt="Coco Volare"
            className="w-full h-auto max-w-[60vw] max-h-[60vh] opacity-30"
            style={{ objectFit: 'contain' }}
            draggable={false}
          />
        </div>

        {/* Contenido de mensajes encima del fondo */}
        <div className="relative z-10 mx-auto max-w-3xl w-full px-4" style={{ paddingBottom: composerH + 12 }}>
          <Messages
            messages={messages}
            isLoading={isLoading}
            setMessages={(p: any) => setMessages(p.messages)}
            regenerate={async () => {}}
          />
          <div ref={endRef} className="h-6" />
        </div>
      </div>

      <form
        ref={composerRef}
        onSubmit={handleSubmit}
        className="sticky bottom-0 z-20 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-t"
      >
        <div className="mx-auto max-w-3xl w-full px-4 py-3 flex items-center gap-2">
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
