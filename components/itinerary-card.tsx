'use client';

import React, { useMemo, useState } from 'react';

/**
 * JSON esperado (dinámico y retrocompatible).
 * Ver notas anteriores; soporta "timeline" y convierte "items" -> "timeline".
 */

/* ========================= i18n + detección ========================= */

type Lang = 'es' | 'en';

const DICT: Record<Lang, Record<string, string>> = {
  es: {
    brandHead: 'COCO VOLARE · ITINERARIO',
    itinerary: 'Itinerario',
    day: 'Día',
    locationUndefined: 'Ubicación por definir',
    noTime: 'SIN HORA',
    duration: 'Duración',
    price: 'Precio',
    air: 'Aéreo',
    land: 'Terrestre',
    sea: 'Marítimo',
    meal: 'Alimento',
    activity: 'Atracción',
    reservation: 'Reservación',
    hotel: 'Hotel',
    ticket: 'Ticket',
    unspecified: 'no especificada',
  },
  en: {
    brandHead: 'COCO VOLARE · ITINERARY',
    itinerary: 'Itinerary',
    day: 'Day',
    locationUndefined: 'Location to be defined',
    noTime: 'NO TIME',
    duration: 'Duration',
    price: 'Price',
    air: 'Air',
    land: 'Land',
    sea: 'Sea',
    meal: 'Meal',
    activity: 'Attraction',
    reservation: 'Reservation',
    hotel: 'Hotel',
    ticket: 'Ticket',
    unspecified: 'unspecified',
  },
};

// Heurística: detecta idioma según el contenido del itinerario
function guessLangFromItinerary(it: any): Lang {
  try {
    const texts: string[] = [];
    if (typeof it?.tripTitle === 'string') texts.push(it.tripTitle);
    (it?.days ?? []).slice(0, 3).forEach((d: any) => {
      if (typeof d?.title === 'string') texts.push(d.title);
      (d?.timeline ?? d?.items ?? []).slice(0, 5).forEach((x: any) => {
        if (typeof x?.title === 'string') texts.push(x.title);
        if (typeof x?.notes === 'string') texts.push(x.notes);
        if (typeof x?.location === 'string') texts.push(x.location);
      });
    });
    const blob = texts.join(' ').toLowerCase();
    const hasAccents = /[áéíóúñü]/.test(blob);
    const spanishTokens = /(bienvenido|itinerario|día|traslado|vuelo|hotel|duraci[oó]n|comida|cena|almuerzo|visita|atracci[oó]n|reservaci[oó]n|a[eé]reo|terrestre|mar[ií]timo)/;
    if (hasAccents || spanishTokens.test(blob)) return 'es';
  } catch {}
  return 'en';
}

/* ========================= helpers UI ========================= */

const ICON_BY_CATEGORY: Record<string, string> = {
  activity: '🎟️',
  meal: '🍽️',
  hotel: '🏨',
  ticket: '🎫',
  reservation: '📑',
};
const ICON_BY_MODE: Record<string, string> = { air: '✈️', land: '🚗', sea: '⛴️' };

function fmtCityCountry(x?: { city?: string; country?: string }) {
  if (!x) return '';
  const a = [x.city, x.country].filter(Boolean).join(', ');
  return a || '';
}

function formatDuration(s?: string): string {
  if (!s) return '';

  // ISO 8601: PT#H#M
  const iso = /^P(T(?:(\d+)H)?(?:(\d+)M)?)$/i.exec(s);
  if (iso) {
    const hh = iso[2] ? Number(iso[2]) : 0;
    const mm = iso[3] ? Number(iso[3]) : 0;
    if (hh && mm) return `${hh}h ${mm}m`;
    if (hh) return `${hh}h`;
    if (mm) return `${mm}m`;
  }

  // "2h 30m" / "2h30m" / "2h" / "30m"
  const hm = /(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?/i.exec(s);
  if (hm && (hm[1] || hm[2])) {
    const hh = hm[1] ? Number(hm[1]) : 0;
    const mm = hm[2] ? Number(hm[2]) : 0;
    if (hh && mm) return `${hh}h ${mm}m`;
    if (hh) return `${hh}h`;
    if (mm) return `${mm}m`;
  }

  // "150m"
  const onlyM = /^(\d+)\s*m$/i.exec(s);
  if (onlyM) return `${onlyM[1]}m`;

  // Fallback: devuélvelo tal cual
  return s;
}


// Convierte items -> timeline y ordena por hora. Aplica heurística para transportes.
function toTimeline(day: any): any[] {
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
  // Heurística: si llega "Flight" como actividad, forzamos transport + mode
  tl = tl.map((it) => {
    if (it.category === 'transport') return it;
    const txt = `${it.title || ''} ${it.notes || ''}`.toLowerCase();
    const looksAir = /(flight|vuelo|av[ií]on|a[eé]reo|airline|air\s)/.test(txt);
    const looksSea = /(ferry|barco|ship|cruise|mar[ií]timo|boat)/.test(txt);
    const looksLand = /(train|tren|bus|autob[uú]s|car|auto|drive|taxi|transfer|traslado|shuttle)/.test(txt);
    if (looksAir || looksSea || looksLand) {
      return {
        ...it,
        category: 'transport',
        transport: {
          ...(it.transport || {}),
          mode: looksAir ? 'air' : looksSea ? 'sea' : 'land',
        },
      };
    }
    return it;
  });
  const toNum = (t: string) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(t || '');
    if (!m) return 9999;
    return Number(m[1]) * 60 + Number(m[2]);
  };
  return [...tl].sort((a, b) => toNum(a.time) - toNum(b.time));
}

