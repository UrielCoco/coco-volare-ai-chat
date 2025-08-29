'use client';

import type { ChatMessage } from '@/lib/types';
import ItineraryCard from './itinerary-card';

export function PreviewMessage({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';

  // ⬅️ Ancho: en mobile ocupa el ancho del contenedor (que ya tiene px-4 de margen lateral)
  // y desde md limita a 820px. Así NO se pega al borde en móvil.
  const bubbleWidth = 'w-full md:max-w-[820px]';

  const bubbleSkin = isUser
    ? 'bg-[#d8c69a] border-[#b69965]/40 text-black' // cliente dorado
    : 'bg-black text-white border-white/10';        // asistente negro

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
                    ' text-xs whitespace-pre-wrap'
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
