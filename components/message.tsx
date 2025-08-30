'use client';
import { useEffect, useState } from 'react';

type Role = 'user' | 'assistant' | 'system' | string;

function FadeIn({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { const t = requestAnimationFrame(() => setMounted(true)); return () => cancelAnimationFrame(t); }, []);
  return (
    <div
      className={[
        'transition-all duration-300 ease-out',
        mounted ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-2 scale-[.98]',
      ].join(' ')}
    >
      {children}
    </div>
  );
}

export default function Message({ role, text }: { role: Role; text: string }) {
  const isUser = role === 'user';
  const isAssistantLike = !isUser;

  return (
    <FadeIn>
      <div className={`w-full flex ${isUser ? 'justify-end' : 'justify-start'}`}>
        <div
          className={
            'max-w-[80%] rounded-2xl px-4 py-3 shadow ' +
            (isAssistantLike ? 'bg-black/80 text-white' : 'bg-[#bba36d] text-black')
          }
          style={{ wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}
        >
          {text || ''}
        </div>
      </div>
    </FadeIn>
  );
}
