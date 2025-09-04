'use client';

import Chat from '@/components/chat';
import { useEffect } from 'react';
import InitThread from './InitThread';

export default function EmbedPage() {
  useEffect(() => {
    const send = () => {
    const vv = (window as any).visualViewport;
    const payload:any = { type: 'cv-chat:height', height: document.documentElement.scrollHeight || document.body.scrollHeight };
    if (vv) payload.visualHeight = vv.height; // útil con teclado abierto
    try { parent.postMessage(payload, '*'); } catch {}
    };
    let ro: ResizeObserver | null = null;
    try {
      if ('ResizeObserver' in window) {
        ro = new ResizeObserver(send);
        ro.observe(document.body);
      }
    } catch {}
    window.addEventListener('load', send);
    window.addEventListener('resize', send);
    const id = setInterval(send, 800);
    return () => { ro?.disconnect(); window.removeEventListener('load', send); window.removeEventListener('resize', send); clearInterval(id); };
  }, []);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'transparent' }}>
      {/* Inicializa cookie + threadId sin tocar tu UI */}
      <InitThread />
      <Chat />
    </div>
  );
}
