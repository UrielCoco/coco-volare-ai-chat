'use client';

import { useEffect, useRef, useState } from 'react';
import TypingBubble from './typing';
import PreviewMessage from './message';
import type { ChatMessage } from '@/lib/types';

const THREAD_KEY = 'cv_thread_id';

function stripKommoBlock(text: string) {
  return text.replace(/```cv:kommo[\s\S]*?```/gi, '').trim();
}
function parseItineraryBlocks(text: string) {
  const blocks: any[] = [];
  const rx = /```cv:itinerary\s*([\s\S]*?)```/gi;
  let lastIndex = 0;
  let m: RegExpExecArray | null;

  while ((m = rx.exec(text))) {
    const before = text.substring(lastIndex, m.index);
    if (before.trim()) blocks.push({ type: 'text', text: before.trim() });

    try {
      const json = JSON.parse(m[1]);
      blocks.push({ type: 'itinerary', itinerary: json });
    } catch {
      blocks.push({ type: 'text', text: '⚠️ Itinerary JSON inválido.' });
    }
    lastIndex = rx.lastIndex;
  }
  const tail = text.substring(lastIndex).trim();
  if (tail) blocks.push({ type: 'text', text: tail });
  if (blocks.length === 0) blocks.push({ type: 'text', text });
  return blocks;
}

