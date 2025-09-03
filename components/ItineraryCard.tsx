'use client';

import React, { useEffect, useMemo, useState } from 'react';

/** ================== Tipos ================== **/
type Pax = { adults: number; children?: number; infants?: number };
type Budget = { currency: string; amountMin?: number; amountMax?: number };
type Location = { city: string; country?: string };
type Weather = {
  tempCmin?: number; tempCmax?: number;
  tempFmin?: number; tempFmax?: number;
  humidity?: number; icon?: string; summary?: string;
};
type Flight = {
  carrier?: string; code?: string; from?: string; to?: string;
  depart?: string; arrive?: string; baggage?: string; pnr?: string; notes?: string;
};
type Transport = {
  mode: 'car'|'van'|'bus'|'train'|'boat'|'helicopter'|'other';
  provider?: string; from?: string; to?: string; time?: string; duration?: string; notes?: string;
};
type ActivityOption = { title: string; notes?: string };
type Activity = {
  time?: string; category: 'activity'|'meal'|'transfer'|'flight'|'hotel'|'free'|'other';
  title: string; location?: string; duration?: string; optional?: boolean; notes?: string; options?: ActivityOption[];
};
type Hotel = { name?: string; area?: string; style?: string; checkIn?: string; checkOut?: string; confirmation?: string; };

type Day = {
  day: number; date?: string; title?: string; locations?: Location[]; weather?: Weather;
  flightsInternational?: Flight[]; flightsDomestic?: Flight[]; transports?: Transport[];
  hotel?: Hotel; hotelOptions?: Hotel[]; activities?: Activity[]; timeline?: Activity[];
  addOns?: { title: string; description?: string; provider?: string; time?: string; duration?: string; note?: string }[];
};

type Summary = {
  destination?: string; startDate?: string; endDate?: string; nights?: number;
  pax?: Pax; theme?: string[]; budget?: Budget; overview?: string;
};

type Itinerary = {
  cardType?: string;
  lang?: 'es'|'en'|string; tripTitle?: string; clientBooksLongHaulFlights?: boolean;
  disclaimer?: string; summary?: Summary; days: Day[];
};

/** ================== Estilos/base ================== **/
const GOLD = '#bba36d';
const GOLD_SOFT_BG = '#f7f2e2';
const BLACK = '#000000';
const TEXT_DIM = 'text-neutral-600';

function safe<T>(v: any, fallback: T): T { return (v === undefined || v === null) ? fallback : v; }

function fmtDate(d?: string) {
  if (!d) return '';
  try {
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return d;
    return dt.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch { return d; }
}
function fmtTime(input?: string) {
  if (!input) return '';
  const tryIso = Date.parse(input);
  if (!isNaN(tryIso)) {
    const dt = new Date(tryIso);
    return dt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  const m = /^(\d{1,2}):(\d{2})$/.exec(input);
  return m ? `${m[1].padStart(2,'0')}:${m[2]}` : input;
}
function fmtDateTime(d?: string) { // (se queda por compat)
  if (!d) return '';
  try {
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return d;
    return dt.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return d; }
}
function fmtDurationISO(iso?: string) {
  if (!iso) return '';
  const m = /^P(?:T(?:(\d+)H)?(?:(\d+)M)?)$/i.exec(iso);
  if (!m) return iso;
  const h = m[1] ? parseInt(m[1]) : 0;
  const min = m[2] ? parseInt(m[2]) : 0;
  if (h && min) return `${h}h ${min}m`;
  if (h) return `${h}h`;
  if (min) return `${min}m`;
  return '0m';
}
function formatMoney(currency: string = 'USD', value?: number) {
  if (value === undefined || value === null || isNaN(value)) return '';
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(value);
  } catch {
    return `${currency} ${value}`;
  }
}

/** ================== Chips (sin bordes) ================== **/
function Chip({ children, dark = false }: { children: React.ReactNode; dark?: boolean }) {
  const cls = dark
    ? 'bg-black/60 text-white/90 shadow-sm'
    : '';
  const style = dark
    ? {}
    : { background: GOLD_SOFT_BG, color: '#5d4f25', boxShadow: '0 1px 0 rgba(0,0,0,0.04)' };
  return (
    <span className={`inline-flex items-center px-2.5 py-1 text-xs mr-2 mb-2 rounded-full ${cls}`} style={style}>
      {children}
    </span>
  );
}
function Divider() { return <div className="h-px my-4" style={{ background: '#e7e5e4' }} />; }

/** ================== Pager ================== **/
function usePager(total: number) {
  const [page, setPage] = useState(0);
  const next = () => setPage(p => Math.min(total - 1, p + 1));
  const prev = () => setPage(p => Math.max(0, p - 1));
  const goto = (i: number) => setPage(Math.max(0, Math.min(total - 1, i)));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') next();
      if (e.key === 'ArrowLeft') prev();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [total]);

  return { page, next, prev, goto, setPage };
}

