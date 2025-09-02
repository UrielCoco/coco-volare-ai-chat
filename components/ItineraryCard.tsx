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

/** ================== Utilidades ================== **/
const GOLD = '#bba36d';
const GOLD_SOFT_BG = '#f7f2e2';
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
function fmtDateTime(d?: string) {
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

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="inline-flex items-center px-2 py-1 text-xs mr-2 mb-2 rounded-full border"
      style={{ borderColor: GOLD, background: GOLD_SOFT_BG, color: '#5d4f25' }}
    >
      {children}
    </span>
  );
}

function Divider() { return <div className="h-px my-4" style={{ background: '#e7e5e4' }} />; }

function KVP({ k, v }: { k: string; v?: React.ReactNode }) {
  if (!v && v !== 0) return null;
  return (
    <div className={`flex items-start gap-2 text-sm ${TEXT_DIM}`}>
      <div className="min-w-[110px] text-neutral-500">{k}</div>
      <div className="flex-1">{v}</div>
    </div>
  );
}

/** =============== Helpers UI para “menos largo” =============== **/
function ExpandableSection({
  title, icon, children, defaultOpen = false,
}: { title: string; icon?: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="mt-3">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between py-2"
      >
        <div className="flex items-center gap-2 font-semibold text-[15px]">
          {icon && <span>{icon}</span>}
          <span className="text-neutral-900">{title}</span>
        </div>
        <span
          className="h-6 w-6 rounded-full flex items-center justify-center border"
          style={{ borderColor: GOLD, color: '#1f2937' }}
        >
          {open ? '–' : '+'}
        </span>
      </button>
      {open && (
        <div className="rounded-xl border p-3" style={{ borderColor: '#eceae6' }}>
          {children}
        </div>
      )}
    </div>
  );
}

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

/** ================== Páginas ================== **/
function SummaryPage({ it }: { it: Itinerary }) {
  const summary = it.summary || {};
  return (
    <div className="pb-5">
      {/* Hero responsivo */}
      <div className="w-full overflow-hidden rounded-t-2xl">
        <div className="relative w-full aspect-[16/9] md:aspect-[21/9]">
          <img
            src="/images/Palms.jpg"
            alt="Destino"
            className="absolute inset-0 w-full h-full object-cover"
            draggable={false}
          />
          {/* Overlay sutil para legibilidad */}
          <div className="absolute inset-0 bg-gradient-to-t from-white/90 via-white/40 to-transparent" />
        </div>
      </div>

      {/* Info principal */}
      <div className="px-5 -mt-10">
        <div className="rounded-xl border bg-white p-4 shadow-sm" style={{ borderColor: '#eceae6' }}>
          <div className="text-xl font-semibold text-neutral-900">
            {it.tripTitle || summary.destination || 'Itinerario'}
          </div>
          {summary.overview && (
            <div className="text-sm text-neutral-600 mt-2 whitespace-pre-wrap">
              {summary.overview}
            </div>
          )}

          <div className="flex flex-wrap gap-3 mt-3 text-sm">
            {summary.startDate && summary.endDate && (
              <Chip>🗓 {fmtDate(summary.startDate)} – {fmtDate(summary.endDate)}{summary.nights ? ` • ${summary.nights} noches` : ''}</Chip>
            )}
            {summary.pax && (
              <Chip>👥 {summary.pax.adults} adultos{summary.pax.children ? `, ${summary.pax.children} niños` : ''}{summary.pax.infants ? `, ${summary.pax.infants} inf.` : ''}</Chip>
            )}
            {summary.theme && summary.theme.length > 0 && <Chip>🎯 {summary.theme.join(' · ')}</Chip>}
            {summary.budget && <Chip>💰 {summary.budget.currency} {summary.budget.amountMin ?? ''}{summary.budget.amountMax ? ` – ${summary.budget.amountMax}` : ''}</Chip>}
            {it.clientBooksLongHaulFlights && <Chip>✈️ Largos vuelos por cuenta del cliente</Chip>}
          </div>

          <Divider />

          <div className="text-[13px] text-neutral-500">
            {it.disclaimer || '*Fechas, horarios y proveedores sujetos a disponibilidad y cambios sin previo aviso.'}
          </div>
        </div>
      </div>
    </div>
  );
}

