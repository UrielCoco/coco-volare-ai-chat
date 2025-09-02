'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ItineraryCard, { Itinerary } from './ItineraryCard';

type Role = 'user' | 'assistant' | 'system';

type UiMsg =
  | { id: string; role: Role; kind: 'text'; text: string; streaming?: boolean; ack?: boolean }
  | { id: string; role: Role; kind: 'itinerary'; data: Itinerary }
  | { id: string; role: Role; kind: 'status'; text: string };

type RunState = {
  runId?: string | null;
  status: 'idle' | 'in_progress' | 'completed' | 'cancelled' | 'failed';
};

function getThreadIdFromCookies(): string | null {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.match(/(?:^|;\s*)cv_thread_id=([^;]+)/);
  return m?.[1] ?? null;
}

function classNames(...c: Array<string | false | null | undefined>) {
  return c.filter(Boolean).join(' ');
}

// Detección simple de fences ```json / ```itinerary en texto streaming
type FenceFSM = {
  mode: 'outside' | 'inFence' | 'afterFence';
  fenceLang: string | null;
  pre: string;           // texto antes del fence (burbuja 1)
  fenceBuffer: string;   // JSON acumulado
  post: string;          // texto después (burbuja 2)
};

function createFenceFSM(): FenceFSM {
  return { mode: 'outside', fenceLang: null, pre: '', fenceBuffer: '', post: '' };
}