/** ================== Helpers Summary ================== **/
function uniqueCities(days: Day[]): number {
  const set = new Set<string>();
  for (const d of days) {
    for (const l of (d.locations || [])) set.add(`${l.city || ''}|${l.country || ''}`);
  }
  return set.size;
}

/** ================== Summary (hero blanco/negro + dorado, sin bordes) ================== **/
function SummaryPage({ it }: { it: Itinerary }) {
  const summary = it.summary || {};
  const daysCount = safe(it.days, []).length || (summary.nights ? summary.nights + 1 : 0);
  const cities = uniqueCities(safe(it.days, []));
  const currency = summary.budget?.currency || 'USD';
  const estimate = summary.budget?.amountMax ?? summary.budget?.amountMin;

  return (
    <div className="pb-5">
      {/* Hero con recorte curvo */}
      <div className="relative rounded-t-2xl overflow-hidden">
        <img
          src="/images/Palms.jpg"
          alt="Destino"
          className="w-full h-56 sm:h-64 md:h-80 object-cover"
          draggable={false}
        />

        {/* Curva blanca inferior */}
        <svg className="absolute bottom-0 left-0 w-full h-20 sm:h-24" viewBox="0 0 1440 320" preserveAspectRatio="none">
          <path d="M0,192 C240,256 480,288 720,272 C960,256 1200,192 1440,224 L1440,360 L0,360 Z" fill="#ffffff" />
        </svg>

        {/* Logo pill (sin borde) */}
        <div className="absolute top-3 left-3">
          <div className="flex items-center gap-2 rounded-full px-3 py-1 bg-white/90 shadow">
            <img src="/images/logo-coco-volare.png" alt="Coco Volare" className="h-6 w-auto select-none" draggable={false} />
            <span className="text-xs font-medium text-neutral-800">Coco Volare Intelligence</span>
          </div>
        </div>

        {/* Texto overlay */}
        <div className="absolute left-4 sm:left-6 bottom-5 sm:bottom-8 text-white drop-shadow">
          <div className="flex items-center gap-2 mb-2">
            <Chip dark>🛏 {daysCount || '—'} {daysCount === 1 ? 'DÍA' : 'DÍAS'}</Chip>
            <Chip dark>📍 {cities || '—'} {cities === 1 ? 'CIUDAD' : 'CIUDADES'}</Chip>
          </div>
          <div className="text-2xl sm:text-3xl font-semibold">
            {it.tripTitle || summary.destination || 'Itinerary'}
          </div>
          {summary.overview && (
            <div className="text-sm sm:text-base mt-1 max-w-xl opacity-90">
              {summary.overview}
            </div>
          )}
        </div>

        {/* Precio (pill dorado) */}
        {estimate !== undefined && (
          <div className="absolute right-4 bottom-5 sm:bottom-6">
            <div
              className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-semibold shadow"
              style={{ background: GOLD, color: '#111827' }}
            >
              Estimado {formatMoney(currency, estimate)}
            </div>
          </div>
        )}
      </div>

      {/* Meta + disclaimer (sin bordes) */}
      <div className="px-4 sm:px-5 -mt-5">
        <div className="rounded-xl bg-white p-4 shadow-sm">
          <div className="flex flex-wrap gap-2 text-[13px] sm:text-sm">
            {summary.startDate && summary.endDate && (
              <Chip>🗓 {fmtDate(summary.startDate)} – {fmtDate(summary.endDate)}{summary.nights ? ` • ${summary.nights} noches` : ''}</Chip>
            )}
            {summary.pax && (
              <Chip>👥 {summary.pax.adults} adultos{summary.pax.children ? `, ${summary.pax.children} niños` : ''}{summary.pax.infants ? `, ${summary.pax.infants} inf.` : ''}</Chip>
            )}
            {summary.theme && summary.theme.length > 0 && <Chip>🎯 {summary.theme.join(' · ')}</Chip>}
            {summary.budget && (summary.budget.amountMin || summary.budget.amountMax) && (
              <Chip>💰 {summary.budget.currency} {summary.budget.amountMin ?? ''}{summary.budget.amountMax ? ` – ${summary.budget.amountMax}` : ''}</Chip>
            )}
            {it.clientBooksLongHaulFlights && <Chip>✈️ Largos vuelos por cuenta del cliente</Chip>}
          </div>

          <Divider />

          <div className="text-[12px] sm:text-[13px] text-neutral-500">
            {it.disclaimer || '*Fechas, horarios y proveedores sujetos a disponibilidad y cambios sin previo aviso.'}
          </div>
        </div>
      </div>
    </div>
  );
}

