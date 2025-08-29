'use client';

import type { ChatMessage } from '@/lib/types';
import ItineraryCard from '../components/itinerary-card';

export function PreviewMessage({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';

  const bubble =
    'rounded-2xl border shadow-sm ' +
    (isUser
      ? 'bg-[#d0b781] bg-opacity-70 border-[#b69965]/30 text-black'
      : 'bg-black text-white border-white/10');

  return (
    <div className="w-full mx-auto max-w-3xl px-4 group/message">
      <div className={`w-full ${isUser ? 'justify-end' : 'justify-start'} flex`}>
        <div className={`w-full md:w-[88%] ${bubble} px-4 py-3`}>
          {message.parts.map((part: any, idx: number) => {
            if (part?.type === 'text') {
              return (
                <div key={idx} className="prose prose-invert max-w-none whitespace-pre-wrap break-words">
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
                <pre key={idx} className="text-xs whitespace-pre-wrap">
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
