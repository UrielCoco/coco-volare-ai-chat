// components/Chat.tsx
'use client';

import React, { useMemo, useRef, useState } from 'react';
import { streamChat } from '@/lib/streamChat';

type Msg = { id: string; role: 'user' | 'assistant'; text: string };
type Itinerary = any; // ajusta si tienes un tipo estable

export default function Chat() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [itineraries, setItineraries] = useState<Itinerary[]>([]);
  const [typing, setTyping] = useState(false);
  const [threadId, setThreadId] = useState<string | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);

  const addUser = (text: string) =>
    setMessages((m) => [...m, { id: crypto.randomUUID(), role: 'user', text }]);

  const addAssistantDraft = () => {
    const id = crypto.randomUUID();
    setMessages((m) => [...m, { id, role: 'assistant', text: '' }]);
    return id;
  };

  const appendToAssistant = (id: string, chunk: string) =>
    setMessages((m) =>
      m.map((msg) => (msg.id === id ? { ...msg, text: msg.text + chunk } : msg))
    );

  const replaceAssistant = (id: string, text: string) =>
    setMessages((m) => m.map((msg) => (msg.id === id ? { ...msg, text } : msg)));

  const send = async (text: string) => {
    if (!text.trim()) return;
    addUser(text);

    let draftId: string | null = null;
    setTyping(true);

    await streamChat({
      endpoint: `/api/chat${threadId ? `?threadId=${threadId}` : ''}`,
      body: { message: text, threadId },
      handlers: {
        onStartDraft: () => {
          draftId = addAssistantDraft();
        },
        onTextDelta: (chunk) => {
          if (draftId) appendToAssistant(draftId, chunk);
        },
        onFinal: ({ text: cleaned, blocks, extractedJson }) => {
          // Asegura bubble final
          if (!draftId) draftId = addAssistantDraft();
          replaceAssistant(draftId!, cleaned);

          // Captura blocks del backend (si vienen)
          const fromBlocks = (blocks || [])
            .filter((b) => b && typeof b === 'object' && 'json' in b)
            .map((b: any) => b.json);

          const toAdd: any[] = [];
          if (fromBlocks.length) toAdd.push(...fromBlocks);
          if (extractedJson) toAdd.push(extractedJson);

          if (toAdd.length) {
            setItineraries((arr) => [...arr, ...toAdd]);
          }
        },
        onError: (err) => {
          console.error('stream error', err);
          if (!draftId) draftId = addAssistantDraft();
          replaceAssistant(
            draftId!,
            'Uy, hubo un problema procesando la respuesta. ¿Probamos de nuevo?'
          );
        },
        onDone: () => setTyping(false),
      },
    });
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const val = inputRef.current?.value ?? '';
    inputRef.current!.value = '';
    send(val);
  };

  const showThread = useMemo(
    () =>
      messages.map((m) => (
        <div
          key={m.id}
          className={`mb-2 max-w-[85%] rounded-2xl px-3 py-2 ${
            m.role === 'user'
              ? 'self-end bg-amber-500/20 text-amber-100'
              : 'self-start bg-neutral-800 text-neutral-100'
          }`}
        >
          {m.text}
        </div>
      )),
    [messages]
  );

  return (
    <div className="flex h-dvh w-full flex-col items-stretch bg-black/95 p-4">
      <div className="mx-auto w-full max-w-2xl flex-1 overflow-y-auto rounded-2xl bg-black/40 p-4">
        <div className="flex flex-col">{showThread}</div>

        {/* Render de itinerarios extraídos del JSON (no mostramos el JSON crudo) */}
        {itineraries.map((it, i) => (
          <ItineraryCard key={i} data={it} />
        ))}

        {typing && <TypingDots className="mt-2" />}
      </div>

      <form onSubmit={onSubmit} className="mx-auto mt-3 flex w-full max-w-2xl gap-2">
        <input
          ref={inputRef}
          className="flex-1 rounded-full bg-neutral-900 px-4 py-3 text-neutral-100 outline-none placeholder:text-neutral-500"
          placeholder="Escribe tu mensaje…"
        />
        <button
          type="submit"
          className="rounded-full bg-amber-500 px-5 py-3 font-medium text-black hover:bg-amber-400"
        >
          ➤
        </button>
      </form>
    </div>
  );
}

/** Indicador de “pensando…” independiente del bubble */
function TypingDots({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center gap-1 text-neutral-400 ${className}`}>
      <Dot /> <Dot delay="150ms" /> <Dot delay="300ms" />
    </div>
  );
}

function Dot({ delay = '0ms' }: { delay?: string }) {
  return (
    <span
      className="inline-block h-2 w-2 animate-bounce rounded-full bg-neutral-600"
      style={{ animationDelay: delay }}
    />
  );
}

/** Vista simple para itinerarios; adapta a tu estructura si es distinta */
function ItineraryCard({ data }: { data: any }) {
  // Intentamos detectar estructura común: { days: [{ title, description, ... }] }
  const days: any[] =
    Array.isArray(data?.days) ? data.days : Array.isArray(data) ? data : [];

  return (
    <div className="mt-3 rounded-2xl border border-neutral-800 bg-neutral-900 p-4 text-neutral-100">
      <div className="mb-2 text-sm uppercase tracking-wide text-neutral-400">
        Itinerario
      </div>

      {days.length ? (
        <ol className="space-y-2">
          {days.map((d: any, idx: number) => (
            <li key={idx} className="rounded-xl bg-black/30 p-3">
              <div className="font-semibold">Día {idx + 1}{d?.title ? ` · ${d.title}` : ''}</div>
              {d?.description && (
                <div className="text-neutral-300">{d.description}</div>
              )}
              {Array.isArray(d?.activities) && d.activities.length > 0 && (
                <ul className="mt-1 list-disc pl-5 text-neutral-300">
                  {d.activities.map((a: any, i: number) => (
                    <li key={i}>
                      {a.time ? `[${a.time}] ` : ''}
                      {a.name || a.title || a.description || JSON.stringify(a)}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      ) : (
        <pre className="whitespace-pre-wrap break-words text-neutral-300">
          {/* Si la estructura es otra, mostramos un resumen amigable */}
          {summarizeUnknown(data)}
        </pre>
      )}
    </div>
  );
}

function summarizeUnknown(obj: any) {
  try {
    // Muestra solo los 800 primeros caracteres para evitar “paredes de texto”
    const s = JSON.stringify(obj, null, 2);
    return s.length > 800 ? s.slice(0, 800) + '…' : s;
  } catch {
    return String(obj);
  }
}