function LimitedList<T>({ items, render, limit = 3, emptyText }: {
  items: T[]; render: (item: T, i: number) => React.ReactNode; limit?: number; emptyText?: string;
}) {
  const [open, setOpen] = useState(false);
  const show = open ? items : items.slice(0, limit);
  if (!items || items.length === 0) return emptyText ? <div className={`text-sm ${TEXT_DIM}`}>{emptyText}</div> : null;
  return (
    <div>
      <div className="space-y-2">{show.map(render)}</div>
      {items.length > limit && (
        <button
          onClick={() => setOpen(o => !o)}
          className="mt-2 text-sm underline"
          style={{ color: GOLD }}
        >
          {open ? 'Ver menos' : 'Ver más'}
        </button>
      )}
    </div>
  );
}

function FlightCard({ f }: { f: Flight }) {
  return (
    <div className="rounded-lg border p-3 text-sm bg-white" style={{ borderColor: '#eceae6' }}>
      <div className="font-medium text-neutral-900">{f.carrier} {f.code}</div>
      <KVP k="Ruta" v={`${f.from || ''} → ${f.to || ''}`} />
      <KVP k="Salida" v={fmtDateTime(f.depart)} />
      <KVP k="Llegada" v={fmtDateTime(f.arrive)} />
      <div className="flex flex-wrap gap-3 text-xs text-neutral-500 mt-1">
        {f.baggage && <Chip>🧳 {f.baggage}</Chip>}
        {f.pnr && <Chip>🔖 PNR {f.pnr}</Chip>}
      </div>
      {f.notes && <div className="text-xs text-neutral-600 mt-2 whitespace-pre-wrap">{f.notes}</div>}
    </div>
  );
}

function TransportCard({ t }: { t: Transport }) {
  return (
    <div className="rounded-lg border p-3 text-sm bg-white" style={{ borderColor: '#eceae6' }}>
      <div className="font-medium text-neutral-900">{t.mode.toUpperCase()}</div>
      <KVP k="Ruta" v={`${t.from || ''}${t.to ? ` → ${t.to}` : ''}`} />
      <div className="flex flex-wrap gap-3 text-xs text-neutral-600 mt-1">
        {t.time && <Chip>🕒 {t.time}</Chip>}
        {t.duration && <Chip>⏱ {fmtDurationISO(t.duration)}</Chip>}
        {t.provider && <Chip>🏷 {t.provider}</Chip>}
      </div>
      {t.notes && <div className="text-xs text-neutral-600 mt-2 whitespace-pre-wrap">{t.notes}</div>}
    </div>
  );
}