/** ================== Timeline ================== **/
type TItem = {
  timeSort: number;
  timeText?: string;
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  note?: string;
};

function timeToMinutes(t?: string) {
  if (!t) return Number.POSITIVE_INFINITY;
  const ms = Date.parse(t);
  if (!isNaN(ms)) {
    const d = new Date(ms);
    return d.getHours() * 60 + d.getMinutes();
  }
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (m) return parseInt(m[1]) * 60 + parseInt(m[2]);
  return Number.POSITIVE_INFINITY;
}

function collectTimeline(d: Day): TItem[] {
  const items: TItem[] = [];

  const addFlight = (f: Flight) => {
    if (f.depart) {
      items.push({
        timeSort: timeToMinutes(f.depart),
        timeText: fmtTime(f.depart),
        title: `${f.carrier || 'Vuelo'} ${f.code || ''} · Salida`,
        subtitle: `${f.from || ''} → ${f.to || ''}`,
        right: (
          <div className="text-[10px] text-neutral-500">
            {f.baggage && `🧳 ${f.baggage}`} {f.pnr && ` · PNR ${f.pnr}`}
          </div>
        ),
        note: f.notes,
      });
    }
    if (f.arrive) {
      items.push({
        timeSort: timeToMinutes(f.arrive),
        timeText: fmtTime(f.arrive),
        title: `${f.carrier || 'Vuelo'} ${f.code || ''} · Llegada`,
        subtitle: `${f.to || ''}`,
      });
    }
  };
  (d.flightsInternational || []).forEach(addFlight);
  (d.flightsDomestic || []).forEach(addFlight);

  (d.transports || []).forEach(t => {
    items.push({
      timeSort: timeToMinutes(t.time),
      timeText: fmtTime(t.time),
      title: `${(t.mode || 'Transporte').toUpperCase()}${t.provider ? ` · ${t.provider}` : ''}`,
      subtitle: `${t.from || ''}${t.to ? ` → ${t.to}` : ''}${t.duration ? ` · ${fmtDurationISO(t.duration)}` : ''}`,
      note: t.notes,
    });
  });

  if (d.hotel?.checkIn) {
    items.push({
      timeSort: timeToMinutes(d.hotel.checkIn),
      timeText: fmtTime(d.hotel.checkIn),
      title: `Check-in · ${d.hotel.name || 'Hotel'}`,
      subtitle: `${d.hotel.area || ''}${d.hotel.style ? ` · ${d.hotel.style}` : ''}`,
      right: d.hotel.confirmation ? <span className="text-[10px] text-neutral-500">Conf: {d.hotel.confirmation}</span> : undefined,
    });
  }
  if (d.hotel?.checkOut) {
    items.push({
      timeSort: timeToMinutes(d.hotel.checkOut),
      timeText: fmtTime(d.hotel.checkOut),
      title: `Check-out · ${d.hotel.name || 'Hotel'}`,
      subtitle: `${d.hotel.area || ''}`,
    });
  }

  const acts: Activity[] = d.activities || d.timeline || [];
  acts.forEach(a => {
    items.push({
      timeSort: timeToMinutes(a.time),
      timeText: fmtTime(a.time),
      title: `${a.title}${a.category ? ` · ${a.category}` : ''}${a.duration ? ` · ${fmtDurationISO(a.duration)}` : ''}${a.optional ? ' · Opcional' : ''}`,
      subtitle: a.location,
      note: a.notes,
    });
  });

  (d.addOns || []).forEach(s => {
    items.push({
      timeSort: timeToMinutes(s.time),
      timeText: fmtTime(s.time),
      title: `${s.title}${s.duration ? ` · ${fmtDurationISO(s.duration)}` : ''}`,
      subtitle: s.provider,
      note: s.description || s.note,
    });
  });

  items.sort((a, b) => a.timeSort - b.timeSort);
  return items;
}

