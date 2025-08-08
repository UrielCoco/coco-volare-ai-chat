// app/_embed/page.tsx
'use client';

// ⬇️ Usa UNO de estos imports (deja el que te compile):
import Chat from '@/components/chat';     // si tu chat vive en /components/chat.tsx
// import Chat from '@/app/chat';         // si tu chat vive en /app/chat.tsx

import { useEffect } from 'react';

export default function EmbedPage() {
  // (opcional) auto-resize para el iframe de Shopify
  useEffect(() => {
    const send = () => {
      const h =
        document.documentElement.scrollHeight || document.body.scrollHeight;
      try {
        parent.postMessage({ type: 'cv-chat:height', height: h }, '*');
      } catch {}
    };
    const ro = new ResizeObserver(send);
    ro.observe(document.body);
    window.addEventListener('load', send);
    window.addEventListener('resize', send);
    const id = setInterval(send, 800);
    return () => {
      ro.disconnect();
      window.removeEventListener('load', send);
      window.removeEventListener('resize', send);
      clearInterval(id);
    };
  }, []);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'transparent' }}>
      <Chat />
    </div>
  );
}
