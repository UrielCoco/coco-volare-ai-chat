'use client';

import type { ChatMessage } from '@/lib/types';
import ItineraryCard from './itinerary-card';

export function PreviewMessage({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';

  const bubbleWidth = 'inline-block max-w-[92%] xl:max-w-[980px]';
  const isOnlyItinerary =
    Array.isArray(message.parts) &&
    message.parts.length === 1 &&
    message.parts[0]?.type === 'itinerary';

  const userSkin =
    'bg-[#d8c69a] text-black shadow-[0_14px_32px_-14px_rgba(0,0,0,0.55)]';
  const assistantSkin =
    'bg-black text-white shadow-[0_14px_32px_-14px_rgba(0,0,0,0.6)]';

  const bubbleSkin = isOnlyItinerary
    ? 'bg-transparent shadow-none px-4 py-0'
    : (isUser ? `${userSkin} px-4 py-3` : `${assistantSkin} px-4 py-3`);

  const bubbleBase = `${bubbleWidth} rounded-[18px]`;
  const row = 'w-full mx-auto max-w-4xl px-4';
  const rowInner = isUser ? 'w-full flex justify-end' : 'w-full flex justify-start';

  return (
    <div className={row}>
      <div className={rowInner}>
        <div className={`${bubbleBase} ${bubbleSkin}`}>
          {message.parts.map((part: any, idx: number) => {
            // texto normal
            if (part?.type === 'text') {
              // detectar itinerario inline
              if (part.text.includes('```cv:itinerary')) {
                try {
                  const jsonStr = part.text.split('```cv:itinerary')[1].split('```')[0].trim();
                  const itinerary = JSON.parse(jsonStr);
                  return (
                    <div key={idx} className="my-2 mb-8">
                      <ItineraryCard data={itinerary} />
                    </div>
                  );
                } catch (err) {
                  console.error('Itinerary parse failed', err);
                  return (
                    <div key={idx} className="text-yellow-500">⚠️ Itinerary JSON inválido.</div>
                  );
                }
              }
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
                <div key={idx} className="my-2 mb-8">
                  <ItineraryCard data={part.itinerary} />
                </div>
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
