'use client';

import type { ChatMessage } from '@/lib/types';
import ItineraryCard from './itinerary-card';

export function PreviewMessage({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';

  // Misma anchura para ambos → siempre alineados en escritorio
  const bubbleWidth = 'inline-block max-w-[92%] xl:max-w-[980px]';

  // Sin bordes; sólo sombras y color de marca
  const bubbleSkin = isUser
    ? 'bg-[#d8c69a] text-black shadow-[0_14px_32px_-14px_rgba(0,0,0,0.55)]'
    : 'bg-black text-white shadow-[0_14px_32px_-14px_rgba(0,0,0,0.6)]';

  const bubble = `${bubbleWidth} rounded-3xl px-4 py-3 ${bubbleSkin}`;

  // Contenedor del hilo: igual para ambos roles
  const row = 'w-full mx-auto max-w-4xl px-4';
  const rowInner = isUser ? 'w-full flex justify-end' : 'w-full flex justify-start';

  return (
    <div className={row}>
      <div className={rowInner}>
        <div className={bubble}>
          {message.parts.map((part: any, idx: number) => {
            if (part?.type === 'text') {
              return (
                <div
                  key={idx}
                  className={
                    (isUser
                      ? 'text-[15px] leading-relaxed text-black'
                      : 'text-[15px] leading-relaxed text-white') +
                    ' whitespace-pre-wrap break-words'
                  }
                >
                  {part.text}
                </div>
              );
            }

            if (part?.type === 'itinerary' && part?.itinerary) {
              return (
                <div key={idx} className="my-2">
                  {/* La tarjeta ocupa 100% de la burbuja */}
                  <ItineraryCard itinerary={part.itinerary} />
                </div>
              );
            }

            if (part?.type === 'quote' && part?.quote) {
              return (
                <pre
                  key={idx}
                  className={
                    (isUser ? 'text-black' : 'text-white') +
                    ' text-xs whitespace-pre-wrap break-words'
                  }
                >
                  {JSON.stringify(part.quote, null, 2)}
                </pre>
              );
            }

            return null;
          })}
        </div>
      </div>
    </div>
  );
}

export default PreviewMessage;
