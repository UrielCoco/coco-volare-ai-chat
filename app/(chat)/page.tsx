// app/(chat)/page.tsx
import dynamic from 'next/dynamic';
import { v4 as uuidv4 } from 'uuid';

const Chat = dynamic(() => import('@/components/chat'), {
  ssr: false,
  loading: () => <div className="text-center p-4">Cargando chat…</div>,
});

export default function ChatPage() {
  const id = uuidv4();
  return (
    <>
      <Chat
        key={id}
        id={id}
        initialMessages={[]}
        initialChatModel="assistant"
        initialVisibilityType="private"
        isReadonly={false}
        autoResume={false}
      />
    </>
  );
}
