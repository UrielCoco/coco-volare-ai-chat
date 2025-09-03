// app/(chat)/components/ItineraryCard.tsx
'use client';

import * as React from 'react';

type Activity =
  | string
  | {
      time?: string;
      title?: string;
      name?: string;
      description?: string;
      details?: string;
      location?: string | { city?: string; country?: string; area?: string };
    };

type Day = {
  day?: number;
  date?: string;
  title?: string;
  subtitle?: string;
  notes?: string;
  locations?: Array<
    | string
    | { city?: string; country?: string; area?: string }
  >;
  weather?: {
    tempCmin?: number;
    tempCmax?: number;
    tempFmin?: number;
    tempFmax?: number;
    icon?: string;
    summary?: string;
  };
  transports?: any[];
  activities?: Activity[];
  hotel?: {
    name?: string;
    area?: string;
    address?: string;
    checkin?: string;
    checkout?: string;
    confirmation?: string;
    style?: string;
  };
};

type Summary = {
  destination?: string;
  startDate?: string;
  endDate?: string;
  nights?: number;
  overview?: string;
  // admite variantes
  title?: string;
  tripTitle?: string;
  cities?: string[]; // si el assistant manda lista de ciudades
};

type Itinerary = {
  cardType?: string;
  lang?: string;
  summary?: Summary;
  days?: Day[];
};

const GOLD = '#bba36d';
const GOLD_SOFT_BG =
  'linear-gradient(180deg, rgba(187,163,109,0.18) 0%, rgba(187,163,109,0.10) 100%)';

/* ================= Helpers de “pinta solo si hay valor” ================= */

function has<T>(v: T | null | undefined): v is T {
  if (v == null) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'string') return v.trim().length > 0;
  if (typeof v === 'object') return Object.keys(v).length > 0;
  return true;
}