export default function Chat() {
  const [threadId, setThreadId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<UiMsg[]>([]);
  const [run, setRun] = useState<RunState>({ status: 'idle', runId: null });
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setThreadId(getThreadIdFromCookies());
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, busy]);

  const pushUser = useCallback((text: string) => {
    const id = `user-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      { id, role: 'user', kind: 'text', text, ack: false },
    ]);
  }, []);

  const upsertAssistantText = useCallback((id: string, patch: Partial<Extract<UiMsg, { kind: 'text' }>>) => {
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === id);
      if (idx === -1) {
        return [...prev, { id, role: 'assistant', kind: 'text', text: '', streaming: true, ...patch } as UiMsg];
      }
      const next = [...prev];
      const cur = next[idx] as Extract<UiMsg, { kind: 'text' }>;
      next[idx] = { ...cur, ...patch };
      return next;
    });
  }, []);

  const addItinerary = useCallback((id: string, data: Itinerary) => {
    setMessages((prev) => [...prev, { id, role: 'assistant', kind: 'itinerary', data }]);
  }, []);

  const submit = useCallback(async () => {
    if (!threadId || !input.trim() || busy) return;
    const text = input.trim();
    setInput('');
    pushUser(text);
    setBusy(true);
    setRun({ status: 'in_progress', runId: null });

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    // consumimos SSE
    const res = await fetch('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ threadId, text }),
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
    }).catch((e) => {
      console.error('[CV][client] fetch POST /api/chat error', e);
      return null;
    });
    if (!res || !res.body) {
      setBusy(false);
      setRun({ status: 'failed', runId: null });
      setMessages((prev) => [...prev, { id: `status-${Date.now()}`, role: 'system', kind: 'status', text: 'Error de red.' }]);
      return;
    }

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    // FSM por message (asumimos 1–N messages por run). Reiniciamos al ver un message.completed
    // Pero mantenemos un "draft" para texto pre-fence y post-fence
    let draftId = `asst-${Date.now()}`;
    let fsm: FenceFSM = createFenceFSM();

    const finishDraftsIfAny = () => {
      // al cerrar el run, aseguramos que el texto final esté “no streaming”
      setMessages((prev) =>
        prev.map((m) =>
          m.kind === 'text' && m.id === draftId ? { ...m, streaming: false } : m
        )
      );
    };

    const parseAndRenderFenceIfClosed = () => {
      // cuando cerremos ``` intentamos parsear JSON
      if (fsm.mode === 'afterFence' && fsm.fenceBuffer.trim()) {
        try {
          const maybe = JSON.parse(fsm.fenceBuffer);
          addItinerary(`itinerary-${Date.now()}`, maybe);
        } catch (e) {
          // si no es JSON válido lo dejamos en texto (se agregará al post)
          fsm.post = (fsm.post || '') + ' ' + '⚠️ No se pudo parsear JSON.';
        }
      }
    };

    const feedTextDelta = (chunk: string) => {
      // 1) alimentar FSM por fences
      let text = chunk;

      // si encontramos apertura de fence
      while (text.length) {
        if (fsm.mode === 'outside') {
          const openIdx = text.indexOf('```');
          if (openIdx === -1) {
            fsm.pre += text;
            text = '';
          } else {
            // agregar lo previo
            fsm.pre += text.slice(0, openIdx);
            text = text.slice(openIdx + 3);
            // leer lenguaje (json, itinerary, etc.)
            const lnBreak = text.indexOf('\n');
            let lang = '';
            if (lnBreak === -1) {
              lang = text;
              text = '';
            } else {
              lang = text.slice(0, lnBreak).trim().toLowerCase();
              text = text.slice(lnBreak + 1);
            }
            fsm.mode = 'inFence';
            fsm.fenceLang = lang || 'json';
          }
        } else if (fsm.mode === 'inFence') {
          const closeIdx = text.indexOf('```');
          if (closeIdx === -1) {
            fsm.fenceBuffer += text;
            text = '';
          } else {
            // cerramos fence
            fsm.fenceBuffer += text.slice(0, closeIdx);
            text = text.slice(closeIdx + 3);
            fsm.mode = 'afterFence';
            // no seteamos post aún, seguimos consumiento
          }
        } else if (fsm.mode === 'afterFence') {
          fsm.post += text;
          text = '';
        }
      }

      // 2) pintar en UI:
      // pre (burbuja 1) — va en draftId
      if (fsm.pre) {
        upsertAssistantText(draftId, { text: fsm.pre, streaming: true });
      }

      // si ya cerramos fence, rendereamos tarjeta una sola vez y movemos a burbuja post
      if (fsm.mode === 'afterFence') {
        parseAndRenderFenceIfClosed();
        // iniciar una nueva burbuja post-fence (mismo draftId pero con texto post)
        if (fsm.post) {
          upsertAssistantText(draftId + '-post', { text: fsm.post, streaming: true });
        }
      }
    };

    const done = () => {
      finishDraftsIfAny();
      setBusy(false);
      setRun((r) => ({ ...r, status: 'completed' }));
    };

    try {
      while (true) {
        const { value, done: rdone } = await reader.read();
        if (rdone) {
          done();
          break;
        }
        buf += dec.decode(value, { stream: true });

        // parse SSE lines
        const lines = buf.split(/\r?\n/);
        buf = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('event:') && !line.startsWith('data:')) continue;

          // Colectamos pares event/data
          // (como las líneas vienen separadas, guardamos en variables locales)
        }
        // Re-scan properly by chunking on double newlines
        const events = (buf + dec.decode(new Uint8Array(), { stream: true })).split('\n\n');
        // No consumimos buf aquí porque arriba ya lo gestionamos mediante 'lines'
        // Para robustez hacemos un parsing alterno:
        const blocks = (buf + '').split('\n\n'); // liviano; tolerante
        for (const blk of blocks) {
          const evMatch = blk.match(/^event:\s*(.+)$/m);
          const dataMatch = blk.match(/^data:\s*(.+)$/m);
          if (!evMatch || !dataMatch) continue;

          const ev = evMatch[1].trim();
          let data: any = {};
          try { data = JSON.parse(dataMatch[1]); } catch {}
          // console.log('[CV][client] SSE', ev, data?.type || '');

          if (ev === 'ack') {
            // marcar último user como ack
            setMessages((prev) => {
              const lastUserIdx = [...prev].reverse().findIndex((m) => m.role === 'user' && m.kind === 'text' && m.ack === false);
              if (lastUserIdx === -1) return prev;
              const idx = prev.length - 1 - lastUserIdx;
              const next = [...prev];
              next[idx] = { ...(next[idx] as any), ack: true };
              return next;
            });
          }

          if (data?.type === 'thread.run.created' || ev === 'thread.run.created') {
            setRun({ status: 'in_progress', runId: data?.data?.id || data?.id || null });
          }

          if (ev === 'text.delta') {
            // delta puro de texto = actualizar FSM
            const value = data?.value || '';
            if (value) feedTextDelta(value);
          }

          // Cuando llega un "message.completed.text" cerramos streaming de ambas burbujas
          if (ev === 'message.completed.text') {
            setMessages((prev) =>
              prev.map((m) =>
                m.kind === 'text' && (m.id === draftId || m.id === draftId + '-post')
                  ? { ...m, streaming: false }
                  : m
              )
            );
            // reiniciamos para el posible siguiente message del mismo run
            draftId = `asst-${Date.now()}`;
            fsm = createFenceFSM();
          }

          if (data?.type === 'thread.run.completed' || ev === 'thread.run.completed') {
            done();
          }
          if (data?.type === 'thread.run.failed' || ev === 'thread.run.failed') {
            setBusy(false);
            setRun({ status: 'failed', runId: data?.data?.id || null });
          }
          if (data?.type === 'thread.run.cancelled' || ev === 'thread.run.cancelled') {
            setBusy(false);
            setRun({ status: 'cancelled', runId: data?.data?.id || null });
          }
        }
      }
    } catch (e) {
      console.error('[CV][client] SSE reader error', e);
      setBusy(false);
      setRun({ status: 'failed', runId: null });
    }
  }, [threadId, input, busy, pushUser, upsertAssistantText, addItinerary]);

  const cancelRun = useCallback(async () => {
    if (!run.runId || !threadId) return;
    try {
      abortRef.current?.abort();
      await fetch('/api/chat', {
        method: 'DELETE',
        body: JSON.stringify({ threadId, runId: run.runId }),
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (e) {
      console.error('[CV][client] cancel error', e);
    } finally {
      setBusy(false);
      setRun((r) => ({ ...r, status: 'cancelled' }));
      setMessages((prev) => [...prev, { id: `status-${Date.now()}`, role: 'system', kind: 'status', text: 'Run cancelado por el usuario.' }]);
    }
  }, [run.runId, threadId]);

  return (
    <div className="mx-auto max-w-3xl w-full min-h-[80vh] flex flex-col px-4 py-6">
      {/* Histórico */}
      <div className="flex-1 space-y-4 overflow-y-auto">
        {messages.map((m) => {
          if (m.kind === 'status') {
            return (
              <div key={m.id} className="text-center text-xs text-gray-500">{m.text}</div>
            );
          }
          if (m.kind === 'itinerary') {
            return (
              <div key={m.id} className="max-w-2xl">
                <ItineraryCard itinerary={m.data} />
              </div>
            );
          }
          // kind === 'text'
          const mine = m.role === 'user';
          return (
            <div key={m.id} className={classNames('flex', mine ? 'justify-end' : 'justify-start')}>
              <div
                className={classNames(
                  'rounded-2xl px-4 py-2 max-w-[85%] whitespace-pre-wrap leading-relaxed',
                  mine ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-900'
                )}
              >
                {m.text}
                {m.streaming && !mine ? <span className="animate-pulse ml-1">▍</span> : null}
                {mine && (
                  <div className="mt-1 text-[10px] opacity-70">
                    {m.ack ? '✓ enviado' : 'enviando…'}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {/* Burbuja “pensando” mientras corre el run y aún no hay texto */}
        {run.status === 'in_progress' && !messages.some((x) => x.kind === 'text' && x.role === 'assistant' && x.streaming) && (
          <div className="flex justify-start">
            <div className="rounded-2xl px-4 py-2 bg-gray-100 text-gray-500">
              pensando…
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input + bloquear si busy */}
      <form
        onSubmit={(e) => { e.preventDefault(); submit(); }}
        className="mt-4 flex items-center gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Escribe tu mensaje…"
          className="flex-1 rounded-xl border px-3 py-2 focus:outline-none"
          disabled={busy}
        />
        {!busy ? (
          <button
            type="submit"
            className="rounded-xl bg-blue-600 text-white px-4 py-2 disabled:opacity-50"
            disabled={!threadId || !input.trim()}
          >
            Enviar
          </button>
        ) : (
          <button
            type="button"
            onClick={cancelRun}
            className="rounded-xl bg-red-600 text-white px-4 py-2"
          >
            Cancelar
          </button>
        )}
      </form>

      {/* Hint de diagnóstico */}
      <div className="mt-2 text-[11px] text-gray-500">
        Mostrando todos los mensajes del assistant (se deduplica por id). Texto se muestra por deltas;
        bloques <code>```json</code>/<code>```itinerary</code> se convierten en tarjeta al cerrar el fence.
      </div>
    </div>
  );
}
