'use client';

import Chat from '@/components/chat';
import { useEffect } from 'react';
import InitThread from './InitThread';

function useVisualViewportVH() {
  useEffect(() => {
    const vv = (window as any).visualViewport;
    const apply = () => {
      const h = vv?.height || window.innerHeight;
      // --vvh es “1vh real” del viewport visible (considera teclado)
      document.documentElement.style.setProperty('--vvh', `${h / 100}`);
    };
    apply();
    vv?.addEventListener('resize', apply);
    vv?.addEventListener('scroll', apply);
    window.addEventListener('resize', apply);
    window.addEventListener('orientationchange', apply);
    return () => {
      vv?.removeEventListener('resize', apply);
      vv?.removeEventListener('scroll', apply);
      window.removeEventListener('resize', apply);
      window.removeEventListener('orientationchange', apply);
    };
  }, []);
}

export default function EmbedPage() {
  useVisualViewportVH();

  // Mantén el “auto-size” del iframe informando al padre la altura visible
  useEffect(() => {
    const send = () => {
      const vv = (window as any).visualViewport;
      const visualHeight = vv?.height || window.innerHeight;
      const layoutHeight =
        document.documentElement.scrollHeight || document.body.scrollHeight || visualHeight;

      const payload: any = {
        type: 'cv-chat:height',
        height: layoutHeight,
        visualHeight, // el padre puede priorizar esto cuando hay teclado
      };
      try {
        parent.postMessage(payload, '*');
      } catch {}
    };

    const ro = new ResizeObserver(send);
    try {
      ro.observe(document.body);
    } catch {}

    const vv = (window as any).visualViewport;
    vv?.addEventListener('resize', send);
    vv?.addEventListener('scroll', send);
    window.addEventListener('load', send);
    window.addEventListener('resize', send);

    const id = setInterval(send, 800);

    return () => {
      try { ro.disconnect(); } catch {}
      vv?.removeEventListener('resize', send);
      vv?.removeEventListener('scroll', send);
      window.removeEventListener('load', send);
      window.removeEventListener('resize', send);
      clearInterval(id);
    };
  }, []);

  return (
    <div
      // Usamos el alto visible real: 100 * --vvh
      style={{
        minHeight: 'calc(var(--vvh, 1vh) * 100)',
        display: 'flex',
        flexDirection: 'column',
        background: 'transparent',
        overscrollBehaviorY: 'contain',
      }}
    >
      <InitThread />
      <Chat />
    </div>
  );
}
