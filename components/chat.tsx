'use client';

import { useEffect, useRef, useState } from 'react';
import Messages from './messages';
import type { ChatMessage } from '@/lib/types';

const THREAD_KEY = 'cv_thread_id_session';

function ulog(event: string, meta: any = {}) {
  try { console.debug('[CV][ui]', event, meta); } catch {}
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

function extractKommoBlocksFromText(text: string): Array<{ raw: string; json: any }> {
  const blocks: Array<{ raw: string; json: any }> = [];
  if (!text) return blocks;
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

// Quita SOLO las fences cv:kommo del texto visible
function stripKommoFences(text: string): string {
  if (!text) return text;
  return text.replace(/```cv:kommo[\s\S]*?```/gi, '').trim();
}

// Intenta detectar un bloque JSON visible (no-kommo) y separar texto+json
function splitTextAndJsonForUser(rawInput: string): { mode: 'onlyText'|'onlyJson'|'textAndJson', textPart?: string, jsonText?: string } {
  if (!rawInput || !rawInput.trim()) return { mode: 'onlyText', textPart: '' };

  const input = stripKommoFences(rawInput);

  // 1) Fences específicas con JSON
  const fences = [
    { label: 'cv:itinerary', rx: /```[\t ]*cv:itinerary[\t ]*([\s\S]*?)```/i },
    { label: 'cv:quote',     rx: /```[\t ]*cv:quote[\t ]*([\s\S]*?)```/i },
    { label: 'json',         rx: /```[\t ]*json[\t ]*([\s\S]*?)```/i },
  ];

  for (const f of fences) {
    const m = f.rx.exec(input);
    if (m && m[0]) {
      const rawJson = (m[1] || '').trim();
      let pretty = rawJson;
      try { pretty = JSON.stringify(JSON.parse(rawJson), null, 2); } catch {}
      const textPart = (input.slice(0, m.index) + input.slice(m.index + m[0].length)).trim();
      if (textPart && pretty) return { mode: 'textAndJson', textPart, jsonText: pretty };
      if (pretty) return { mode: 'onlyJson', jsonText: pretty };
      return { mode: 'onlyText', textPart };
    }
  }

  // 2) JSON balanceado "suelto" en el texto
  const brace = input.indexOf('{');
  if (brace >= 0) {
    const balanced = extractBalancedJson(input, brace);
    if (balanced) {
      let pretty = balanced;
      try { pretty = JSON.stringify(JSON.parse(balanced), null, 2); } catch {}
      const before = input.slice(0, brace);
      const after = input.slice(brace + balanced.length);
      const textPart = (before + after).trim();
      if (textPart && pretty) return { mode: 'textAndJson', textPart, jsonText: pretty };
      if (pretty) return { mode: 'onlyJson', jsonText: pretty };
      return { mode: 'onlyText', textPart };
    }
  }

  // 3) Solo texto
  return { mode: 'onlyText', textPart: input };
}

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

  // auto-scroll en nuevo mensaje
  useEffect(() => {
    const last = messages[messages.length - 1]?.id;
    if (!last) return;
    if (lastMsgIdRef.current !== last) {
      lastMsgIdRef.current = last;
      requestAnimationFrame(() => scrollToBottom('smooth'));
    }
  }, [messages]);

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
                // ---- SPLIT TEXTO + JSON EN DOS MENSAJES ----
                const split = splitTextAndJsonForUser(finalTextRaw);

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

                if (split.mode === 'textAndJson') {
                  if (split.textPart && split.textPart.trim()) pushAssistant(split.textPart.trim());
                  if (split.jsonText && split.jsonText.trim()) pushAssistant(split.jsonText.trim());
                } else if (split.mode === 'onlyJson') {
                  pushAssistant(split.jsonText || '');
                } else {
                  pushAssistant(split.textPart || '');
                }
              }

              runFinalsCountRef.current += 1;

              // también despacha cv:kommo si vino sólo en el final
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
    <div className="flex flex-col h-full w-full">
      <div ref={listRef} className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl w-full px-4" style={{ paddingBottom: composerH + 12 }}>
          <Messages
            messages={messages}
            isLoading={isLoading}
            setMessages={(p: any) => setMessages(p.messages)}
            regenerate={async () => {}}
          />
          <div ref={endRef} className="h-6" />
        </div>
      </div>

      <form ref={composerRef} onSubmit={handleSubmit} className="sticky bottom-0 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-t">
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
