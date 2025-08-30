'use client';

import React from 'react';

type Itin = {
  lang: 'es' | 'en';
  tripTitle: string;
  clientBooksLongHaulFlights?: boolean;
  disclaimer?: string;
  days: Array<{
    day: number;
    date: string;
    title: string;
    locations: { city: string; country: string }[];
    weather?: {
      tempCmin: number; tempCmax: number;
      tempFmin: number; tempFmax: number;
      humidity: number; icon: string; summary: string;
    };
    hotelOptions?: { name: string; area?: string; style?: string }[];
    timeline: Array<{
      time: string;
      category: 'activity' | 'hotel' | 'transport' | string;
      title: string;
      location?: string;
      duration: string; // ISO8601
      optional?: boolean;
      notes?: string;
      options?: { title: string; notes?: string }[];
      transport?: {
        mode: 'air' | 'land' | 'sea' | string;
        from?: { city: string; country: string };
        to?: { city: string; country: string };
        carrier?: string; code?: string;
        duration?: string; isInternational?: boolean; bookedByClient?: boolean;
      };
    }>;
  }>;
};

export default function ItineraryCard({ data }: { data: Itin }) {
  return (
    <div className="w-full max-w-3xl mx-auto rounded-2xl border border-zinc-800/50 bg-zinc-950 text-zinc-100 shadow-xl overflow-hidden">
      <div className="bg-gradient-to-r from-zinc-900 to-zinc-800 px-6 py-4">
        <h3 className="text-lg font-semibold">{data.tripTitle}</h3>
        {data.disclaimer && (
          <p className="text-xs opacity-70 mt-1">{data.disclaimer}</p>
        )}
      </div>

      <div className="px-6 py-5 space-y-6">
        {data.days.map((d) => (
          <div key={d.day} className="rounded-xl bg-zinc-900/50 p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="font-medium">
                Día {d.day} · {d.title}
                <span className="opacity-60 ml-2 text-sm">{d.date}</span>
              </div>
              {d.weather && (
                <div className="text-sm opacity-80">
                  <span className="mr-2">{d.weather.icon}</span>
                  {d.weather.tempCmin}–{d.weather.tempCmax}°C · {d.weather.summary}
                </div>
              )}
            </div>

            <div className="text-sm opacity-80 mb-2">
              {d.locations.map((l, i) => (
                <span key={i}>
                  {l.city}, {l.country}{i < d.locations.length - 1 ? ' · ' : ''}
                </span>
              ))}
            </div>

            {d.hotelOptions && d.hotelOptions.length > 0 && (
              <div className="mb-3">
                <div className="text-xs uppercase tracking-wide opacity-60 mb-1">
                  Hoteles sugeridos
                </div>
                <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {d.hotelOptions.map((h, i) => (
                    <li key={i} className="rounded-lg bg-zinc-800/60 px-3 py-2 text-sm">
                      <div className="font-medium">{h.name}</div>
                      <div className="opacity-70 text-xs">
                        {[h.area, h.style].filter(Boolean).join(' · ')}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <div className="text-xs uppercase tracking-wide opacity-60 mb-1">
                Agenda del día
              </div>
              <ul className="space-y-2">
                {d.timeline.map((t, i) => (
                  <li key={i} className="rounded-lg bg-zinc-800/40 px-3 py-2">
                    <div className="flex items-center justify-between">
                      <div className="font-medium text-sm">
                        {t.time} · {t.title}
                        {t.optional ? <span className="ml-2 text-xs opacity-70">(opcional)</span> : null}
                      </div>
                      <div className="text-xs opacity-70">{t.duration}</div>
                    </div>
                    {t.location && <div className="text-xs opacity-80">{t.location}</div>}
                    {t.transport && (
                      <div className="text-xs opacity-80 mt-1">
                        Transporte: {t.transport.mode}
                        {t.transport.from && t.transport.to
                          ? ` · ${t.transport.from.city} → ${t.transport.to.city}`
                          : ''}
                        {t.transport.carrier ? ` · ${t.transport.carrier}` : ''}
                        {t.transport.code ? ` (${t.transport.code})` : ''}
                      </div>
                    )}
                    {t.notes && <div className="text-xs opacity-80 mt-1">{t.notes}</div>}
                    {t.options && t.options.length > 0 && (
                      <ul className="mt-1 grid grid-cols-1 sm:grid-cols-2 gap-1">
                        {t.options.map((o, k) => (
                          <li key={k} className="text-xs opacity-80 bg-zinc-800/30 rounded px-2 py-1">
                            {o.title}{o.notes ? ` · ${o.notes}` : ''}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
