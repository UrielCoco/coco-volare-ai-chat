'use client';

import type { ChatMessage } from '@/lib/types';
import ItineraryCard from './itinerary-card';

export function PreviewMessage({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';

  // Cliente: aire lateral; Asistente: más ancho para la tarjeta
  const bubbleWidth = isUser
    ? 'inline-block max-w-[88%] md:max-w-[820px]'
    : 'inline-block max-w-[96%] md:max-w-[980px]';

  const bubbleSkin = isUser
    ? 'bg-[#d8c69a] border-[#b69965]/40 text-black'
    : 'bg-black text-white border-white/10';

  const bubble = `${bubbleWidth} rounded-2xl border shadow-sm px-4 py-3 ${bubbleSkin}`;

  const row = 'w-full mx-auto max-w-3xl px-4';
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
                  {/* La tarjeta ocupa el 100% del ancho de la burbuja */}
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
