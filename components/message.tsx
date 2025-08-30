'use client';

type Role = 'user' | 'assistant' | 'system' | string;

export default function Message({ role, text }: { role: Role; text: string }) {
  const isUser = role === 'user';
  // Cualquier rol que no sea "user" lo tratamos visualmente como assistant (incluye "system", "tool", etc.)
  const isAssistantLike = !isUser;

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
