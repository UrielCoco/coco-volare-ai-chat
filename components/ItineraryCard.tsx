'use client';

import * as React from 'react';

/** ===================== Tipos flexibles ===================== */
type AnyObj = Record<string, any>;

type Activity =
  | string
  | {
      time?: string;
      title?: string;
      name?: string;
      description?: string;
      details?: string;
      location?: string | { city?: string; area?: string; country?: string };
    };

type Day = {
  day?: number;
  date?: string;
  title?: string;
  subtitle?: string;
  notes?: string;
  locations?: Array<string | { city?: string; area?: string; country?: string }>;
  weather?: {
    tempCmin?: number; tempCmax?: number;
    tempFmin?: number; tempFmax?: number;
    icon?: string; summary?: string;
  };
  transports?: AnyObj[] | string[];
  activities?: Activity[];
  hotel?: {
    name?: string; area?: string; address?: string;
    checkin?: string; checkout?: string; confirmation?: string; style?: string;
    [k: string]: any;
  } | string;
  [k: string]: any; // admite extensiones
};

type Summary = {
  destination?: string;
  startDate?: string;
  endDate?: string;
  nights?: number;
  overview?: string;
  title?: string;
  tripTitle?: string;
  cities?: string[];
  [k: string]: any;
};

type Itinerary = {
  cardType?: string;
  lang?: string;
  summary?: Summary;
  days?: Day[];
  [k: string]: any;
};

/** ===================== Utilidades ===================== */
const IMGS = [
  '/images/CocoVolare1.jpg',
  '/images/CocoVolare2.jpg',
  '/images/CocoVolare3.jpg',
  '/images/CocoVolare4.jpg',
  '/images/CocoVolare5.jpg',
  '/images/CocoVolare6.jpg',
  '/images/CocoVolare7.jpg',
  '/images/CocoVolare8.jpg',
];

function has(v: any): boolean {
  if (v == null) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v).length > 0;
  return true;
}
function fmtDate(d?: string) {
  if (!has(d)) return '';
  const dt = new Date(d as string);
  if (isNaN(+dt)) return String(d);
  return dt.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
function plural(n: number, uno: string, varios: string) {
  return `${n} ${n === 1 ? uno : varios}`;
}
function joinNonEmpty(list: (string | undefined)[], sep = ', ') {
  return list.filter(Boolean).join(sep);
}

function normalizeLocations(locs?: Day['locations']): string[] | undefined {
  if (!has(locs)) return;
  const out: string[] = [];
  for (const l of locs!) {
    if (typeof l === 'string') out.push(l);
    else out.push(joinNonEmpty([l.city, l.area, l.country]));
  }
  return out.filter(Boolean);
}

function normalizeActivities(acts?: Activity[]) {
  if (!has(acts)) return;
  return acts!.map((a) => {
    if (typeof a === 'string') return { title: a };
    const title = a.title || a.name;
    let loc = '';
    if (typeof a.location === 'string') loc = a.location;
    else if (a.location) loc = joinNonEmpty([a.location.city, a.location.area, a.location.country]);
    return { time: a.time, title, description: a.description || a.details, location: loc };
  });
}

function normalizeWeather(w?: Day['weather']) {
  if (!has(w)) return;
  const temp =
    w!.tempCmin != null && w!.tempCmax != null
      ? `${w!.tempCmin}–${w!.tempCmax}°C`
      : w!.tempFmin != null && w!.tempFmax != null
      ? `${w!.tempFmin}–${w!.tempFmax}°F`
      : undefined;
  return { icon: w!.icon, summary: w!.summary, temp };
}

/** ===================== Subcomponentes ===================== */
function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="inline-flex items-center px-2 py-1 rounded-full text-[11px]"
      style={{ background: 'rgba(0,0,0,0.06)', color: '#333' }}
    >
      {children}
    </span>
  );
}