function TimelineItem({ it }: { it: TItem }) {
  return (
    <div className="relative flex gap-3 sm:gap-4">
      {/* Hora */}
      <div className="w-10 sm:w-14 shrink-0 text-right text-[11px] sm:text-xs font-medium text-neutral-800 pt-3">
        {it.timeText || '—'}
      </div>

      {/* Línea vertical + pin (sin border, con sombras) */}
      <div className="relative">
        <div className="absolute left-1.5 top-0 bottom-0 w-[2px]" style={{ background: GOLD }} />
        <div
          className="absolute -left-1 top-3 h-3 w-3 rounded-full"
          style={{ background: GOLD, boxShadow: '0 0 0 2px #ffffff, 0 0 0 4px ' + GOLD }}
        />
      </div>

      {/* Tarjeta (sin bordes) */}
      <div className="flex-1">
        <div className="rounded-xl bg-white p-3 sm:p-3.5 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[14.5px] sm:text-[15px] font-semibold text-neutral-900">{it.title}</div>
              {it.subtitle && <div className="text-[11.5px] sm:text-xs text-neutral-600 mt-0.5">{it.subtitle}</div>}
            </div>
            {it.right}
          </div>
          {it.note && <div className="text-[11.5px] sm:text-xs text-neutral-600 mt-2">{it.note}</div>}
        </div>
      </div>
    </div>
  );
}

function DayPage({ d }: { d: Day }) {
  const items = collectTimeline(d);
  return (
    <div className="px-4 sm:px-5 py-4 sm:py-5">
      {/* Encabezado del día */}
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="text-[10px] sm:text-[11px] tracking-wider text-neutral-500">DÍA {d.day}</div>
          <div className="text-base sm:text-lg font-semibold text-neutral-900">
            {d.title || 'Plan del día'}
          </div>
        </div>
        <div className="text-[11.5px] sm:text-xs text-neutral-500">{fmtDate(d.date)}</div>
      </div>

      {/* Chips ubicación y clima */}
      <div className="mb-4 flex flex-wrap">
        {(d.locations || []).map((l, i) => (
          <Chip key={i}>📍 {l.city}{l.country ? `, ${l.country}` : ''}</Chip>
        ))}
        {d.weather && (d.weather.summary || d.weather.icon) && (
          <Chip>{d.weather.icon || '⛅'} {d.weather.summary}</Chip>
        )}
      </div>

      {/* Timeline */}
      <div className="space-y-3">
        {items.length === 0 ? (
          <div className={`text-sm ${TEXT_DIM}`}>Sin actividades registradas para este día.</div>
        ) : (
          items.map((ti, i) => <TimelineItem key={i} it={ti} />)
        )}
      </div>
    </div>
  );
}

