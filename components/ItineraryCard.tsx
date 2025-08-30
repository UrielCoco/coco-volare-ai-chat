'use client';

import { useState } from 'react';

function ulog(event: string, meta: any = {}) {
  try { console.debug('[CV][ui][itin]', event, meta); } catch {}
}

const isISODate = (s?: string) => !!(s && /^\d{4}-\d{2}-\d{2}$/.test(s));

type Weather = {
  tempCmin?: number; tempCmax?: number;
  tempFmin?: number; tempFmax?: number;
  humidity?: number; icon?: string; summary?: string;
};

type Location = { city?: string; country?: string };
type Hotel = { name?: string; area?: string; style?: string };

type TimelineItem = {
  time?: string;
  category?: 'activity' | 'transport' | 'hotel' | string;
  title?: string;
  location?: string;
  duration?: string;
  optional?: boolean;
  notes?: string;
  options?: { title?: string; notes?: string }[];
  transport?: {
    mode?: 'air' | 'land' | 'sea' | string;
    from?: Location; to?: Location;
    carrier?: string; code?: string;
    duration?: string;
    isInternational?: boolean;
    bookedByClient?: boolean;
  };
};

type Day = {
  day?: number;
  date?: string;
  title?: string;
  locations?: Location[];
  weather?: Weather;
  hotelOptions?: Hotel[];
  timeline?: TimelineItem[];
  notes?: string;
};

type Itinerary = {
  lang?: string;
  tripTitle?: string;
  title?: string; // compat
  clientBooksLongHaulFlights?: boolean;
  disclaimer?: string;
  days?: Day[];
  price?: number;
  currency?: string;
  notes?: string;
};

