// app/_embed/page.tsx
'use client';

import Chat from '@/components/chat'; // <-- importa TU componente Chat
// si Chat está en otra ruta, ajusta el import, p. ej. '@/components/chat' o './chat'

export default function EmbedPage() {
  return (
    <div style={{ minHeight: '100vh', background: 'transparent' }}>
      <Chat />
    </div>
  );
}
