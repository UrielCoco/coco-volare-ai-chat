// app/(chat)/page.tsx
'use client';

import dynamic from 'next/dynamic';

const Chat = dynamic(() => import('@/components/chat'), {
  ssr: false,
  loading: () => <div className="text-center p-6">Cargando chat…</div>,
});

export default function ChatPage() {
  // 👇 Ya no le pasamos id/initial* props; el componente Chat no los necesita
  return <Chat />;
}
