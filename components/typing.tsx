'use client';

export default function TypingBubble() {
  return (
    <div className="w-full mx-auto max-w-4xl px-4">
      <div className="w-full flex justify-start">
        <div className="inline-block rounded-[18px] bg-black text-white px-4 py-3 shadow-[0_14px_32px_-14px_rgba(0,0,0,0.6)]">
          <span className="inline-flex items-center gap-2">
            <span className="opacity-80">…</span>
            <span className="relative inline-flex w-10 h-4">
              <span className="absolute left-0 top-0 h-2 w-2 rounded-full bg-white/80 animate-bounce [animation-delay:-0.2s]"></span>
              <span className="absolute left-3 top-0 h-2 w-2 rounded-full bg-white/80 animate-bounce [animation-delay:-0.1s]"></span>
              <span className="absolute left-6 top-0 h-2 w-2 rounded-full bg-white/80 animate-bounce"></span>
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}
