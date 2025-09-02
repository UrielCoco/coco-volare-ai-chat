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
  cardType?: string; // ignoramos si llega
  lang?: 'es'|'en'|string; tripTitle?: string; clientBooksLongHaulFlights?: boolean;
  disclaimer?: string; summary?: Summary; days: Day[];
};

/** ================== Utilidades ================== **/
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
  return <span className="inline-flex items-center rounded-full bg-neutral-800/80 text-white px-2 py-1 text-xs mr-2 mb-2">{children}</span>;
}
function Section({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <div className="mt-4">
      <div className="flex items-center gap-2 text-[15px] font-semibold text-white">
        <span>{icon}</span><span>{title}</span>
      </div>
      <div className="mt-2">{children}</div>
    </div>
  );
}
function KVP({ k, v }: { k: string; v?: React.ReactNode }) {
  if (!v && v !== 0) return null;
  return (
    <div className="flex items-start gap-2 text-sm text-neutral-200">
      <div className="min-w-[110px] text-neutral-400">{k}</div>
      <div className="flex-1">{v}</div>
    </div>
  );
}
function Divider() { return <div className="h-px bg-neutral-800 my-4" />; }

/** ================== Paginación ================== **/
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

/** ================== Vista de páginas ================== **/
function SummaryPage({ it }: { it: Itinerary }) {
  const summary = it.summary || {};
  return (
    <div className="px-5 py-5">
      <div className="text-xl font-semibold text-white">{it.tripTitle || summary.destination || 'Itinerario'}</div>
      {summary.overview && <div className="text-sm text-neutral-300 mt-2 whitespace-pre-wrap">{summary.overview}</div>}

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

      <div className="text-[13px] text-neutral-400">
        {it.disclaimer || '*Fechas, horarios y proveedores sujetos a disponibilidad y cambios sin previo aviso.'}
      </div>
    </div>
  );
}

