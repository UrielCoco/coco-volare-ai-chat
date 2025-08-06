

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import dynamic from 'next/dynamic';

import { DEFAULT_CHAT_MODEL } from '@/lib/ai/models';
import { generateUUID } from '@/lib/utils';
import { DataStreamHandler } from '@/components/data-stream-handler';
import { auth } from '../(auth)/auth';

// Importación dinámica del componente Chat
const Chat = dynamic(() => import('@/components/chat'), {
  ssr: false,
  loading: () => <div className="text-center p-4">Cargando chat...</div>,
});

export default async function Page() {
  const session = await auth();

  if (!session) {
    redirect('/api/auth/guest');
  }

  const id = generateUUID();
  const cookieStore = await cookies();
  const modelIdFromCookie = cookieStore.get('chat-model');

  const initialChatModel = modelIdFromCookie?.value || DEFAULT_CHAT_MODEL;

  return (
    <>
      <Chat
        key={id}
        id={id}
        initialMessages={[]}
        initialChatModel={initialChatModel}
        initialVisibilityType="private"
        isReadonly={false}
        session={session}
        autoResume={false}
      />
      <DataStreamHandler />
    </>
  );
}