'use client';
import { useEffect } from 'react';

const THREAD_KEY = 'cv_thread_id';

export default function InitThread() {
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/chat/session', {
          method: 'GET',
          credentials: 'include',
        });
        const data = await r.json();
        const threadId = data?.threadId as string | undefined;
        if (threadId && !cancelled) {
          localStorage.setItem(THREAD_KEY, threadId);
          (window as any).cvThreadId = threadId;
          try { window.parent?.postMessage({ type: 'cv:thread', threadId }, '*'); } catch {}
        }
      } catch {}
    })();
    return () => { cancelled = true; };
  }, []);

  return <div style={{ display: 'none' }} data-cv-init="1" />;
}
