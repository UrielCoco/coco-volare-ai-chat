'use client';

import React, { useCallback, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import Messages from '@/components/messages'; // default export

type Role = 'user' | 'assistant' | 'system';

type Message = {
  id: string;
  role: Role;
  content: string;
  createdAt?: Date | string;
  meta?: Record<string, any>;
};

type SSEEvent =
  | { event: 'meta'; data: { threadId: string } }
  | { event: 'delta'; data: { value: string } }
  | { event: 'final'; data: { text: string; fences?: Array<{ label: string; json: string }> } }
  | { event: 'done'; data?: { ok?: boolean } }
  | { event: 'error'; data?: { message?: string } };

function parseSSE(raw: string): Array<SSEEvent> {
  const out: Array<SSEEvent> = [];
  const blocks = raw.split(/\n\n+/);
  for (const blk of blocks) {
    if (!blk.trim()) continue;
    let evt = 'message';
    let dataStr = '';
    for (const line of blk.split('\n')) {
      if (line.startsWith('event:')) evt = line.slice(6).trim();
      else if (line.startsWith('data:')) dataStr += line.slice(5).trim();
    }
    let data: any;
    if (dataStr) {
      try {
        data = JSON.parse(dataStr);
      } catch {
        data = { raw: dataStr };
      }
    }
    // @ts-ignore
    out.push({ event: evt, data });
  }
  return out;
}

export default function Chat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const threadIdRef = useRef<string | null>(null);
  const finalDeduper = useRef<Set<string>>(new Set());

  const add = (m: Message) => setMessages((prev) => [...prev, m]);
  const fp = (t: string) => `${t.length}:${t.slice(0, 64)}`;

  const handleSend = useCallback(async () => {
    if (!input.trim() || isSending) return;

    const user: Message = {
      id: `local_${Date.now()}_user`,
      role: 'user',
      content: input,
      createdAt: new Date(),
    };
    add(user);
    setIsSending(true);

    const thinkingId = `local_${Date.now()}_thinking`;
    add({ id: thinkingId, role: 'assistant', content: '…', meta: { thinking: true } });

    try {
      const res = await fetch('/api/chat?stream=1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: { role: 'user', content: input },
          threadId: threadIdRef.current,
        }),
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const splitAt = buffer.lastIndexOf('\n\n');
        if (splitAt === -1) continue;

        const chunk = buffer.slice(0, splitAt + 2);
        buffer = buffer.slice(splitAt + 2);

        const events = parseSSE(chunk);
        for (const ev of events) {
          switch (ev.event) {
            case 'meta':
              if (ev.data?.threadId) threadIdRef.current = ev.data.threadId;
              break;

            case 'delta':
              // mantenemos el “pensando…”; no renderizamos deltas crudos
              break;

            case 'final': {
              const text: string = ev.data?.text ?? '';
              const key = fp(text.trim());
              if (!text.trim()) break;
              if (finalDeduper.current.has(key)) break;
              finalDeduper.current.add(key);

              setMessages((prev) => {
                const idx = prev.findIndex((m) => (m as any).meta?.thinking);
                const next = idx >= 0 ? [...prev.slice(0, idx), ...prev.slice(idx + 1)] : prev.slice();
                next.push({
                  id: `local_${Date.now()}_assistant_${next.length}`,
                  role: 'assistant',
                  content: text,
                  createdAt: new Date(),
                });
                return next;
              });
              break;
            }

            case 'error':
              setMessages((prev) =>
                prev
                  .filter((m) => !(m as any).meta?.thinking)
                  .concat([
                    {
                      id: `local_${Date.now()}_error`,
                      role: 'assistant',
                      content: `Ocurrió un error: ${ev.data?.message ?? ''}`.trim(),
                    },
                  ]),
              );
              break;

            case 'done':
              setMessages((prev) => prev.filter((m) => !(m as any).meta?.thinking));
              break;
          }
        }
      }
    } catch (err: any) {
      setMessages((prev) =>
        prev
          .filter((m) => !(m as any).meta?.thinking)
          .concat([
            {
              id: `local_${Date.now()}_error`,
              role: 'assistant',
              content: `No pude completar la solicitud (${String(err?.message || err)}).`,
            },
          ]),
      );
    } finally {
      setIsSending(false);
      setInput('');
    }
  }, [input, isSending]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto">
        <Messages
          messages={messages as any}
          isLoading={isSending}
          setMessages={setMessages as any}
          // ✅ debe ser Promise<void>
          regenerate={async () => {
            /* no-op por ahora */
          }}
        />
      </div>

      <div className={cn('border-t p-3 flex gap-2')}>
        <input
          className="flex-1 border rounded-md p-2"
          placeholder="Escribe tu mensaje…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
        />
        <Button onClick={handleSend} disabled={isSending || !input.trim()}>
          Enviar
        </Button>
      </div>
    </div>
  );
}
