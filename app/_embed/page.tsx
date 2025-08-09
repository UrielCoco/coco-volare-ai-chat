// app/_embed/page.tsx
'use client';

// ⬅️ opción A: si tu Chat está en /components/chat.tsx
import Chat from '../../components/chat';

// ⬅️ opción B: si tu Chat está en /app/chat.tsx (poco común)
/// import Chat from '@/app/chat';

import { useEffect } from 'react';

export default function EmbedPage() {
  // Opcional: auto-resize para Shopify
  useEffect(() => {
    const send = () => {
      const h = document.documentElement.scrollHeight || document.body.scrollHeight;
      try { parent.postMessage({ type: 'cv-chat:height', height: h }, '*'); } catch {}
    };
    const ro = new ResizeObserver(send);
    ro.observe(document.body);
    window.addEventListener('load', send);
    window.addEventListener('resize', send);
    const id = setInterval(send, 800);
    return () => { ro.disconnect(); window.removeEventListener('load', send); window.removeEventListener('resize', send); clearInterval(id); };
  }, []);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'transparent' }}>
      <Chat />
    </div>
  );
}
