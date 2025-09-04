// app/embed/page.tsx
'use client';

import Chat from '@/components/chat';
import { useEffect, useRef } from 'react';
import InitThread from './InitThread';

export default function EmbedPage() {
  const baselineRef = useRef<number>(0);         // altura “normal” (sin teclado)
  const keyboardOpenRef = useRef<boolean>(false);

  useEffect(() => {
    const docEl = document.documentElement;
    const body = document.body;

    // Altura base al montar (sin teclado)
    baselineRef.current = Math.max(window.innerHeight, docEl.clientHeight, body.clientHeight);

    const post = (h: number) => {
      try {
        parent.postMessage({ type: 'cv-chat:height', height: h }, '*');
      } catch {}
    };

    const computeAndPostHeight = () => {
      const raw = Math.max(docEl.scrollHeight, body.scrollHeight);
      // Mientras el teclado esté abierto, no reduzcas por debajo de la línea base
      const h = keyboardOpenRef.current ? Math.max(raw, baselineRef.current) : raw;
      post(h);
    };

    const onVisualViewport = () => {
      const vv = window.visualViewport;
      if (vv) {
        // Si la altura visible cae ~>120px bajo la base, asumimos teclado abierto.
        const delta = baselineRef.current - vv.height;
        keyboardOpenRef.current = delta > 120;
      }
      computeAndPostHeight();
    };

    // Observa cambios reales del DOM
    let ro: ResizeObserver | null = null;
    try {
      if ('ResizeObserver' in window) {
        ro = new ResizeObserver(() => computeAndPostHeight());
        ro.observe(body);
      }
    } catch {}

    window.addEventListener('resize', computeAndPostHeight);
    window.visualViewport?.addEventListener('resize', onVisualViewport);
    window.visualViewport?.addEventListener('scroll', onVisualViewport);

    // “heartbeat” ligero por si algo se escapa
    const id = setInterval(computeAndPostHeight, 800);

    // Primer envío
    computeAndPostHeight();

    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', computeAndPostHeight);
      window.visualViewport?.removeEventListener('resize', onVisualViewport);
      window.visualViewport?.removeEventListener('scroll', onVisualViewport);
      clearInterval(id);
    };
  }, []);

  return (
    <div
      style={{
        minHeight: '100svh',             // unidades modernas que no “saltan” con barras/teclado
        display: 'flex',
        flexDirection: 'column',
        background: 'transparent',
        overscrollBehaviorY: 'contain',   // evita rebotes que muevan el iframe
      }}
    >
      {/* Inicializa cookie + threadId sin tocar tu UI */}
      <InitThread />
      <Chat />
    </div>
  );
}
