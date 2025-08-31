'use client';

import { useEffect, useRef, useState } from 'react';
import Messages from './messages';
import type { ChatMessage } from '@/lib/types';

const THREAD_KEY = 'cv_thread_id_session';

function ulog(event: string, meta: any = {}) {
  try { console.debug('[CV][ui]', event, meta); } catch {}
}

export default function Chat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const threadIdRef = useRef<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLFormElement | null>(null);

  // evitar duplicados de Kommo por mensaje
  const kommoHashesRef = useRef<Set<string>>(new Set());

  // Extrae bloques cv:kommo como JSON
  function extractKommoBlocks(text: string): Array<{ raw: string; json: any }> {
    const blocks: Array<{ raw: string; json: any }> = [];
    if (!text) return blocks;
    const re = /```\\s*cv:kommo\\s*([\\s\\S]*?)```/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const raw = m[1]?.trim() || '';
      try {
        const json = JSON.parse(raw);
        if (json && json.ops && Array.isArray(json.ops)) blocks.push({ raw, json });
      } catch {
        // ignore malformed
      }
    }
    return blocks;
  }

  async function dispatchKommoFromText(text: string) {
    try {
      const blocks = extractKommoBlocks(text);
      if (!blocks.length) return;
      const threadId = threadIdRef.current;
      for (const b of blocks) {
        const key = 'k_' + (b.raw.length > 16 ? b.raw.slice(0, 16) : b.raw);
        if (kommoHashesRef.current.has(key)) continue;
        kommoHashesRef.current.add(key);
        // fire-and-forget; no await para no bloquear la UI
        fetch('/api/kommo/dispatch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ops: b.json.ops, threadId }),
          keepalive: true,
        }).catch(() => {});
      }
    } catch {}
  }

  // altura dinámica del composer
  const [composerH, setComposerH] = useState<number>(84);

  // detectar “nuevo mensaje” para auto-scroll SOLO una vez
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

  // auto-scroll SOLO cuando hay un mensaje NUEVO (id distinto)
  useEffect(() => {
    const last = messages[messages.length - 1]?.id;
    if (!last) return;
    if (lastMsgIdRef.current !== last) {
      lastMsgIdRef.current = last;
      // desplazamiento único para que el nuevo mensaje ya visible quede arriba del input
      requestAnimationFrame(() => scrollToBottom('smooth'));
    }
  }, [messages]);

  async function handleStream(userText: string, assistantId: string) {
    setIsLoading(true);

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

      // NOTA: durante el streaming NO forzamos scroll; ya hicimos el ajuste al crear el placeholder
      const applyText = (chunk: string, replace = false) => {
        setMessages((prev) => {
          const next = [...prev];
          const idx = next.findIndex((m) => m.id === assistantId);
          if (idx >= 0) {
            const curr = next[idx] as any;
            const before = curr.parts?.[0]?.text ?? '';
            curr.parts = [{ type: 'text', text: replace ? chunk : before + chunk }];
            next[idx] = curr;
          }
          return next;
        });
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';

        for (const ev of events) {
          const lines = ev.split('\n');
          const event = (lines.find((l) => l.startsWith('event:')) || '').replace('event:', '').trim();
          const dataLine = (lines.find((l) => l.startsWith('data:')) || '').replace('data:', '').trim();
          if (!event) continue;

          if (event === 'meta') {
            try {
              const data = JSON.parse(dataLine || '{}');
              if (data?.threadId) {
                threadIdRef.current = data.threadId;
                try { window.sessionStorage.setItem(THREAD_KEY, data.threadId); } catch {}
              }
            } catch {}
          } else if (event === 'delta') {
            try {
              const data = JSON.parse(dataLine || '{}');
              if (typeof data?.value === 'string' && data.value.length) applyText(data.value);
            } catch {}
          } else if (event === 'final') {
            try {
              const data = JSON.parse(dataLine || '{}');
              if (typeof data?.text === 'string') { applyText(data.text, true); dispatchKommoFromText(data.text); }
            } catch {}
          } else if (event === 'done' || event === 'error') {
            setIsLoading(false);
          }
        }
      }
    } catch (err) {
      console.error('[CV][chat] stream error', err);
      // fallback: muestra error en el último placeholder
      setMessages((prev) => {
        const next = [...prev];
        const idx = next.findIndex((m) => (m as any).role === 'assistant' && (m as any).parts?.[0]?.text === '');
        if (idx >= 0) {
          (next[idx] as any).parts = [{ type: 'text', text: '⚠️ No pude conectarme. Intenta otra vez.' }];
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
    const assistantId = `a_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    const userMsg: ChatMessage = {
      id: userId,
      role: 'user',
      parts: [{ type: 'text', text }] as any,
      createdAt: new Date().toISOString(),
    } as any;

    const assistantPlaceholder: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      parts: [{ type: 'text', text: '' }] as any,
      createdAt: new Date().toISOString(),
    } as any;

    // agregar ambos y limpiar input
    setMessages((prev) => [...prev, userMsg, assistantPlaceholder]);
    setInput('');
    // el efecto de "nuevo id" hará el auto-scroll una sola vez
    await handleStream(text, assistantId);
  };

  const showEmpty = messages.length === 0;

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
