// app/(chat)/chat.tsx
'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type UiPart = { type: 'text'; text: string };
type UiMessage = { role: 'user' | 'assistant'; parts: UiPart[] };

type StreamEvent =
  | { event: 'meta'; data: { threadId: string } }
  | { event: 'delta'; data: { value: string } }
  | { event: 'final'; data: { text: string } }
  | { event: 'kommo'; data: { ops: any[] } }
  | { event: 'error'; data: { error: string } }
  | { event: 'done'; data: {} }
  | { event: 'diag'; data: any };

// ============ Helpers UI comunes ============
function toUiText(text: string): UiMessage {
  return { role: 'user', parts: [{ type: 'text', text }] };
}
function asText(msg: UiMessage) {
  return (msg?.parts || []).map((p) => (p.type === 'text' ? p.text : '')).join('');
}

// ============ Visible fence sanitizer (UI) ============
// Mantiene SOLO el ÚLTIMO fence idéntico por contenido (hash).
const VISIBLE_FENCE_RX = /```cv:(itinerary|quote)\s*([\s\S]*?)```/g;

function uiQuickHash(raw: string) {
  let h = 0;
  for (let i = 0; i < raw.length; i++) h = (h * 31 + raw.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

/** Devuelve el texto con fences visibles deduplicados (se queda con el ÚLTIMO por hash). */
function sanitizeVisibleBlocksKeepLastUI(text: string) {
  const matches = [...text.matchAll(VISIBLE_FENCE_RX)];
  if (matches.length === 0) {
    return {
      sanitized: text,
      stats: { total: 0, unique: 0, removed: 0, keptTypes: [] as string[], keptHashes: [] as string[] },
    };
  }

  // hash -> último match (por índice)
  const byHash: Record<string, { raw: string; type: string; index: number; hash: string }> = {};
  for (const m of matches) {
    const raw = m[0];
    const type = m[1];
    const index = m.index ?? 0;
    const hash = uiQuickHash(raw);
    byHash[hash] = { raw, type, index, hash }; // pisa siempre: conservamos el ÚLTIMO
  }

  const kept = Object.values(byHash).sort((a, b) => a.index - b.index);
  const sanitized = kept.map((k) => k.raw).join('\n\n');
  const stats = {
    total: matches.length,
    unique: kept.length,
    removed: matches.length - kept.length,
    keptTypes: kept.map((k) => k.type),
    keptHashes: kept.map((k) => k.hash),
  };
  return { sanitized, stats };
}

// ============ SSE parser minimal ============
// Lee un ReadableStream de texto "event: <type>\ndata: <json>\n\n"
async function* sseIterator(res: Response) {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder('utf-8');
  let buf = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    // separar por dobles saltos (fin de evento)
    let idx: number;
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);

      let event = 'message';
      let data = '';
      for (const line of chunk.split('\n')) {
        if (line.startsWith('event: ')) event = line.slice(7).trim();
        else if (line.startsWith('data: ')) data += line.slice(6).trim();
      }

      if (event && data) {
        try {
          const json = JSON.parse(data);
          yield { event, data: json } as StreamEvent;
        } catch {
          // ignora JSON malformado
        }
      }
    }
  }
}

