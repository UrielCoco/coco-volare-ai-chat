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
  const [hasFirstDelta, setHasFirstDelta] = useState(false);

  const threadIdRef = useRef<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLFormElement | null>(null);

  // Altura dinámica del composer
  const [composerH, setComposerH] = useState<number>(84);

  // Autoscroll inteligente
  // - nearBottom: margen pequeño para considerar "estoy al fondo"
  // - lockMargin: cuánto me alejo para bloquear el autoscroll
  const NEAR_BOTTOM_PX = 12;
  const LOCK_MARGIN_PX = 48;
  const [stickToBottom, setStickToBottom] = useState(true);

  const distanceToBottom = () => {
    const el = listRef.current;
    if (!el) return 0;
    return el.scrollHeight - (el.scrollTop + el.clientHeight);
  };

  const isNearBottom = () => distanceToBottom() <= NEAR_BOTTOM_PX;

  useEffect(() => {
    if (!composerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const h = Math.ceil(entries[0].contentRect.height);
      if (h && h !== composerH) setComposerH(h);
    });
    ro.observe(composerRef.current);
    return () => ro.disconnect();
  }, [composerH]);

  // Bloqueo/desbloqueo de autoscroll según scroll manual del usuario
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;

    const onScroll = () => {
      const dist = distanceToBottom();
      // Si me alejo más de LOCK_MARGIN_PX, bloqueo autoscroll
      if (dist > LOCK_MARGIN_PX && stickToBottom) setStickToBottom(false);
      // Si vuelvo a estar prácticamente al fondo, re-activo autoscroll
      if (dist <= NEAR_BOTTOM_PX && !stickToBottom) setStickToBottom(true);
    };

    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [stickToBottom]);

  // Apoyo para teclado móvil
  useEffect(() => {
    const vv = (window as any).visualViewport as VisualViewport | undefined;
    if (!vv) return;
    const handler = () => stickToBottom && scrollToBottom('smooth');
    vv.addEventListener('resize', handler);
    vv.addEventListener('scroll', handler);
    return () => {
      vv.removeEventListener('resize', handler);
      vv.removeEventListener('scroll', handler);
    };
  }, [stickToBottom]);

  // Restaurar thread
  useEffect(() => {
    try {
      const ss = window.sessionStorage.getItem(THREAD_KEY);
      if (ss) {
        threadIdRef.current = ss;
        ulog('thread.restore', { threadId: ss });
      }
    } catch {}
  }, []);

  const scrollToBottom = (behavior: ScrollBehavior = 'auto') => {
    const scroller = listRef.current;
    if (!scroller) return;
    endRef.current?.scrollIntoView({ behavior, block: 'end' });
    scroller.scrollTo({ top: scroller.scrollHeight, behavior });
  };

  // Autoscroll SOLO si estás al fondo
  useEffect(() => {
    if (!stickToBottom) return;
    // dos frames para asegurar layout aplicado
    requestAnimationFrame(() =>
      requestAnimationFrame(() => scrollToBottom('auto')),
    );
  }, [messages, hasFirstDelta, composerH, stickToBottom]);

  // También en resize, pero respetando el lock
  useEffect(() => {
    const handler = () => stickToBottom && scrollToBottom('smooth');
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, [stickToBottom]);

  async function handleStream(userText: string, assistantId: string) {
    setIsLoading(true);
    setHasFirstDelta(false);

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
        if (stickToBottom) requestAnimationFrame(() => scrollToBottom('auto'));
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
              if (typeof data?.value === 'string' && data.value.length) {
                if (!hasFirstDelta) setHasFirstDelta(true);
                applyText(data.value);
              }
            } catch {}
          } else if (event === 'final') {
            try {
              const data = JSON.parse(dataLine || '{}');
              if (typeof data?.text === 'string') applyText(data.text, true);
            } catch {}
          } else if (event === 'done' || event === 'error') {
            setIsLoading(false);
            if (stickToBottom) requestAnimationFrame(() => scrollToBottom('smooth'));
          }
        }
      }
    } catch (err) {
      console.error('[CV][chat] stream error:', err);
      setIsLoading(false);
      setMessages((prev) => {
        const next = [...prev];
        const idx = next.findIndex((m) => m.id === assistantId);
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

    setMessages((prev) => [...prev, userMsg, assistantPlaceholder]);
    setInput('');
    // Envío: me pego al final (el usuario espera ver su mensaje y la respuesta)
    setStickToBottom(true);
    requestAnimationFrame(() => scrollToBottom('smooth'));
    await handleStream(text, assistantId);
  };

  const showEmpty = messages.length === 0;

  return (
    <div className="relative flex flex-col w-full min-h-[100dvh] bg-background">
      {/* Área scrolleable */}
      <div
        ref={listRef}
        className="relative flex-1 overflow-y-auto"
        style={{
          paddingBottom: `calc(${composerH}px + env(safe-area-inset-bottom))`,
          scrollPaddingBottom: `calc(${composerH}px + env(safe-area-inset-bottom))`,
          overscrollBehaviorY: 'contain',
        }}
      >
        {showEmpty && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <img
              src="/images/Texts.gif"
              alt="Coco Volare"
              className="w-40 md:w-64 opacity-60"
            />
          </div>
        )}

        <Messages
          messages={messages}
          isLoading={isLoading && !hasFirstDelta}
          setMessages={({ messages }) => setMessages(messages)}
          regenerate={async () => {}}
          isReadonly={false}
          chatId="main"
          votes={[]}
        />

        {/* Spacer = altura del composer, garantiza que el último mensaje no quede tapado */}
        <div style={{ height: composerH }} />
        <div ref={endRef} />

        {/* Botón "Ir al último" cuando autoscroll está bloqueado */}
        {!stickToBottom && (
          <div className="sticky bottom-[calc(12px+var(--safe,0px))] w-full grid place-items-center pointer-events-none" style={{ ['--safe' as any]: 'env(safe-area-inset-bottom)' }}>
            <button
              onClick={() => { setStickToBottom(true); scrollToBottom('smooth'); }}
              className="pointer-events-auto px-3 py-2 rounded-full bg-black/80 text-white shadow"
              aria-label="Ir al último"
            >
              Ir al último
            </button>
          </div>
        )}
      </div>

      {/* Composer */}
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
            onFocus={() => stickToBottom && requestAnimationFrame(() => scrollToBottom('smooth'))}
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
