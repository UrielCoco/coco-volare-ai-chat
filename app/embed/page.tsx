'use client';

import Chat from '@/components/chat';
import { useEffect } from 'react';

export default function EmbedPage() {
  useEffect(() => {
    const send = () => {
      const h = document.documentElement.scrollHeight || document.body.scrollHeight;
      try { parent.postMessage({ type: 'cv-chat:height', height: h }, '*'); } catch {}
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
      <Chat />
    </div>
  );
}
