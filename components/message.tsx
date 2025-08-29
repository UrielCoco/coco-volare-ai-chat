'use client';

import type { ChatMessage } from '@/lib/types';
import ItineraryCard from './itinerary-card';

export function PreviewMessage({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';

  // Misma anchura para ambos → siempre alineados en desktop
  const bubbleWidth = 'inline-block max-w-[92%] xl:max-w-[980px]';

  // ¿Es un mensaje que SOLO contiene un itinerario?
  const isOnlyItinerary =
    Array.isArray(message.parts) &&
    message.parts.length === 1 &&
    message.parts[0]?.type === 'itinerary';

  // Piel de la burbuja: sin bordes, sólo sombras
  const userSkin =
    'bg-[#d8c69a] text-black shadow-[0_14px_32px_-14px_rgba(0,0,0,0.55)]';
  const assistantSkin =
    'bg-black text-white shadow-[0_14px_32px_-14px_rgba(0,0,0,0.6)]';

  // Para itinerarios, dejamos la burbuja “transparente” para que la tarjeta defina su propio look
  const bubbleSkin = isOnlyItinerary ? 'bg-transparent shadow-none p-0' :
    (isUser ? `${userSkin} px-4 py-3` : `${assistantSkin} px-4 py-3`);

  // Borde/forma general (menos redondeado)
  const bubbleBase = `${bubbleWidth} rounded-[18px]`;

  // Contenedor del hilo con mismos paddings → alinea izquierda/derecha
  const row = 'w-full mx-auto max-w-4xl px-4';
  const rowInner = isUser ? 'w-full flex justify-end' : 'w-full flex justify-start';

  return (
    <div className={row}>
      <div className={rowInner}>
        <div className={`${bubbleBase} ${bubbleSkin}`}>
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
                <div key={idx} className={isOnlyItinerary ? '' : 'my-2'}>
                  {/* La tarjeta ocupa 100% de la burbuja y queda alineada con ella */}
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
