'use client';

import type { ChatMessage } from '@/lib/types';
import ItineraryCard from './itinerary-card';

export function PreviewMessage({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';

  // cap del ancho de cada burbuja y estilos de marca
  const bubble =
    'max-w-[min(92vw,820px)] rounded-2xl border shadow-sm px-4 py-3 ' +
    (isUser
      // Cliente = dorado con texto negro
      ? 'bg-[#d8c69a] border-[#b69965]/40 text-black'
      // Asistente = negro con texto blanco
      : 'bg-black text-white border-white/10');

  // contenedor para alinear izq/der
  const row = 'w-full mx-auto max-w-3xl px-4';
  const rowInner = isUser ? 'w-full flex justify-end' : 'w-full flex justify-start';

  return (
    <div className={row}>
      <div className={rowInner}>
        <div className={bubble}>
          {message.parts.map((part: any, idx: number) => {
            // Texto normal
            if (part?.type === 'text') {
              return (
                <div
                  key={idx}
                  // ❌ sin "prose-invert" para el cliente
                  // ✅ tipografía consistente y legible
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

            // Itinerario con UI especial
            if (part?.type === 'itinerary' && part?.itinerary) {
              return (
                <div key={idx} className="my-2">
                  <ItineraryCard itinerary={part.itinerary} />
                </div>
              );
            }

            // (Opcional) Cotización en JSON si todavía no tienes renderer
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
