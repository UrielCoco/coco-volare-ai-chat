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
function fmtTime(d?: string) {
  if (!d) return '';
  try {
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return d;
    return dt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
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
function formatMoney(currency: string = 'USD', value?: number) {
  if (value === undefined || value === null || isNaN(value)) return '';
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(value);
  } catch {
    return `${currency} ${value}`;
  }
}

/** ================== Chips & helpers UI ================== **/
function Chip({ children, dark = false }: { children: React.ReactNode; dark?: boolean }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-1 text-xs mr-2 mb-2 rounded-full border ${dark ? 'bg-black/50 text-white/90 border-white/30' : ''}`}
      style={!dark ? { borderColor: GOLD, background: GOLD_SOFT_BG, color: '#5d4f25' } : {}}
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

/** =============== Helpers layout =============== **/
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

function uniqueCities(days: Day[]): number {
  const set = new Set<string>();
  for (const d of days) {
    for (const l of (d.locations || [])) set.add(`${l.city || ''}|${l.country || ''}`);
  }
  return set.size;
}

/** =============== Banner Cards para el look “imagen 2” =============== **/
function BannerCard({
  image = '/images/Palms.jpg',
  title,
  subtitle,
  tags = [],
  rightTag,
  onClick,
}: {
  image?: string;
  title: string;
  subtitle?: string;
  tags?: React.ReactNode[];
  rightTag?: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full overflow-hidden rounded-xl shadow-sm hover:shadow transition"
      style={{ border: `1px solid ${GOLD}33`, background: '#fff' }}
    >
      <div className="relative w-full h-36 md:h-40 rounded-xl overflow-hidden">
        <img src={image} alt="" className="absolute inset-0 w-full h-full object-cover" draggable={false} />
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent" />
        <div className="absolute left-3 right-3 bottom-3">
          <div className="text-white text-sm opacity-90">{subtitle}</div>
          <div className="text-white text-lg font-semibold leading-tight">{title}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {tags.map((t, i) => (
              <Chip key={i} dark>{t}</Chip>
            ))}
            {rightTag && (
              <span className="ml-auto inline-flex items-center px-2 py-1 text-xs rounded-full bg-white/90 text-neutral-900">
                {rightTag}
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}

/** ================== Páginas ================== **/
function SummaryPage({ it }: { it: Itinerary }) {
  const summary = it.summary || {};
  const daysCount = safe(it.days, []).length || (summary.nights ? summary.nights + 1 : 0);
  const cities = uniqueCities(safe(it.days, []));
  const currency = summary.budget?.currency || 'USD';
  const estimate = summary.budget?.amountMax ?? summary.budget?.amountMin;

  return (
    <div className="pb-5">
      {/* HERO */}
      <div className="relative w-full overflow-hidden rounded-t-2xl">
        <div className="relative w-full aspect-[16/9] md:aspect-[21/9]">
          <img
            src="/images/Palms.jpg"
            alt="Destino"
            className="absolute inset-0 w-full h-full object-cover"
            draggable={false}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />

          {/* Overlay inferior (texto como en referencia 1) */}
          <div className="absolute left-4 right-4 bottom-4">
            <div className="flex items-center gap-2 mb-2">
              <Chip dark>🛏 {daysCount || '—'} {daysCount === 1 ? 'DÍA' : 'DÍAS'}</Chip>
              <Chip dark>📍 {cities || '—'} {cities === 1 ? 'CIUDAD' : 'CIUDADES'}</Chip>
            </div>
            <div className="text-white text-2xl md:text-3xl font-semibold leading-tight drop-shadow">
              {it.tripTitle || summary.destination || 'Itinerary'}
            </div>
            {summary.overview && (
              <div className="text-white/90 text-sm md:text-base mt-1 max-w-2xl">
                {summary.overview}
              </div>
            )}

            {estimate !== undefined && (
              <div className="absolute right-0 -bottom-2 translate-y-full md:translate-y-0 md:static md:mt-2">
                <div className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-semibold shadow"
                     style={{ background: GOLD, color: '#111827' }}>
                  Estimado {formatMoney(currency, estimate)}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Meta + disclaimer en tarjeta blanca */}
      <div className="px-5 -mt-3">
        <div className="rounded-xl border bg-white p-4 shadow-sm" style={{ borderColor: '#eceae6' }}>
          <div className="flex flex-wrap gap-2 text-sm">
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

          <div className="text-[13px] text-neutral-500">
            {it.disclaimer || '*Fechas, horarios y proveedores sujetos a disponibilidad y cambios sin previo aviso.'}
          </div>
        </div>
      </div>
    </div>
  );
}

function DayPage({ d }: { d: Day }) {
  const activities: Activity[] = d.activities || d.timeline || [];
  const loc = (d.locations && d.locations[0]) || undefined;

  return (
    <div className="px-5 py-5">
      {/* Encabezado del día (look compacto) */}
      <div className="flex items-center justify-between mb-2">
        <div>
          <div className="text-[11px] tracking-wider text-neutral-500">DÍA {d.day}</div>
          <div className="text-base md:text-lg font-semibold text-neutral-900">
            {d.title || (loc ? `${loc.city}${loc.country ? `, ${loc.country}` : ''}` : 'Plan del día')}
          </div>
        </div>
        <div className="text-xs text-neutral-500">{fmtDate(d.date)}</div>
      </div>

      {/* Chips de ubicación / clima */}
      <div className="mb-3 flex flex-wrap">
        {(d.locations || []).map((l, i) => (
          <Chip key={i}>📍 {l.city}{l.country ? `, ${l.country}` : ''}</Chip>
        ))}
        {d.weather && (d.weather.summary || d.weather.icon) && (
          <Chip>{d.weather.icon || '⛅'} {d.weather.summary}</Chip>
        )}
      </div>

      {/* Vuelos internacionales en formato “banner” */}
      {(d.flightsInternational && d.flightsInternational.length > 0) && (
        <div className="mb-3">
          <div className="text-sm font-semibold mb-2">Vuelos internacionales</div>
          <div className="space-y-2">
            {d.flightsInternational.map((f, i) => (
              <BannerCard
                key={i}
                title={`${f.carrier || 'Aerolínea'} ${f.code || ''}`.trim()}
                subtitle={`${f.from || ''} → ${f.to || ''}`}
                tags={[
                  f.depart ? <>Salida {fmtTime(f.depart)}</> : null,
                  f.arrive ? <>Llegada {fmtTime(f.arrive)}</> : null,
                  f.baggage ? <>🧳 {f.baggage}</> : null,
                  f.pnr ? <>🔖 {f.pnr}</> : null,
                ].filter(Boolean) as React.ReactNode[]}
                rightTag={d.weather?.icon}
              />
            ))}
          </div>
        </div>
      )}

      {/* Vuelos domésticos */}
      {(d.flightsDomestic && d.flightsDomestic.length > 0) && (
        <div className="mb-3">
          <div className="text-sm font-semibold mb-2">Vuelos domésticos</div>
          <div className="space-y-2">
            {d.flightsDomestic.map((f, i) => (
              <BannerCard
                key={i}
                title={`${f.carrier || 'Aerolínea'} ${f.code || ''}`.trim()}
                subtitle={`${f.from || ''} → ${f.to || ''}`}
                tags={[
                  f.depart ? <>Salida {fmtTime(f.depart)}</> : null,
                  f.arrive ? <>Llegada {fmtTime(f.arrive)}</> : null,
                ].filter(Boolean) as React.ReactNode[]}
              />
            ))}
          </div>
        </div>
      )}

      {/* Transportes */}
      {(d.transports && d.transports.length > 0) && (
        <div className="mb-3">
          <div className="text-sm font-semibold mb-2">Transportes</div>
          <div className="space-y-2">
            {d.transports.map((t, i) => (
              <BannerCard
                key={i}
                title={`${t.mode?.toUpperCase() || 'Transporte'}${t.provider ? ` · ${t.provider}` : ''}`}
                subtitle={`${t.from || ''}${t.to ? ` → ${t.to}` : ''}`}
                tags={[
                  t.time ? <>🕒 {t.time}</> : null,
                  t.duration ? <>⏱ {fmtDurationISO(t.duration)}</> : null,
                ].filter(Boolean) as React.ReactNode[]}
              />
            ))}
          </div>
        </div>
      )}

      {/* Hotel (tarjeta simple) */}
      {d.hotel && (d.hotel.name || d.hotel.style || d.hotel.checkIn || d.hotel.checkOut) && (
        <div className="mb-3">
          <div className="text-sm font-semibold mb-2">Hotel</div>
          <div className="rounded-xl border p-3 bg-white shadow-sm" style={{ borderColor: '#eceae6' }}>
            <div className="font-medium text-neutral-900">{d.hotel.name}</div>
            <div className="flex flex-wrap gap-2 text-xs text-neutral-600 mt-1">
              {d.hotel.area && <Chip>📍 {d.hotel.area}</Chip>}
              {d.hotel.style && <Chip>🏷 {d.hotel.style}</Chip>}
              {d.hotel.checkIn && <Chip>🛎 Check-in {fmtDateTime(d.hotel.checkIn)}</Chip>}
              {d.hotel.checkOut && <Chip>🔔 Check-out {fmtDateTime(d.hotel.checkOut)}</Chip>}
              {d.hotel.confirmation && <Chip>✅ {d.hotel.confirmation}</Chip>}
            </div>
          </div>
        </div>
      )}

      {/* Actividades como banners */}
      {(activities && activities.length > 0) && (
        <div className="mb-1">
          <div className="text-sm font-semibold mb-2">Plan del día</div>
          <div className="space-y-2">
            {activities.map((a, i) => (
              <BannerCard
                key={i}
                title={a.title}
                subtitle={a.location || ''}
                tags={[
                  a.time ? <>🕒 {a.time}</> : null,
                  a.category ? <>🏷 {a.category}</> : null,
                  a.duration ? <>⏱ {fmtDurationISO(a.duration)}</> : null,
                  a.optional ? <>⚪ Opcional</> : null,
                ].filter(Boolean) as React.ReactNode[]}
                rightTag={d.weather?.icon}
              />
            ))}
          </div>
          {/* Notas y opciones (debajo de cada banner para no alargar) */}
          {activities.some(a => a.notes || (a.options && a.options.length)) && (
            <div className="mt-3 rounded-lg border p-3 text-xs bg-white" style={{ borderColor: '#eceae6' }}>
              {activities.map((a, i) => (
                <div key={`n-${i}`} className="mb-2 last:mb-0">
                  {a.notes && <div className="text-neutral-700">• <span className="font-medium">{a.title}:</span> {a.notes}</div>}
                  {a.options && a.options.length > 0 && (
                    <div className="text-neutral-600 mt-1 ml-3">
                      {a.options.map((op, j) => (
                        <div key={j}>◦ <span className="font-medium">{op.title}</span>{op.notes ? ` — ${op.notes}` : ''}</div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Add-ons */}
      {d.addOns && d.addOns.length > 0 && (
        <div className="mt-2">
          <div className="text-sm font-semibold mb-2">Servicios adicionales</div>
          <div className="space-y-2">
            {d.addOns.map((s, i) => (
              <BannerCard
                key={i}
                title={s.title}
                subtitle={s.provider || ''}
                tags={[
                  s.time ? <>🕒 {s.time}</> : null,
                  s.duration ? <>⏱ {fmtDurationISO(s.duration)}</> : null,
                ].filter(Boolean) as React.ReactNode[]}
              />
            ))}
          </div>
        </div>
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
