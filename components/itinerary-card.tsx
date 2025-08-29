'use client';

import React, { useMemo, useState } from 'react';

/**
 * Esquema esperado (nuevo y flexible):
 * {
 *   tripTitle?: string,
 *   days: [{
 *     day: number,
 *     date?: "YYYY-MM-DD",
 *     title?: string,
 *     locations?: [{ city?: string, country?: string }, ...], // >= 1, soporta múltiples (traslados en el día)
 *     timeline?: [{
 *       time: "HH:MM",                          // 24h
 *       category: "transport"|"meal"|"activity"|"hotel"|"ticket"|"reservation",
 *       title: string,
 *       location?: string,
 *       duration?: string,                      // "PT2H10M" | "2h 10m" | "150m"
 *       price?: string|number,
 *       transport?: {
 *         mode: "air"|"land"|"sea",            // aéreo, terrestre, marítimo
 *         from?: { city?: string, country?: string },
 *         to?:   { city?: string, country?: string },
 *         carrier?: string,                     // aerolínea/operador
 *         code?: string,                        // vuelo/tren, etc.
 *         duration?: string                     // opcional si ya pusiste duration arriba
 *       },
 *       notes?: string
 *     }],
 *     // retrocompat: algunos bots siguen mandando "items" (se mapea a timeline)
 *     items?: [{
 *       time?: string, type?: string, title: string, location?: string,
 *       notes?: string, price?: string|number
 *     }]
 *   }]
 * }
 */

const emojiByCategory: Record<string, string> = {
  activity: '🎟️',
  meal: '🍽️',
  hotel: '🏨',
  ticket: '🎫',
  reservation: '📑',
};

const emojiByMode: Record<string, string> = {
  air: '✈️',
  land: '🚗',
  sea: '⛴️',
};

function fmtCityCountry(x?: { city?: string; country?: string }) {
  if (!x) return '';
  const a = [x.city, x.country].filter(Boolean).join(', ');
  return a || '';
}

function formatDuration(s?: string) {
  if (!s) return '';
  // ISO 8601 "PT2H30M"
  const iso = /^P(T(?:(\d+)H)?(?:(\d+)M)?)$/i;
  const m = s.match(iso);
  if (m) {
    const h = m[2] ? Number(m[2]) : 0;
    const min = m[3] ? Number(m[3]) : 0;
    if (h && min) return `${h}h ${min}m`;
    if (h) return `${h}h`;
    if (min) return `${min}m`;
  }
  // "2h30m" / "2h 30m"
  const hmin = /(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?/i.exec(s);
  if (hmin && (hmin[1] || hmin[2])) {
    const h = hmin[1] ? Number(hmin[1]) : 0;
    const min = hmin[2] ? Number(hmin[2]) : 0;
    if (h && min) return `${h}h ${min}m`;
    if (h) return `${h}h`;
    if (min) return `${min}m`;
  }
  // "150m"
  const onlyM = /^(\d+)\s*m$/i.exec(s);
  if (onlyM) return `${onlyM[1]}m`;
  return s; // fallback
}

function toTimeline(day: any): any[] {
  // Si ya viene timeline, úsalo. Si no, convierte items -> timeline
  let tl: any[] = Array.isArray(day?.timeline) ? day.timeline : [];
  if ((!tl || tl.length === 0) && Array.isArray(day?.items)) {
    tl = day.items.map((it: any) => ({
      time: it.time || '--:--',
      category:
        it.type === 'transfer' ? 'transport' :
        it.type === 'meal' ? 'meal' :
        it.type === 'hotel' ? 'hotel' :
        it.type === 'ticket' ? 'ticket' :
        it.type === 'reservation' ? 'reservation' :
        'activity',
      title: it.title,
      location: it.location,
      notes: it.notes,
      price: it.price,
    }));
  }
  // Orden por hora/minuto
  const toNum = (t: string) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(t || '');
    if (!m) return 99_99;
    return Number(m[1]) * 60 + Number(m[2]);
    };
  return [...tl].sort((a, b) => toNum(a.time) - toNum(b.time));
}