export default function ItineraryCard({ itinerary }: { itinerary: any }) {
  const lang: Lang = useMemo(() => guessLangFromItinerary(itinerary), [itinerary]);
  const L = DICT[lang];

  const days = itinerary?.days ?? [];
  const [i, setI] = useState(0);
  const d = days[i] || days[0];

  // Título del bloque
  const title = useMemo(() => {
    if (itinerary?.tripTitle) return itinerary.tripTitle;
    if (days?.length) return `${L.day} ${days[0].day} – ${days[days.length - 1].day}`;
    return L.itinerary;
  }, [itinerary, days, L]);

  const locations = Array.isArray(d?.locations) && d.locations.length > 0
    ? d.locations
    : [{ city: d?.location || '', country: '' }].filter((x) => x.city);

  const timeline = toTimeline(d);
  const hourOf = (t?: string) => {
    const m = /^(\d{1,2}):/.exec(t || '');
    return m ? m[1].padStart(2, '0') : '--';
  };

  return (
    // 🔶 Estética premium: gradiente suave + sombra profunda + borde superior “pill”
    <div className="w-full rounded-[28px] bg-gradient-to-b from-[#fef9f1] to-white shadow-[0_20px_60px_-20px_rgba(0,0,0,0.35)] ring-1 ring-black/5 overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 bg-gradient-to-b from-[#f7efe0] to-[#fffaf0] border-b border-black/5">
        <div className="text-[12px] uppercase tracking-[0.2em] text-[#6b5a35]">
          {L.brandHead}
        </div>
        <div className="text-xl md:text-[22px] font-semibold text-[#1a1a1a] mt-0.5">{title}</div>
      </div>

      {/* Tabs de días */}
      <div className="px-4 pt-3 flex gap-2 overflow-x-auto">
        {days.map((dayObj: any, idx: number) => (
          <button
            key={idx}
            onClick={() => setI(idx)}
            className={
              'px-3 py-1.5 rounded-full text-sm whitespace-nowrap border transition ' +
              (i === idx
                ? 'bg-[#b69965] text-black border-[#b69965] shadow'
                : 'bg-white text-[#333] border-black/10 hover:bg-black/5')
            }
          >
            {L.day} {dayObj.day}{dayObj.date ? ` · ${dayObj.date}` : ''}
          </button>
        ))}
      </div>

      {/* Chips de localización del día */}
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
          <span className="text-xs text-[#6b6b6b]">{L.locationUndefined}</span>
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
                    {hr !== '--' ? `${hr}:00` : L.noTime}
                  </div>
                );
              }

              const isTransport = it.category === 'transport';
              const mode = it?.transport?.mode;
              const icon = isTransport
                ? (ICON_BY_MODE[mode || 'land'] || '🚗')
                : (ICON_BY_CATEGORY[it.category] || '•');

              const tDur = formatDuration(it?.transport?.duration || it?.duration);
              const line2 = isTransport
                ? [
                    fmtCityCountry(it?.transport?.from),
                    '→',
                    fmtCityCountry(it?.transport?.to),
                  ].filter(Boolean).join(' ')
                : (it.location || (locations?.[0] ? fmtCityCountry(locations[0]) : ''));

              const tags: string[] = [];
              if (isTransport) {
                tags.push(mode === 'air' ? L.air : mode === 'sea' ? L.sea : L.land);
                tags.push(`${L.duration} ${tDur || L.unspecified}`);
                if (it?.transport?.code) tags.push(it.transport.code);
                if (it?.transport?.carrier) tags.push(it.transport.carrier);
              } else {
                if (it.category === 'meal') tags.push(L.meal);
                else if (it.category === 'activity') tags.push(L.activity);
                else if (it.category === 'reservation') tags.push(L.reservation);
                else if (it.category === 'hotel') tags.push(L.hotel);
                else if (it.category === 'ticket') tags.push(L.ticket);
                tags.push(`${L.duration} ${tDur || L.unspecified}`);
              }

              rows.push(
                <div
                  key={idx}
                  className="flex items-start gap-3 rounded-2xl border border-black/10 p-3 bg-white shadow-sm"
                >
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
                            {L.price}: {String(it.price)}
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
