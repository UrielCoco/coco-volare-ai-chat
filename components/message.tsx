'use client';

type Role = 'user' | 'assistant' | 'system' | string;

function ulog(event: string, meta: any = {}) {
  try { console.debug('[CV][ui][bubble]', event, meta); } catch {}
}

export default function Message({ role, text }: { role: Role; text: string }) {
  const isUser = role === 'user';
  const isAssistantLike = !isUser;

  ulog('render', { role, len: (text || '').length });

  return (
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
  );
}