export default function ItineraryCard({ itinerary }: { itinerary: any }) {
  const days = itinerary?.days ?? [];
  const [i, setI] = useState(0);
  const d = days[i] || days[0];

  const title = useMemo(() => {
    if (itinerary?.tripTitle) return itinerary.tripTitle;
    if (days?.length) return `Días ${days[0].day}–${days[days.length - 1].day}`;
    return 'Itinerario';
  }, [itinerary, days]);

  const locations = Array.isArray(d?.locations) && d.locations.length > 0
    ? d.locations
    : [{ city: d?.location || '', country: '' }].filter((x) => x.city);

  const timeline = toTimeline(d);

  // Helpers para encabezados por hora
  const hourOf = (t?: string) => {
    const m = /^(\d{1,2}):/.exec(t || '');
    return m ? m[1].padStart(2, '0') : '--';
  };

  return (
    <div className="rounded-3xl bg-white text-black shadow-lg ring-1 ring-black/5 overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 bg-[#faf8f3] border-b border-black/5">
        <div className="text-sm uppercase tracking-wide text-[#6b5a35]">COCO VOLARE · ITINERARIO</div>
        <div className="text-xl font-semibold text-[#1a1a1a]">{title}</div>
      </div>

      {/* Tabs de días */}
      <div className="px-4 pt-3 flex gap-2 overflow-x-auto">
        {days.map((dayObj: any, idx: number) => (
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
            Día {dayObj.day}{dayObj.date ? ` · ${dayObj.date}` : ''}
          </button>
        ))}
      </div>

      {/* Chips de localización del día (país/ciudad). Soporta múltiples */}
      <div className="px-5 pb-1 flex flex-wrap gap-2">
        {locations?.length > 0 ? locations.map((loc: any, idx: number) => (
          <span
            key={idx}
            className="px-2.5 py-1 rounded-full text-xs bg-black/5 border border-black/10 text-[#1a1a1a]"
            title={`${loc.city || ''}${loc.country ? ', ' + loc.country : ''}`}
          >
            {loc.city ? loc.city : ''}{loc.city && loc.country ? ', ' : ''}{loc.country || ''}
          </span>
        )) : (
          <span className="text-xs text-[#6b6b6b]">Ubicación por definir</span>
        )}
      </div>

      {/* Contenido del día */}
      <div className="p-5">
        {d?.title && <div className="text-base font-semibold mb-2">{d.title}</div>}

        <div className="space-y-3">
          {(() => {
            const rows: React.ReactNode[] = [];
            let currentHour = '';

            timeline.forEach((it: any, idx: number) => {
              const hr = hourOf(it.time);
              if (hr !== currentHour) {
                currentHour = hr;
                rows.push(
                  <div key={`h-${idx}`} className="text-[11px] font-semibold uppercase tracking-wide text-[#6b5a35]/70 mt-3">
                    {hr !== '--' ? `${hr}:00` : 'Sin hora'}
                  </div>
                );
              }

              const isTransport = it.category === 'transport';
              const mode = it?.transport?.mode;
              const icon = isTransport
                ? (emojiByMode[mode || 'land'] || '🚗')
                : (emojiByCategory[it.category] || '•');

              const tDur = formatDuration(it?.transport?.duration || it?.duration);
              const line2 = isTransport
                ? [
                    fmtCityCountry(it?.transport?.from),
                    '→',
                    fmtCityCountry(it?.transport?.to),
                  ].filter(Boolean).join(' ')
                : (it.location || '');

              const tags: string[] = [];
              if (isTransport) {
                if (mode === 'air') tags.push('Aéreo');
                else if (mode === 'sea') tags.push('Marítimo');
                else tags.push('Terrestre');
                if (tDur) tags.push(`Duración ${tDur}`);
                if (it?.transport?.code) tags.push(it.transport.code);
                if (it?.transport?.carrier) tags.push(it.transport.carrier);
              } else {
                // label por categoría
                if (it.category === 'meal') tags.push('Alimento');
                else if (it.category === 'activity') tags.push('Atracción');
                else if (it.category === 'reservation') tags.push('Reservación');
                else if (it.category === 'hotel') tags.push('Hotel');
                else if (it.category === 'ticket') tags.push('Ticket');
                if (tDur) tags.push(`Duración ${tDur}`);
              }

              rows.push(
                <div key={idx} className="flex items-start gap-3 rounded-2xl border border-black/10 p-3 bg-white">
                  <div className="text-xl leading-none">{icon}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 text-[15px] font-medium">
                      <span className="text-[#6b6b6b]">{it.time || '--:--'}</span>
                      <span className="text-[#1a1a1a]">{it.title}</span>
                    </div>

                    {(line2 || it.notes) && (
                      <div className="text-sm text-[#555] mt-0.5">
                        {line2 && <span className="mr-2">📍 {line2}</span>}
                        {it.notes && <span>· {it.notes}</span>}
                      </div>
                    )}

                    {/* Etiquetas */}
                    {(tags.length > 0 || typeof it.price !== 'undefined') && (
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {tags.map((t: string, i2: number) => (
                          <span
                            key={i2}
                            className="px-2 py-0.5 text-[11px] rounded-full bg-black/5 border border-black/10 text-[#333]"
                          >
                            {t}
                          </span>
                        ))}
                        {typeof it.price !== 'undefined' && (
                          <span className="px-2 py-0.5 text-[11px] rounded-full bg-[#faf6ed] border border-[#e8d8b6] text-[#6b5a35]">
                            Precio: {String(it.price)}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            });

            return rows;
          })()}
        </div>
      </div>
    </div>
  );
}