// ============ UI principal ============
export default function Chat() {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState<string>(''); // burbuja "pensando…"
  const [busy, setBusy] = useState(false);

  const threadIdRef = useRef<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  // pintar un mensaje del assistant
  const pushAssistant = useCallback((text: string) => {
    setMessages((prev) => [...prev, { role: 'assistant', parts: [{ type: 'text', text }] }]);
  }, []);

  // pintar un mensaje del usuario
  const pushUser = useCallback((text: string) => {
    setMessages((prev) => [...prev, { role: 'user', parts: [{ type: 'text', text }] }]);
  }, []);

  // limpiar burbuja de pensamiento
  const clearThinking = useCallback(() => setThinking(''), []);

  // ======= POST + SSE =======
  const sendToServer = useCallback(
    async (userText: string) => {
      setBusy(true);
      setThinking('pensando…');

      // construir payload con formato de tu backend
      const payload = {
        message: toUiText(userText),
        threadId: threadIdRef.current,
      };

      controllerRef.current?.abort();
      controllerRef.current = new AbortController();

      const res = await fetch('/app/(chat)/api/chat', {
        // ajusta si tu ruta es distinta, p.e. '/api/chat'
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
        signal: controllerRef.current.signal,
      });

      let finalBuffer = '';

      for await (const evt of sseIterator(res)) {
        switch (evt.event) {
          case 'meta': {
            const tid = (evt as any).data?.threadId as string | undefined;
            if (tid) threadIdRef.current = tid;
            break;
          }
          case 'delta': {
            const v = (evt as any).data?.value ?? '';
            // muestra "pensando…" en tiempo real si quieres ir sumando puntos
            setThinking((old) => (old ? old + '' : 'pensando…'));
            break;
          }
          case 'final': {
            const raw = (evt as any).data?.text ?? '';

            // SANITIZER UI: deduplicar fences idénticos (keep-last)
            const { sanitized, stats } = sanitizeVisibleBlocksKeepLastUI(raw);
            if (stats.removed > 0) {
              // Solo log local (devtools) para diagnóstico
              // eslint-disable-next-line no-console
              console.debug('[UI] sanitized fences:', stats);
            }

            finalBuffer += sanitized;
            break;
          }
          case 'kommo': {
            // Si tienes un integrador aquí, puedes dispararlo (ops = evt.data.ops).
            // Por ahora, no hacemos nada en UI.
            break;
          }
          case 'error': {
            // eslint-disable-next-line no-console
            console.warn('[UI] stream error', (evt as any).data);
            break;
          }
          case 'done': {
            break;
          }
          default:
            // eventos 'diag' u otros
            break;
        }
      }

      // pintar resultado final (sanitizado)
      if (finalBuffer.trim().length > 0) {
        pushAssistant(finalBuffer);
      }

      clearThinking();
      setBusy(false);
    },
    [clearThinking, pushAssistant],
  );

  // enviar
  const onSend = useCallback(async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    pushUser(text);
    await sendToServer(text);
  }, [busy, input, pushUser, sendToServer]);

  // enviar con Enter
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        onSend();
      }
    },
    [onSend],
  );

  // Render básico (ejemplo). Mantén tu propio diseño/estilos.
  return (
    <div className="w-full h-full flex flex-col gap-3 p-4">
      <div className="flex-1 overflow-auto space-y-4">
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'text-right' : 'text-left'}>
            <Bubble role={m.role} text={asText(m)} />
          </div>
        ))}

        {/* Burbuja de "pensando…" */}
        {busy && thinking && (
          <div className="text-left">
            <Bubble role="assistant" text={thinking} muted />
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <input
          className="flex-1 border rounded px-3 py-2 outline-none"
          placeholder="Escribe tu mensaje…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={busy}
        />
        <button
          className="px-4 py-2 rounded bg-black text-white disabled:opacity-50"
          onClick={onSend}
          disabled={busy || !input.trim()}
        >
          ➤
        </button>
      </div>
    </div>
  );
}

// Burbuja muy simple. Reemplaza por tu UI actual de globos / cards.
function Bubble(props: { role: 'user' | 'assistant'; text: string; muted?: boolean }) {
  const { role, text, muted } = props;
  const isUser = role === 'user';

  // Si tu UI parsea y muestra ItineraryCard / QuoteCard desde texto,
  // **no** lo cambiamos aquí: seguirá recibiendo SOLO el último fence idéntico por el sanitizer.
  const cls =
    'inline-block max-w-[80%] rounded-2xl px-3 py-2 ' +
    (isUser ? 'bg-[#d6c08f] text-black' : muted ? 'bg-[#222] text-[#aaa]' : 'bg-[#111] text-white');

  return <div className={cls} style={{ whiteSpace: 'pre-wrap' }}>{text}</div>;
}