function DaySection({ d, index }: { d: Day; index: number }) {
  const locs = (d.locations || []).filter(Boolean);
  const tl = (d.timeline || []).filter(Boolean);
  const showWeather =
    !!d.weather &&
    (d.weather.tempCmin != null ||
      d.weather.tempCmax != null ||
      d.weather.tempFmin != null ||
      d.weather.tempFmax != null ||
      d.weather.humidity != null ||
      d.weather.icon ||
      d.weather.summary);
  const showDate = isISODate(d.date);

  return (
    <div className="rounded-xl bg-neutral-50 shadow-sm">
      <div className="px-4 py-3">
        <div className="text-sm text-neutral-500">
          Día {d.day ?? index + 1}{showDate ? ` • ${d.date}` : ''}
        </div>
        {d.title && <div className="font-semibold">{d.title}</div>}

        {locs.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {locs.map((l, j) => (
              <span key={j} className="text-xs px-2 py-1 rounded-full bg-white shadow">
                {l.city || ''}{l.city && l.country ? ', ' : ''}{l.country || ''}
              </span>
            ))}
          </div>
        )}

        {showWeather && (
          <div className="mt-2 text-sm text-neutral-700 flex items-center gap-2">
            <span>{d.weather?.icon || '🌤️'}</span>
            <span>
              {d.weather?.summary || ''}
              {d.weather?.tempCmin != null || d.weather?.tempCmax != null ? (
                <> • min {d.weather?.tempCmin ?? '-'}°C / max {d.weather?.tempCmax ?? '-'}°C</>
              ) : null}
              {d.weather?.tempFmin != null || d.weather?.tempFmax != null ? (
                <> ({d.weather?.tempFmin ?? '-'}–{d.weather?.tempFmax ?? '-'}°F)</>
              ) : null}
              {d.weather?.humidity != null ? <> • hum {d.weather?.humidity}%</> : null}
            </span>
          </div>
        )}
      </div>

      {Array.isArray(d.hotelOptions) && d.hotelOptions.length > 0 && (
        <div className="px-4 pb-3">
          <div className="text-sm font-medium mb-2">Hoteles sugeridos</div>
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {d.hotelOptions.map((h, j) => (
              <li key={j} className="rounded-lg bg-white p-3 shadow">
                <div className="font-medium">{h.name}</div>
                {(h.area || h.style) && (
                  <div className="text-xs text-neutral-600">
                    {h.area ? `${h.area}` : ''}{h.area && h.style ? ' • ' : ''}{h.style || ''}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {tl.length > 0 && (
        <div className="px-4 pb-4">
          <div className="text-sm font-medium mb-2">Plan del día</div>
          <ul className="space-y-2">
            {tl.map((item, k) => (
              <li key={k} className="rounded-lg bg-white p-3 shadow">
                <div className="text-xs text-neutral-500">
                  {(item.time || '--:--')}{item.category ? ` • ${item.category}` : ''}
                </div>
                {item.title && <div className="font-medium">{item.title}</div>}
                {item.location && <div className="text-sm text-neutral-700">{item.location}</div>}
                {item.duration && <div className="text-xs text-neutral-600 mt-1">Duración: {item.duration}</div>}
                {item.optional ? <div className="text-xs text-neutral-600">Opcional</div> : null}
                {item.notes && <div className="text-xs text-neutral-700 mt-1">{item.notes}</div>}

                {Array.isArray(item.options) && item.options.length > 0 && (
                  <ul className="mt-2 list-disc pl-5 text-sm">
                    {item.options.map((op, z) => (
                      <li key={z}>
                        {op.title && <span className="font-medium">{op.title}</span>}
                        {op.title && op.notes ? ' — ' : ''}
                        {op.notes || ''}
                      </li>
                    ))}
                  </ul>
                )}

                {item.category === 'transport' && item.transport && (
                  <div className="mt-2 text-xs text-neutral-700 space-y-0.5">
                    {item.transport.mode && <div>Modo: {item.transport.mode}</div>}
                    {(item.transport.from || item.transport.to) && (
                      <div>
                        Ruta:{' '}
                        {(item.transport.from?.city || '')}
                        {item.transport.from?.country ? `, ${item.transport.from.country}` : ''}
                        {' → '}
                        {(item.transport.to?.city || '')}
                        {item.transport.to?.country ? `, ${item.transport.to.country}` : ''}
                      </div>
                    )}
                    {item.transport.carrier && <div>Compañía: {item.transport.carrier}</div>}
                    {item.transport.code && <div>Código: {item.transport.code}</div>}
                    {item.transport.duration && <div>Duración: {item.transport.duration}</div>}
                    {item.transport.isInternational != null && <div>Internacional: {item.transport.isInternational ? 'sí' : 'no'}</div>}
                    {item.transport.bookedByClient != null && <div>Reserva por cliente: {item.transport.bookedByClient ? 'sí' : 'no'}</div>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {d.notes && <div className="px-4 pb-4 text-sm text-neutral-700">{d.notes}</div>}
    </div>
  );
}

export default function ItineraryCard({ data }: { data: Itinerary }) {
  const title = data?.tripTitle || data?.title || 'Itinerario';
  const days = Array.isArray(data?.days) ? data.days : [];
  const [showAll, setShowAll] = useState(false);

  const VISIBLE = 3; // días visibles por defecto para mantener corto el chat
  const visibleDays = showAll ? days : days.slice(0, VISIBLE);

  ulog('render.simple', { title, days: days.length, showAll });

  return (
    <div className="w-full flex justify-start">
      {/* Sin bordes, con sombra y logo */}
      <div className="relative w-full max-w-3xl rounded-2xl bg-white text-black shadow-lg p-4 space-y-4 overflow-hidden">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="text-lg md:text-xl font-semibold leading-tight truncate">{title}</h3>
            {data?.disclaimer && (
              <p className="text-xs text-neutral-600 mt-1 line-clamp-3">{data.disclaimer}</p>
            )}
          </div>

          <div className="flex items-start gap-3 shrink-0">
            {data?.price != null && (
              <div className="text-sm font-medium whitespace-nowrap mt-1">
                {data.price} {data.currency || ''}
              </div>
            )}
            <img
              src="/images/logo-coco-volare.png"
              alt="Coco Volare"
              className="h-7 md:h-8 w-auto select-none"
              draggable={false}
            />
          </div>
        </div>

        {/* Días (compacto) */}
        <div className="space-y-3">
          {visibleDays.map((d, i) => (
            <DaySection key={i} d={d} index={i} />
          ))}
        </div>

        {/* Toggle mostrar todo / menos */}
        {days.length > VISIBLE && (
          <div className="pt-1">
            <button
              onClick={() => setShowAll((v) => !v)}
              className="px-4 py-2 rounded-full bg-neutral-100 text-neutral-800 shadow text-sm"
            >
              {showAll ? 'Ver menos' : `Ver todos (${days.length})`}
            </button>
          </div>
        )}

        {data?.notes && <div className="text-sm text-neutral-700">{data.notes}</div>}
      </div>
    </div>
  );
}