function DayPage({ d }: { d: Day }) {
  const activities: Activity[] = d.activities || d.timeline || [];
  return (
    <div className="px-5 py-5">
      <div className="flex items-center justify-between">
        <div className="text-base font-semibold text-white">Día {d.day}{d.title ? ` · ${d.title}` : ''}</div>
        <div className="text-xs text-neutral-400">{fmtDate(d.date)}</div>
      </div>

      {/* chips de ubicación / clima */}
      <div className="mt-2 flex flex-wrap">
        {(d.locations || []).map((loc, i) => (
          <Chip key={i}>📍 {loc.city}{loc.country ? `, ${loc.country}` : ''}</Chip>
        ))}
        {d.weather && (d.weather.summary || d.weather.icon) && (
          <Chip>{d.weather.icon || '⛅'} {d.weather.summary}</Chip>
        )}
      </div>

      {/* Vuelos internacionales */}
      {d.flightsInternational && d.flightsInternational.length > 0 && (
        <Section title="Vuelos internacionales" icon="🛫">
          <div className="space-y-2">
            {d.flightsInternational.map((f, i) => (
              <div key={i} className="rounded-lg bg-neutral-900/50 border border-neutral-800 p-3">
                <div className="text-sm font-medium text-white">{f.carrier} {f.code}</div>
                <KVP k="Ruta" v={`${f.from || ''} → ${f.to || ''}`} />
                <KVP k="Salida" v={fmtDateTime(f.depart)} />
                <KVP k="Llegada" v={fmtDateTime(f.arrive)} />
                <div className="flex flex-wrap gap-3 text-xs text-neutral-300 mt-1">
                  {f.baggage && <Chip>🧳 {f.baggage}</Chip>}
                  {f.pnr && <Chip>🔖 PNR {f.pnr}</Chip>}
                </div>
                {f.notes && <div className="text-xs text-neutral-300 mt-2 whitespace-pre-wrap">{f.notes}</div>}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Vuelos domésticos */}
      {d.flightsDomestic && d.flightsDomestic.length > 0 && (
        <Section title="Vuelos domésticos" icon="🛩️">
          <div className="space-y-2">
            {d.flightsDomestic.map((f, i) => (
              <div key={i} className="rounded-lg bg-neutral-900/50 border border-neutral-800 p-3">
                <div className="text-sm font-medium text-white">{f.carrier} {f.code}</div>
                <KVP k="Ruta" v={`${f.from || ''} → ${f.to || ''}`} />
                <KVP k="Salida" v={fmtDateTime(f.depart)} />
                <KVP k="Llegada" v={fmtDateTime(f.arrive)} />
                {f.notes && <div className="text-xs text-neutral-300 mt-2 whitespace-pre-wrap">{f.notes}</div>}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Transportes */}
      {d.transports && d.transports.length > 0 && (
        <Section title="Transportes" icon="🚐">
          <div className="space-y-2">
            {d.transports.map((t, i) => (
              <div key={i} className="rounded-lg bg-neutral-900/50 border border-neutral-800 p-3 text-sm">
                <div className="font-medium text-white">{t.mode.toUpperCase()}</div>
                <KVP k="Ruta" v={`${t.from || ''}${t.to ? ` → ${t.to}` : ''}`} />
                <div className="flex flex-wrap gap-3 text-xs text-neutral-300 mt-1">
                  {t.time && <Chip>🕒 {t.time}</Chip>}
                  {t.duration && <Chip>⏱ {fmtDurationISO(t.duration)}</Chip>}
                  {t.provider && <Chip>🏷 {t.provider}</Chip>}
                </div>
                {t.notes && <div className="text-xs text-neutral-300 mt-2 whitespace-pre-wrap">{t.notes}</div>}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Hotel principal */}
      {d.hotel && (d.hotel.name || d.hotel.style || d.hotel.checkIn || d.hotel.checkOut) && (
        <Section title="Hotel" icon="🏨">
          <div className="rounded-lg bg-neutral-900/50 border border-neutral-800 p-3 text-sm">
            <div className="font-medium text-white">{d.hotel.name}</div>
            <div className="flex flex-wrap gap-3 text-xs text-neutral-300 mt-1">
              {d.hotel.area && <Chip>📍 {d.hotel.area}</Chip>}
              {d.hotel.style && <Chip>🏷 {d.hotel.style}</Chip>}
              {d.hotel.checkIn && <Chip>🛎 Check-in {fmtDateTime(d.hotel.checkIn)}</Chip>}
              {d.hotel.checkOut && <Chip>🔔 Check-out {fmtDateTime(d.hotel.checkOut)}</Chip>}
              {d.hotel.confirmation && <Chip>✅ {d.hotel.confirmation}</Chip>}
            </div>
          </div>
        </Section>
      )}

      {/* Opciones de hotel */}
      {d.hotelOptions && d.hotelOptions.length > 0 && (
        <Section title="Opciones de hotel" icon="🛏️">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {d.hotelOptions.map((h, i) => (
              <div key={i} className="rounded-lg bg-neutral-900/50 border border-neutral-800 p-3 text-sm">
                <div className="font-medium text-white">{h.name}</div>
                <div className="flex flex-wrap gap-3 text-xs text-neutral-300 mt-1">
                  {h.area && <Chip>📍 {h.area}</Chip>}
                  {h.style && <Chip>🏷 {h.style}</Chip>}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Actividades */}
      {activities && activities.length > 0 && (
        <Section title="Plan del día" icon="🧭">
          <div className="space-y-2">
            {activities.map((a, i) => (
              <div key={i} className="rounded-lg bg-neutral-900/50 border border-neutral-800 p-3 text-sm">
                <div className="flex flex-wrap gap-2 items-center">
                  {a.time && <Chip>🕒 {a.time}</Chip>}
                  <Chip>🏷 {a.category}</Chip>
                  {a.duration && <Chip>⏱ {fmtDurationISO(a.duration)}</Chip>}
                  {a.optional && <Chip>⚪ Opcional</Chip>}
                </div>
                <div className="mt-1 text-white font-medium">{a.title}</div>
                {a.location && <div className="text-xs text-neutral-300 mt-1">📍 {a.location}</div>}
                {a.notes && <div className="text-xs text-neutral-300 mt-2 whitespace-pre-wrap">{a.notes}</div>}
                {a.options && a.options.length > 0 && (
                  <div className="mt-2 pl-2 border-l border-neutral-700">
                    {a.options.map((op, j) => (
                      <div key={j} className="text-xs text-neutral-300">• <span className="font-medium text-neutral-200">{op.title}</span>{op.notes ? ` — ${op.notes}` : ''}</div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Servicios Adicionales */}
      {d.addOns && d.addOns.length > 0 && (
        <Section title="Servicios adicionales" icon="✨">
          <div className="space-y-2">
            {d.addOns.map((s, i) => (
              <div key={i} className="rounded-lg bg-neutral-900/50 border border-neutral-800 p-3 text-sm">
                <div className="text-white font-medium">{s.title}</div>
                <div className="flex flex-wrap gap-3 text-xs text-neutral-300 mt-1">
                  {s.time && <Chip>🕒 {s.time}</Chip>}
                  {s.duration && <Chip>⏱ {fmtDurationISO(s.duration)}</Chip>}
                  {s.provider && <Chip>🏷 {s.provider}</Chip>}
                </div>
                {(s.description || s.note) && (
                  <div className="text-xs text-neutral-300 mt-2 whitespace-pre-wrap">
                    {s.description}{s.description && s.note ? ' — ' : ''}{s.note}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

/** ================== Componente principal ================== **/
export default function ItineraryCard({ data }: { data: Itinerary | any }) {
  // Permitir string JSON
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
    <div className="rounded-2xl bg-neutral-900 text-neutral-100 shadow-lg border border-neutral-800 overflow-hidden">
      {/* HEADER con logo y paginador */}
      <div className="px-5 py-4 border-b border-neutral-800 bg-neutral-900/70 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img
            src="/images/logo-coco-volare.png"
            alt="Coco Volare"
            className="h-6 w-auto select-none"
            draggable={false}
          />
          <div>
            <div className="text-lg font-semibold text-white leading-tight">
              {it.tripTitle || summary.destination || 'Itinerario'}
            </div>
            {summary.startDate && summary.endDate && (
              <div className="text-xs text-neutral-400">
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
            className="h-8 w-8 rounded-full bg-neutral-800 text-white/90 hover:bg-neutral-700 transition flex items-center justify-center"
            aria-label="Anterior"
          >‹</button>
          <div className="text-sm text-neutral-300 min-w-[8rem] text-center">{pageLabel}</div>
          <button
            onClick={next}
            className="h-8 w-8 rounded-full bg-neutral-800 text-white/90 hover:bg-neutral-700 transition flex items-center justify-center"
            aria-label="Siguiente"
          >›</button>
        </div>
      </div>

      {/* BODY: páginas */}
      <div className="relative">
        {/* carrusel simple (slide) */}
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

        {/* Dots / pills de navegación */}
        <div className="px-5 pb-4 flex flex-wrap gap-2 items-center justify-center">
          <button
            onClick={() => goto(0)}
            className={`px-3 py-1 rounded-full text-xs border ${page === 0 ? 'bg-white text-black border-white' : 'bg-neutral-900 border-neutral-700 text-neutral-200 hover:bg-neutral-800'}`}
          >
            Resumen
          </button>
          {days.map((d, i) => (
            <button
              key={i}
              onClick={() => goto(i + 1)}
              className={`px-3 py-1 rounded-full text-xs border ${page === i + 1 ? 'bg-white text-black border-white' : 'bg-neutral-900 border-neutral-700 text-neutral-200 hover:bg-neutral-800'}`}
              title={d.title || `Día ${d.day}`}
            >
              Día {d.day || i + 1}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