function fmtDate(d?: string) {
  if (!has(d)) return '';
  const dt = new Date(d as string);
  if (isNaN(+dt)) return String(d);
  return dt.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function plural(n: number, uno: string, varios: string) {
  return `${n} ${n === 1 ? uno : varios}`;
}

/* ================= Chips / Pills ================= */

function Chip({
  children,
  dark = false,
}: {
  children: React.ReactNode;
  dark?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center px-2 py-1 text-[11px] rounded-full border ${
        dark ? 'bg-black/50 text-white/90 border-white/25' : 'border-transparent'
      }`}
      style={
        dark
          ? undefined
          : { borderColor: GOLD, background: GOLD_SOFT_BG, color: '#5d4f25' }
      }
    >
      {children}
    </span>
  );
}

/* ================= Secciones ================= */

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  if (!has(children)) return null;
  return (
    <div className="space-y-2">
      <div className="text-[13px] tracking-wide text-neutral-300">{title}</div>
      <div className="text-[13px] leading-6 text-neutral-200">{children}</div>
    </div>
  );
}

/* ========= Normalizadores para formatos “flexibles” del assistant ========= */

function normalizeLocations(
  locs?: Day['locations'],
): Array<string> | undefined {
  if (!has(locs)) return undefined;
  const out: string[] = [];
  for (const l of locs!) {
    if (typeof l === 'string') out.push(l);
    else {
      const city = l?.city?.trim() || '';
      const country = l?.country?.trim() || '';
      const area = l?.area?.trim() || '';
      const parts = [city, area, country].filter(Boolean);
      if (parts.length) out.push(parts.join(', '));
    }
  }
  return out.length ? out : undefined;
}

function normalizeActivities(acts?: Activity[]): Array<{
  time?: string;
  title?: string;
  description?: string;
  location?: string;
}> | undefined {
  if (!has(acts)) return undefined;
  const out: Array<{
    time?: string;
    title?: string;
    description?: string;
    location?: string;
  }> = [];

  for (const a of acts!) {
    if (typeof a === 'string') {
      out.push({ title: a });
    } else {
      const title = a.title || a.name;
      const desc = a.description || a.details;
      let location = '';
      if (typeof a.location === 'string') location = a.location;
      else if (a.location && typeof a.location === 'object') {
        const { city = '', area = '', country = '' } = a.location;
        location = [city, area, country].filter(Boolean).join(', ');
      }
      if (title || desc || a.time || location) {
        out.push({
          time: a.time,
          title: title,
          description: desc,
          location,
        });
      }
    }
  }

  return out.length ? out : undefined;
}

function normalizeWeather(w?: Day['weather']) {
  if (!has(w)) return undefined;
  const icon = w!.icon || '';
  const summary = w!.summary || '';
  const temp =
    (w!.tempCmin != null && w!.tempCmax != null
      ? `${w!.tempCmin}–${w!.tempCmax}°C`
      : w!.tempFmin != null && w!.tempFmax != null
      ? `${w!.tempFmin}–${w!.tempFmax}°F`
      : '') || undefined;

  if (!icon && !summary && !temp) return undefined;
  return { icon, summary, temp };
}

/* ================== Tarjeta principal ================== */

export default function ItineraryCard({ data }: { data: Itinerary }) {
  const summary = data?.summary || {};
  const title =
    summary.tripTitle ||
    summary.title ||
    (summary.destination ? `Viaje a ${summary.destination}` : 'Itinerario');

  const start = fmtDate(summary.startDate);
  const end = fmtDate(summary.endDate);
  const nights =
    typeof summary.nights === 'number' && summary.nights >= 0
      ? summary.nights
      : undefined;

  const days: Day[] = Array.isArray(data?.days) ? (data!.days as Day[]) : [];
  const [idx, setIdx] = React.useState(0);
  const current = days[idx];

  const cities =
    Array.isArray(summary.cities) && summary.cities.length
      ? summary.cities
      : normalizeLocations(current?.locations);

  const weather = normalizeWeather(current?.weather);
  const acts = normalizeActivities(current?.activities);

  // estilos: fondo negro, tarjeta cristal
  return (
    <div className="w-full bg-black py-4 px-3 sm:px-4">
      <div className="mx-auto max-w-3xl rounded-3xl shadow-xl ring-1 ring-white/10 bg-white/10 backdrop-blur-md p-4 sm:p-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <img
              src="/images/logo-coco-volare.png"
              alt="Coco Volare"
              className="h-8 w-auto select-none"
              draggable={false}
            />
            <div>
              <div className="text-base sm:text-lg font-semibold text-white">
                {title}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                {has(cities) && (
                  <Chip>
                    {Array.isArray(cities) ? cities.join(' • ') : String(cities)}
                  </Chip>
                )}
                {start && end && <Chip>{`${start} — ${end}`}</Chip>}
                {typeof nights === 'number' && (
                  <Chip>{plural(nights, 'noche', 'noches')}</Chip>
                )}
              </div>
            </div>
          </div>

          {/* Navegación de días */}
          {days.length > 1 && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setIdx((p) => Math.max(0, p - 1))}
                className="h-8 w-8 rounded-full bg-black/60 text-white hover:bg-black/80 transition inline-flex items-center justify-center"
                aria-label="Día anterior"
              >
                ‹
              </button>
              <Chip dark>Dia {Math.min(idx + 1, days.length)}</Chip>
              <button
                onClick={() => setIdx((p) => Math.min(days.length - 1, p + 1))}
                className="h-8 w-8 rounded-full bg-black/60 text-white hover:bg-black/80 transition inline-flex items-center justify-center"
                aria-label="Día siguiente"
              >
                ›
              </button>
            </div>
          )}
        </div>

        {/* Contenido del día */}
        {has(current) ? (
          <div className="mt-5 space-y-5">
            {/* Encabezado del día */}
            <div className="flex items-start justify-between gap-3">
              <div>
                {has(current?.title) && (
                  <div className="text-[15px] sm:text-base font-semibold text-white">
                    {current!.title}
                  </div>
                )}
                {has(current?.subtitle) && (
                  <div className="text-sm text-neutral-300">
                    {current!.subtitle}
                  </div>
                )}
              </div>
              <div className="text-sm text-neutral-400">
                {fmtDate(current?.date)}
              </div>
            </div>

            {/* Tags rápidos */}
            {(has(cities) || has(weather)) && (
              <div className="flex flex-wrap gap-2">
                {has(cities) &&
                  (cities as string[]).map((c, i) => <Chip key={i}>{c}</Chip>)}
                {has(weather) && (
                  <Chip>
                    <span className="mr-1">{weather!.icon || '🌤️'}</span>
                    {weather!.summary || 'Clima'}
                    {weather!.temp ? ` • ${weather!.temp}` : ''}
                  </Chip>
                )}
              </div>
            )}

            {/* Actividades */}
            {has(acts) && (
              <Section title="Actividades">
                <div className="space-y-1">
                  {(acts as any[]).map((a, i) => {
                    const time = a.time ? `${a.time} — ` : '';
                    const title = a.title || 'Actividad';
                    const desc = a.description ? `: ${a.description}` : '';
                    const loc = a.location ? ` (${a.location})` : '';
                    return (
                      <div key={i} className="text-neutral-200">
                        • {time}
                        <span className="font-medium">{title}</span>
                        {desc}
                        {loc}
                      </div>
                    );
                  })}
                </div>
              </Section>
            )}

            {/* Alojamiento */}
            {has(current?.hotel) && (current!.hotel!.name || current!.hotel!.area || current!.hotel!.address) && (
              <Section title="Alojamiento">
                <ul className="list-disc pl-5">
                  {current!.hotel!.name && (
                    <li>
                      <span className="font-medium">{current!.hotel!.name}</span>
                    </li>
                  )}
                  {current!.hotel!.area && <li>Zona: {current!.hotel!.area}</li>}
                  {current!.hotel!.address && (
                    <li>Dirección: {current!.hotel!.address}</li>
                  )}
                  {/* Check-in/out y confirmación SON DATOS LOGÍSTICOS; si prefieres mostrarlos, quita este comentario */}
                  {/* {current!.hotel!.checkin && <li>Check-in: {fmtDate(current!.hotel!.checkin)}</li>}
                  {current!.hotel!.checkout && <li>Check-out: {fmtDate(current!.hotel!.checkout)}</li>}
                  {current!.hotel!.confirmation && <li>Confirmación: {current!.hotel!.confirmation}</li>} */}
                </ul>
              </Section>
            )}

            {/* Notas del día */}
            {has(current?.notes) && (
              <Section title="Notas">{current!.notes}</Section>
            )}
          </div>
        ) : (
          <div className="mt-6 text-neutral-300 text-sm">
            No hay información para este día.
          </div>
        )}

        {/* Footer de navegación rápida */}
        {days.length > 1 && (
          <div className="mt-6 flex flex-wrap gap-2">
            <Chip dark>Resumen</Chip>
            {days.map((_, i) => (
              <button
                key={i}
                onClick={() => setIdx(i)}
                className={`px-2 py-1 text-[11px] rounded-full border transition ${
                  i === idx
                    ? 'bg-black/70 text-white border-white/30'
                    : 'bg-black/40 text-white/80 border-white/20 hover:bg-black/60'
                }`}
              >
                Día {i + 1}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
