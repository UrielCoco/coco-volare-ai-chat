import dynamic from 'next/dynamic';

const Chat = dynamic(() => import('@/components/chat'), { ssr: false });

export default function EmbedPage() {
  return (
    <main className="min-h-[100dvh] bg-background">
      <Chat />
    </main>
  );
}