/** ================== Componente principal ================== **/
export default function ItineraryCard({ data }: { data: Itinerary | any }) {
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch {}
  }
  const it: Itinerary = data || { days: [] };
  const summary = it.summary || {};
  const days: Day[] = safe(it.days, []);
  const totalPages = 1 + days.length;

  const { page, next, prev, goto } = usePager(totalPages);

  const pageLabel = useMemo(() => {
    if (page === 0) return 'Resumen';
    const d = days[page - 1];
    return `Día ${d?.day || page}`;
  }, [page, days]);

  return (
    <div className="rounded-2xl bg-white shadow-xl overflow-hidden"> {/* sin bordes */}
      {/* HEADER (sin border-bottom) */}
      <div className="px-4 sm:px-5 py-3 sm:py-4 flex items-center justify-between bg-white">
        <div className="flex items-center gap-3 min-w-0">
          <img
            src="/images/logo-coco-volare.png"
            alt="Coco Volare"
            className="h-7 sm:h-8 w-auto select-none"
            draggable={false}
          />
          <div className="min-w-0">
            <div className="text-[15px] sm:text-lg font-semibold text-neutral-900 leading-tight truncate">
              {it.tripTitle || summary.destination || 'Itinerario'}
            </div>
            {summary.startDate && summary.endDate && (
              <div className={`text-[11.5px] sm:text-xs ${TEXT_DIM}`}>
                {fmtDate(summary.startDate)} – {fmtDate(summary.endDate)}
                {summary.nights ? ` • ${summary.nights} noches` : ''}
              </div>
            )}
          </div>
        </div>

        {/* Pager: botones negros con texto dorado */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          <button
            onClick={prev}
            className="h-8 w-8 rounded-full flex items-center justify-center shadow-sm hover:shadow-md"
            style={{ background: BLACK, color: GOLD }}
            aria-label="Anterior"
          >‹</button>
          <div className="text-[12.5px] sm:text-sm text-neutral-800 text-center px-1 truncate max-w-[9rem]">{pageLabel}</div>
          <button
            onClick={next}
            className="h-8 w-8 rounded-full flex items-center justify-center shadow-sm hover:shadow-md"
            style={{ background: BLACK, color: GOLD }}
            aria-label="Siguiente"
          >›</button>
        </div>
      </div>

      {/* BODY: carrusel por páginas */}
      <div className="relative">
        <div
          className="whitespace-nowrap transition-transform duration-300 ease-out"
          style={{ transform: `translateX(-${page * 100}%)` }}
        >
          {/* Página 0: Summary */}
          <div className="inline-block align-top w-full">
            <SummaryPage it={it} />
          </div>

          {/* Páginas 1..n */}
          {days.map((d, idx) => (
            <div key={`p-${idx}`} className="inline-block align-top w-full">
              <DayPage d={d} />
            </div>
          ))}
        </div>

        {/* Pills de navegación: negras con letra dorada, sin bordes */}
        <div className="px-4 sm:px-5 pb-4 sm:pb-5 flex flex-wrap gap-2 items-center justify-center">
          <button
            onClick={() => goto(0)}
            className="px-3 py-1 rounded-full text-xs shadow-sm hover:shadow-md"
            style={{ background: BLACK, color: GOLD }}
            title="Resumen"
          >
            Resumen
          </button>
          {days.map((d, i) => (
            <button
              key={i}
              onClick={() => goto(i + 1)}
              className="px-3 py-1 rounded-full text-xs shadow-sm hover:shadow-md"
              title={d.title || `Día ${d.day}`}
              style={{ background: BLACK, color: GOLD }}
            >
              Día {d.day || i + 1}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