function ActivityCard({ a }: { a: Activity }) {
  return (
    <div className="rounded-lg border p-3 text-sm bg-white" style={{ borderColor: '#eceae6' }}>
      <div className="flex flex-wrap gap-2 items-center">
        {a.time && <Chip>🕒 {a.time}</Chip>}
        <Chip>🏷 {a.category}</Chip>
        {a.duration && <Chip>⏱ {fmtDurationISO(a.duration)}</Chip>}
        {a.optional && <Chip>⚪ Opcional</Chip>}
      </div>
      <div className="mt-1 text-neutral-900 font-medium">{a.title}</div>
      {a.location && <div className="text-xs text-neutral-600 mt-1">📍 {a.location}</div>}
      {a.notes && <div className="text-xs text-neutral-600 mt-2 whitespace-pre-wrap">{a.notes}</div>}
      {a.options && a.options.length > 0 && (
        <div className="mt-2 pl-2 border-l" style={{ borderColor: '#e7e5e4' }}>
          {a.options.map((op, j) => (
            <div key={j} className="text-xs text-neutral-600">• <span className="font-medium text-neutral-800">{op.title}</span>{op.notes ? ` — ${op.notes}` : ''}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function DayPage({ d }: { d: Day }) {
  const activities: Activity[] = d.activities || d.timeline || [];
  return (
    <div className="px-5 py-5">
      {/* Encabezado de día */}
      <div className="flex items-center justify-between">
        <div className="text-base font-semibold text-neutral-900">Día {d.day}{d.title ? ` · ${d.title}` : ''}</div>
        <div className={`text-xs ${TEXT_DIM}`}>{fmtDate(d.date)}</div>
      </div>

      {/* chips ubic/clima */}
      <div className="mt-2 flex flex-wrap">
        {(d.locations || []).map((loc, i) => (
          <Chip key={i}>📍 {loc.city}{loc.country ? `, ${loc.country}` : ''}</Chip>
        ))}
        {d.weather && (d.weather.summary || d.weather.icon) && (
          <Chip>{d.weather.icon || '⛅'} {d.weather.summary}</Chip>
        )}
      </div>

      {/* Secciones compactas y colapsables */}
      {d.flightsInternational && d.flightsInternational.length > 0 && (
        <ExpandableSection title="Vuelos internacionales" icon="🛫" defaultOpen={false}>
          <LimitedList items={d.flightsInternational} render={(f, i) => <FlightCard key={i} f={f} />} />
        </ExpandableSection>
      )}

      {d.flightsDomestic && d.flightsDomestic.length > 0 && (
        <ExpandableSection title="Vuelos domésticos" icon="🛩️" defaultOpen={false}>
          <LimitedList items={d.flightsDomestic} render={(f, i) => <FlightCard key={i} f={f} />} />
        </ExpandableSection>
      )}

      {d.transports && d.transports.length > 0 && (
        <ExpandableSection title="Transportes" icon="🚐" defaultOpen={false}>
          <LimitedList items={d.transports} render={(t, i) => <TransportCard key={i} t={t} />} />
        </ExpandableSection>
      )}

      {d.hotel && (d.hotel.name || d.hotel.style || d.hotel.checkIn || d.hotel.checkOut) && (
        <ExpandableSection title="Hotel" icon="🏨" defaultOpen={true}>
          <div className="rounded-lg border p-3 bg-white" style={{ borderColor: '#eceae6' }}>
            <div className="font-medium text-neutral-900">{d.hotel.name}</div>
            <div className="flex flex-wrap gap-3 text-xs text-neutral-600 mt-1">
              {d.hotel.area && <Chip>📍 {d.hotel.area}</Chip>}
              {d.hotel.style && <Chip>🏷 {d.hotel.style}</Chip>}
              {d.hotel.checkIn && <Chip>🛎 Check-in {fmtDateTime(d.hotel.checkIn)}</Chip>}
              {d.hotel.checkOut && <Chip>🔔 Check-out {fmtDateTime(d.hotel.checkOut)}</Chip>}
              {d.hotel.confirmation && <Chip>✅ {d.hotel.confirmation}</Chip>}
            </div>
          </div>
        </ExpandableSection>
      )}

      {d.hotelOptions && d.hotelOptions.length > 0 && (
        <ExpandableSection title="Opciones de hotel" icon="🛏️" defaultOpen={false}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {d.hotelOptions.map((h, i) => (
              <div key={i} className="rounded-lg border p-3 text-sm bg-white" style={{ borderColor: '#eceae6' }}>
                <div className="font-medium text-neutral-900">{h.name}</div>
                <div className="flex flex-wrap gap-3 text-xs text-neutral-600 mt-1">
                  {h.area && <Chip>📍 {h.area}</Chip>}
                  {h.style && <Chip>🏷 {h.style}</Chip>}
                </div>
              </div>
            ))}
          </div>
        </ExpandableSection>
      )}

      {activities && activities.length > 0 && (
        <ExpandableSection title="Plan del día" icon="🧭" defaultOpen={true}>
          <LimitedList items={activities} limit={3} render={(a, i) => <ActivityCard key={i} a={a} />} />
        </ExpandableSection>
      )}

      {d.addOns && d.addOns.length > 0 && (
        <ExpandableSection title="Servicios adicionales" icon="✨" defaultOpen={false}>
          <LimitedList
            items={d.addOns}
            render={(s, i) => (
              <div key={i} className="rounded-lg border p-3 text-sm bg-white" style={{ borderColor: '#eceae6' }}>
                <div className="text-neutral-900 font-medium">{s.title}</div>
                <div className="flex flex-wrap gap-3 text-xs text-neutral-600 mt-1">
                  {s.time && <Chip>🕒 {s.time}</Chip>}
                  {s.duration && <Chip>⏱ {fmtDurationISO(s.duration)}</Chip>}
                  {s.provider && <Chip>🏷 {s.provider}</Chip>}
                </div>
                {(s.description || s.note) && (
                  <div className="text-xs text-neutral-600 mt-2 whitespace-pre-wrap">
                    {s.description}{s.description && s.note ? ' — ' : ''}{s.note}
                  </div>
                )}
              </div>
            )}
          />
        </ExpandableSection>
      )}
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
    <div
      className="rounded-2xl bg-white shadow-xl overflow-hidden"
      style={{ border: `2px solid ${GOLD}` }}
    >
      {/* HEADER con logo y paginador */}
      <div
        className="px-5 py-4 flex items-center justify-between"
        style={{ borderBottom: `1px solid ${GOLD}` }}
      >
        <div className="flex items-center gap-3">
          <img
            src="/images/logo-coco-volare.png"
            alt="Coco Volare"
            className="h-7 w-auto select-none"
            draggable={false}
          />
          <div>
            <div className="text-lg font-semibold text-neutral-900 leading-tight">
              {it.tripTitle || summary.destination || 'Itinerario'}
            </div>
            {summary.startDate && summary.endDate && (
              <div className={`text-xs ${TEXT_DIM}`}>
                {fmtDate(summary.startDate)} – {fmtDate(summary.endDate)}
                {summary.nights ? ` • ${summary.nights} noches` : ''}
              </div>
            )}
          </div>
        </div>

        {/* Pager */}
        <div className="flex items-center gap-2">
          <button
            onClick={prev}
            className="h-8 w-8 rounded-full flex items-center justify-center shadow-sm hover:shadow border text-neutral-700"
            style={{ borderColor: GOLD, background: 'white' }}
            aria-label="Anterior"
          >‹</button>
          <div className="text-sm text-neutral-700 min-w-[8rem] text-center">{pageLabel}</div>
          <button
            onClick={next}
            className="h-8 w-8 rounded-full flex items-center justify-center shadow-sm hover:shadow border text-neutral-700"
            style={{ borderColor: GOLD, background: 'white' }}
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

          {/* Páginas 1..n: por día */}
          {days.map((d, idx) => (
            <div key={`p-${idx}`} className="inline-block align-top w-full">
              <DayPage d={d} />
            </div>
          ))}
        </div>

        {/* Pills de navegación */}
        <div className="px-5 pb-5 flex flex-wrap gap-2 items-center justify-center">
          <button
            onClick={() => goto(0)}
            className="px-3 py-1 rounded-full text-xs border shadow-sm"
            style={{
              borderColor: GOLD,
              background: page === 0 ? GOLD : 'white',
              color: page === 0 ? 'white' : '#1f2937',
            }}
          >
            Resumen
          </button>
          {days.map((d, i) => (
            <button
              key={i}
              onClick={() => goto(i + 1)}
              className="px-3 py-1 rounded-full text-xs border shadow-sm"
              title={d.title || `Día ${d.day}`}
              style={{
                borderColor: GOLD,
                background: page === i + 1 ? GOLD : 'white',
                color: page === i + 1 ? 'white' : '#1f2937',
              }}
            >
              Día {d.day || i + 1}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
