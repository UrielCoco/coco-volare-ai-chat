'use client';

import React, { useMemo, useState } from 'react';

const typeEmoji: Record<string, string> = {
  flight: '✈️',
  transfer: '🚗',
  hotel: '🏨',
  meal: '🍽️',
  activity: '🎟️',
  ticket: '🎫',
};

export default function ItineraryCard({ itinerary }: { itinerary: any }) {
  const days = itinerary?.days ?? [];
  const [i, setI] = useState(0);
  const day = days[i] || days[0];

  const title = useMemo(() => {
    if (itinerary?.tripTitle) return itinerary.tripTitle;
    if (days?.length) return `Días ${days[0].day}–${days[days.length - 1].day}`;
    return 'Itinerario';
  }, [itinerary, days]);

  return (
    <div className="rounded-3xl bg-white text-black shadow-lg ring-1 ring-black/5 overflow-hidden">
      <div className="px-5 py-4 bg-[#faf8f3] border-b border-black/5">
        <div className="text-sm uppercase tracking-wide text-[#6b5a35]">Coco Volare · Itinerario</div>
        <div className="text-xl font-semibold text-[#1a1a1a]">{title}</div>
      </div>

      {/* Tabs de días */}
      <div className="px-4 pt-3 flex gap-2 overflow-x-auto">
        {days.map((d: any, idx: number) => (
          <button
            key={idx}
            onClick={() => setI(idx)}
            className={
              'px-3 py-1.5 rounded-full text-sm whitespace-nowrap border ' +
              (i === idx
                ? 'bg-[#b69965] text-black border-[#b69965]'
                : 'bg-white text-[#333] border-black/10 hover:bg-black/5')
            }
          >
            Día {d.day}{d.date ? ` · ${d.date}` : ''}
          </button>
        ))}
      </div>

      <div className="p-5">
        {day?.title && <div className="text-base font-semibold mb-2">{day.title}</div>}

        <div className="space-y-3">
          {(day?.items ?? []).map((it: any, idx: number) => {
            const icon = typeEmoji[it.type || 'activity'] || '•';
            return (
              <div key={idx} className="flex items-start gap-3 rounded-2xl border border-black/10 p-3 bg-white">
                <div className="text-xl leading-none">{icon}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 text-[15px] font-medium">
                    {it.time && <span className="text-[#6b6b6b]">{it.time}</span>}
                    <span className="text-[#1a1a1a]">{it.title}</span>
                  </div>
                  {(it.location || it.notes) && (
                    <div className="text-sm text-[#555] mt-0.5">
                      {it.location && <span className="mr-2">📍 {it.location}</span>}
                      {it.notes && <span>· {it.notes}</span>}
                    </div>
                  )}
                  {typeof it.price !== 'undefined' && (
                    <div className="text-sm text-[#6b5a35] mt-0.5">Precio: {String(it.price)}</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