function KVPairs({ obj }: { obj: AnyObj }) {
  const entries = Object.entries(obj || {}).filter(([, v]) => has(v));
  if (!entries.length) return null;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-[13px] text-neutral-700">
      {entries.map(([k, v]) => (
        <div key={k} className="flex items-start">
          <span className="min-w-28 text-neutral-500 capitalize">{k.replace(/[_-]/g, ' ')}:</span>
          <span className="ml-2 break-words">
            {typeof v === 'string'
              ? v
              : Array.isArray(v)
              ? JSON.stringify(v)
              : typeof v === 'object'
              ? JSON.stringify(v)
              : String(v)}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Carrusel simple con auto-rotación */
function Carousel({ images }: { images: string[] }) {
  const [i, setI] = React.useState(0);
  const len = images.length;

  React.useEffect(() => {
    if (!len) return;
    const id = setInterval(() => setI((p) => (p + 1) % len), 4000);
    return () => clearInterval(id);
  }, [len]);

  if (!len) return null;
  return (
    <div className="relative w-full overflow-hidden rounded-2xl">
      <img
        key={i}
        src={images[i]}
        alt=""
        className="w-full h-56 sm:h-72 object-cover transition-opacity duration-500"
      />
      {/* controles */}
      <button
        aria-label="Anterior"
        onClick={() => setI((p) => (p - 1 + len) % len)}
        className="absolute left-3 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full bg-black/55 text-white shadow-md flex items-center justify-center"
      >
        ‹
      </button>
      <button
        aria-label="Siguiente"
        onClick={() => setI((p) => (p + 1) % len)}
        className="absolute right-3 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full bg-black/55 text-white shadow-md flex items-center justify-center"
      >
        ›
      </button>

      {/* indicadores */}
      <div className="absolute bottom-3 left-0 right-0 flex justify-center gap-1.5">
        {images.map((_, idx) => (
          <span
            key={idx}
            className={`h-1.5 rounded-full transition-all ${idx === i ? 'w-5 bg-white' : 'w-2 bg-white/60'}`}
          />
        ))}
      </div>
    </div>
  );
}

/** ===================== Componente principal ===================== */
export default function ItineraryCard({ data }: { data: Itinerary }) {
  const summary = data?.summary || {};
  const title =
    summary.tripTitle ||
    summary.title ||
    (summary.destination ? `Viaje a ${summary.destination}` : 'Itinerario');

  const start = fmtDate(summary.startDate);
  const end = fmtDate(summary.endDate);
  const nights =
    typeof summary.nights === 'number' && summary.nights >= 0 ? summary.nights : undefined;

  const days: Day[] = Array.isArray(data?.days) ? (data!.days as Day[]) : [];
  const [idx, setIdx] = React.useState(0);
  const current: Day = (days[idx] ?? {}) as Day;

  const citiesFromSummary = (summary.cities && summary.cities.length ? summary.cities : undefined);
  const citiesFromDay = normalizeLocations(current.locations);
  const cities = citiesFromSummary ?? citiesFromDay;

  const weather = normalizeWeather(current.weather);
  const actsArr = normalizeActivities(current.activities) ?? [];

  // Hotel, con guardas de tipo
  const hotel = current?.hotel;
  const hasHotel = has(hotel);
  const isHotelString = typeof hotel === 'string';
  const hotelObj: AnyObj | null =
    !hotel || typeof hotel === 'string' ? null : (hotel as AnyObj);

  return (
    <div className="w-full px-3 py-4">
      <div className="mx-auto max-w-xl sm:max-w-2xl rounded-[26px] shadow-xl bg-white overflow-hidden">
        {/* MEDIA */}
        <div className="p-3 sm:p-4">
          <div className="flex items-center justify-between mb-3">
            <img
              src="/images/logo-coco-volare.png"
              alt="Coco Volare"
              className="h-10 sm:h-12 w-auto"
              draggable={false}
            />
            {/* Etiquetas rápidas de resumen */}
            <div className="hidden sm:flex items-center gap-2">
              {has(cities) && (
                <Chip>{Array.isArray(cities) ? cities.join(' • ') : String(cities)}</Chip>
              )}
              {start && end && <Chip>{`${start} — ${end}`}</Chip>}
              {typeof nights === 'number' && <Chip>{plural(nights, 'noche', 'noches')}</Chip>}
            </div>
          </div>

          <Carousel images={IMGS} />
        </div>

        {/* BODY */}
        <div className="px-4 sm:px-6 pb-5">
          {/* Título principal */}
          <div className="text-lg sm:text-xl font-semibold text-neutral-900">{title}</div>

          {/* Tags móviles debajo del título */}
          <div className="mt-2 flex flex-wrap gap-2 sm:hidden">
            {has(cities) && (
              <Chip>{Array.isArray(cities) ? cities.join(' • ') : String(cities)}</Chip>
            )}
            {start && end && <Chip>{`${start} — ${end}`}</Chip>}
            {typeof nights === 'number' && <Chip>{plural(nights, 'noche', 'noches')}</Chip>}
          </div>

          {/* Día actual */}
          <div className="mt-4 flex items-start justify-between">
            <div>
              {has(current.title) && (
                <div className="text-[15px] font-medium text-neutral-900">{current.title}</div>
              )}
              {has(current.subtitle) && (
                <div className="text-[13px] text-neutral-600">{current.subtitle}</div>
              )}
            </div>
            <div className="text-[12px] text-neutral-500">{fmtDate(current.date)}</div>
          </div>

          {/* Chips de ubicación y clima */}
          <div className="mt-3 flex flex-wrap gap-2">
            {normalizeLocations(current.locations)?.map((c, i) => <Chip key={i}>{c}</Chip>)}
            {weather && (
              <Chip>
                <span className="mr-1">{weather.icon || '🌤️'}</span>
                {weather.summary || 'Clima'}{weather.temp ? ` • ${weather.temp}` : ''}
              </Chip>
            )}
          </div>

          {/* Actividades */}
          {actsArr.length > 0 && (
            <div className="mt-5">
              <div className="font-medium text-neutral-900 mb-2">Actividades</div>
              <ul className="space-y-1 text-[13px] text-neutral-800">
                {actsArr.map((a, i) => {
                  const t = [
                    a.time ? `${a.time} —` : '',
                    a.title || 'Actividad',
                    a.description ? `: ${a.description}` : '',
                    a.location ? ` (${a.location})` : '',
                  ]
                    .join(' ')
                    .replace(/\s+/g, ' ')
                    .trim();
                  return <li key={i}>• {t}</li>;
                })}
              </ul>
            </div>
          )}

          {/* Alojamiento */}
          {hasHotel && (
            <div className="mt-5">
              <div className="font-medium text-neutral-900 mb-2">Alojamiento</div>
              {isHotelString ? (
                <div className="text-[13px] text-neutral-800">{hotel as string}</div>
              ) : (
                <div className="text-[13px] text-neutral-800 space-y-1">
                  {hotelObj?.name && <div>• <span className="font-medium">{hotelObj.name}</span></div>}
                  {hotelObj?.area && <div>• Zona: {hotelObj.area}</div>}
                  {hotelObj?.address && <div>• Dirección: {hotelObj.address}</div>}
                  {hotelObj?.checkin && <div>• Check-in: {fmtDate(hotelObj.checkin)}</div>}
                  {hotelObj?.checkout && <div>• Check-out: {fmtDate(hotelObj.checkout)}</div>}
                  {hotelObj?.confirmation && <div>• Confirmación: {hotelObj.confirmation}</div>}
                  {/* Cualquier campo adicional del hotel */}
                  <KVPairs
                    obj={
                      hotelObj
                        ? Object.fromEntries(
                            Object.entries(hotelObj).filter(
                              ([k]) =>
                                ![
                                  'name',
                                  'area',
                                  'address',
                                  'checkin',
                                  'checkout',
                                  'confirmation',
                                  'style',
                                ].includes(k),
                            ),
                          )
                        : {}
                    }
                  />
                </div>
              )}
            </div>
          )}

          {/* Transporte (si viene) */}
          {has(current.transports) && (
            <div className="mt-5">
              <div className="font-medium text-neutral-900 mb-2">Transporte</div>
              {Array.isArray(current.transports) ? (
                <div className="space-y-2">
                  {current.transports.map((t: any, i: number) =>
                    typeof t === 'string' ? (
                      <div key={i} className="text-[13px] text-neutral-800">• {t}</div>
                    ) : (
                      <div key={i} className="rounded-xl bg-black/[0.03] p-3 text-[13px]">
                        <KVPairs obj={(t || {}) as AnyObj} />
                      </div>
                    )
                  )}
                </div>
              ) : (
                <div className="text-[13px] text-neutral-800">{String(current.transports)}</div>
              )}
            </div>
          )}

          {/* Notas */}
          {has(current.notes) && (
            <div className="mt-5">
              <div className="font-medium text-neutral-900 mb-2">Notas</div>
              <div className="text-[13px] text-neutral-800">{current.notes}</div>
            </div>
          )}

          {/* Cualquier otro campo del día (para no discriminar nada) */}
          {(() => {
            const omit = new Set([
              'day','date','title','subtitle','notes',
              'locations','weather','transports','activities','hotel'
            ]);
            const extra: AnyObj = {};
            for (const [k, v] of Object.entries(current || {})) {
              if (!omit.has(k) && has(v)) extra[k] = v;
            }
            if (!has(extra)) return null;
            return (
              <div className="mt-5">
                <div className="font-medium text-neutral-900 mb-2">Detalles adicionales</div>
                <div className="rounded-xl bg-black/[0.03] p-3">
                  <KVPairs obj={extra} />
                </div>
              </div>
            );
          })()}
        </div>

        {/* FOOTER: navegación por días, estilo “pill” */}
        {days.length > 0 && (
          <div
            className="sticky bottom-3 mx-4 mb-4 rounded-full shadow-xl bg-neutral-900 text-white flex items-center justify-between px-3 py-2"
            style={{ insetInline: '1rem' }}
          >
            <button
              onClick={() => setIdx((p) => Math.max(0, p - 1))}
              disabled={idx === 0}
              className="h-9 w-9 rounded-full bg-white/10 disabled:opacity-40 flex items-center justify-center"
              aria-label="Día anterior"
              title="Día anterior"
            >
              ‹
            </button>
            <div className="px-3 text-[13px]">
              Día <span className="font-semibold">{Math.min(idx + 1, days.length)}</span> de {days.length}
            </div>
            <button
              onClick={() => setIdx((p) => Math.min(days.length - 1, p + 1))}
              disabled={idx >= days.length - 1}
              className="h-9 w-9 rounded-full bg-white/10 disabled:opacity-40 flex items-center justify-center"
              aria-label="Día siguiente"
              title="Día siguiente"
            >
              ›
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