export default function Chat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isThinking, setIsThinking] = useState(false);

  // —— follow-up watcher ——
  const followUpActive = useRef(false);
  const followUpTimer = useRef<NodeJS.Timeout | null>(null);
  const followUpUntil = useRef<number>(0);
  const lastAssistantFingerprint = useRef<string>('');

  // pending placeholder
  const pendingTimer = useRef<NodeJS.Timeout | null>(null);
  const pendingMsgId = useRef<string | null>(null);

  const threadIdRef = useRef<string | null>(null);
  useEffect(() => {
    threadIdRef.current = window.sessionStorage.getItem(THREAD_KEY) || null;
  }, []);

  const addMessage = (msg: ChatMessage) => setMessages(prev => [...prev, msg]);

  const replacePendingWith = (real: ChatMessage) => {
    setMessages(prev => {
      if (!pendingMsgId.current) return [...prev, real];
      const id = pendingMsgId.current;
      return prev.map(m => (m.id === id ? real : m));
    });
    pendingMsgId.current = null;
  };

  const addPendingAssistant = (text = 'Estoy armando tu itinerario… un momento por favor.') => {
    const id = `pending_${Date.now()}`;
    pendingMsgId.current = id;
    const fake: ChatMessage = {
      id,
      role: 'assistant',
      parts: [{ type: 'text', text }],
      createdAt: new Date().toISOString(),
    } as any;
    setMessages(prev => [...prev, fake]);
  };

  // —— inicia watcher de follow-ups durante ~20s con polls de 2s ——
  const startFollowUpWatcher = () => {
    if (!threadIdRef.current || followUpActive.current) return;

    followUpActive.current = true;
    followUpUntil.current = Date.now() + 20000; // 20s

    const tick = async () => {
      if (!followUpActive.current) return;
      if (Date.now() > followUpUntil.current) {
        followUpActive.current = false;
        setIsThinking(false);
        return;
      }

      try {
        // mostramos typing mientras “escuchamos”
        setIsThinking(true);

        const res = await fetch('/api/chat/pull', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            threadId: threadIdRef.current,
            knownFingerprint: lastAssistantFingerprint.current,
          }),
        });

        const data = await res.json();
        if (data?.hasUpdate && typeof data.reply === 'string') {
          const clean = stripKommoBlock(data.reply);
          const parts = parseItineraryBlocks(clean);

          // fingerprint nuevo (para próximas rondas)
          lastAssistantFingerprint.current = String(data?.fingerprint || clean.slice(0, 512));

          // pintamos como NUEVO mensaje del assistant
          addMessage({
            id: `a2_${Date.now()}`,
            role: 'assistant',
            parts,
            createdAt: new Date().toISOString(),
          } as any);

          // y como ya llegó algo, seguimos un poco más por si hubiera otro,
          // pero quitamos typing para que no se vea infinito
          setIsThinking(false);
        }
      } catch {
        // ignoramos errores de poll
      } finally {
        if (!followUpActive.current) return;
        followUpTimer.current = setTimeout(tick, 2000); // cada 2s
      }
    };

    // arranca
    tick();
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const text = input.trim();
    if (!text) return;

    // mensaje del usuario
    addMessage({
      id: `u_${Date.now()}`,
      role: 'user',
      parts: [{ type: 'text', text }],
      createdAt: new Date().toISOString(),
    } as any);

    setInput('');
    setIsThinking(true);

    // si en 4s no llega nada, pintamos placeholder
    if (pendingTimer.current) clearTimeout(pendingTimer.current);
    pendingTimer.current = setTimeout(() => {
      if (isThinking) addPendingAssistant();
    }, 4000);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: { role: 'user', parts: [{ text }] },
          threadId: threadIdRef.current,
        }),
      });

      const data = await res.json();
      const raw = String(data?.reply || '');

      // guarda threadId
      if (data?.threadId) {
        threadIdRef.current = data.threadId;
        window.sessionStorage.setItem(THREAD_KEY, data.threadId);
      }

      // limpia placeholder/typing
      if (pendingTimer.current) { clearTimeout(pendingTimer.current); pendingTimer.current = null; }
      setIsThinking(false);

      // primera respuesta
      const replyClean = stripKommoBlock(raw);
      const parts = parseItineraryBlocks(replyClean);

      // huella para pull posterior
      lastAssistantFingerprint.current = replyClean.slice(0, 512);

      const realAssistantMsg: ChatMessage = {
        id: `a_${Date.now()}`,
        role: 'assistant',
        parts,
        createdAt: new Date().toISOString(),
      } as any;

      if (pendingMsgId.current) {
        replacePendingWith(realAssistantMsg);
      } else {
        addMessage(realAssistantMsg);
      }

      // 🔁 activa watcher (por si el assistant manda otro mensaje más)
      startFollowUpWatcher();

    } catch (err) {
      if (pendingTimer.current) { clearTimeout(pendingTimer.current); pendingTimer.current = null; }
      setIsThinking(false);

      const fallback: ChatMessage = {
        id: `a_${Date.now()}`,
        role: 'assistant',
        parts: [{ type: 'text', text: 'Ocurrió un error, lamentamos los inconvenientes.' }],
        createdAt: new Date().toISOString(),
      } as any;

      if (pendingMsgId.current) {
        replacePendingWith(fallback);
      } else {
        addMessage(fallback);
      }
      console.error('[CV][client] /api/chat error', err);
    }
  };

  // limpia timers al desmontar
  useEffect(() => {
    return () => {
      if (followUpTimer.current) clearTimeout(followUpTimer.current);
      if (pendingTimer.current) clearTimeout(pendingTimer.current);
    };
  }, []);

  return (
    <div className="w-full">
      <div className="space-y-4 pt-4">
        {messages.map(m => (
          <PreviewMessage key={m.id} message={m} />
        ))}
        {isThinking && <TypingBubble />}
      </div>

      <form onSubmit={handleSubmit} className="sticky bottom-0 w-full bg-transparent">
        <div className="mx-auto max-w-4xl px-4 py-4 flex items-center gap-2">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Escribe tu mensaje…"
            className="flex-1 rounded-full bg-[#0d0d0d] text-white px-5 py-3 outline-none"
          />
        <button
            type="submit"
            className="rounded-full bg-[#bba36d] text-black px-4 py-3 font-medium hover:opacity-90 transition"
          >
            ➤
          </button>
        </div>
      </form>
    </div>
  );
}
