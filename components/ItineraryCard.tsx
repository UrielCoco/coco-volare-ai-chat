'use client';

import React from 'react';

type Pax = { adults: number; children?: number; infants?: number };
type Budget = { currency: string; amountMin?: number; amountMax?: number };
type Location = { city: string; country?: string };
type Weather = {
  tempCmin?: number; tempCmax?: number;
  tempFmin?: number; tempFmax?: number;
  humidity?: number; icon?: string; summary?: string;
};

type Flight = {
  carrier?: string;
  code?: string;
  from?: string;
  to?: string;
  depart?: string; // ISO datetime
  arrive?: string; // ISO datetime
  baggage?: string;
  pnr?: string;
  notes?: string;
};

type Transport = {
  mode: 'car'|'van'|'bus'|'train'|'boat'|'helicopter'|'other';
  provider?: string;
  from?: string;
  to?: string;
  time?: string;      // HH:mm
  duration?: string;  // ISO 8601 duration
  notes?: string;
};

type ActivityOption = { title: string; notes?: string };

type Activity = {
  time?: string;
  category: 'activity'|'meal'|'transfer'|'flight'|'hotel'|'free'|'other';
  title: string;
  location?: string;
  duration?: string; // ISO 8601
  optional?: boolean;
  notes?: string;
  options?: ActivityOption[];
};

type Hotel = {
  name?: string;
  area?: string;
  style?: string;
  checkIn?: string;
  checkOut?: string;
  confirmation?: string;
};

type Day = {
  day: number;
  date?: string;
  title?: string;
  locations?: Location[];
  weather?: Weather;
  flightsInternational?: Flight[];
  flightsDomestic?: Flight[];
  transports?: Transport[];
  hotel?: Hotel;
  hotelOptions?: Hotel[];
  activities?: Activity[]; // (antes "timeline")
  timeline?: Activity[];   // retro-compatibilidad
  addOns?: { title: string; description?: string; provider?: string; time?: string; duration?: string; note?: string }[];
};

type Summary = {
  destination?: string;
  startDate?: string;
  endDate?: string;
  nights?: number;
  pax?: Pax;
  theme?: string[];
  budget?: Budget;
  overview?: string;
};

type Itinerary = {
  lang?: 'es'|'en'|string;
  tripTitle?: string;
  clientBooksLongHaulFlights?: boolean;
  disclaimer?: string;
  summary?: Summary;
  days: Day[];
};

function safe<T>(v: any, fallback: T): T {
  return (v === undefined || v === null) ? fallback : v;
}

function fmtDate(d?: string) {
  if (!d) return '';
  try {
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return d;
    return dt.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return d;
  }
}

function fmtDateTime(d?: string) {
  if (!d) return '';
  try {
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return d;
    return dt.toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  } catch {
    return d;
  }
}

function fmtDurationISO(iso?: string) {
  if (!iso) return '';
  // MUY simple: PT#H#M
  const m = /^P(T(?:(\d+)H)?(?:(\d+)M)?)$/i.exec(iso);
  if (!m) return iso;
  const h = m[2] ? parseInt(m[2]) : 0;
  const min = m[3] ? parseInt(m[3]) : 0;
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
        <span>{icon}</span>
        <span>{title}</span>
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

function Divider() {
  return <div className="h-px bg-neutral-800 my-4" />;
}

export default function ItineraryCard({ data }: { data: Itinerary | any }) {
  // Permitir string JSON
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch {}
  }
  const it: Itinerary = data || { days: [] };
  const summary = it.summary || {};
  const days: Day[] = safe(it.days, []);

  return (
    <div className="rounded-2xl bg-neutral-900 text-neutral-100 shadow-lg border border-neutral-800 overflow-hidden">
      {/* HEADER */}
      <div className="px-5 py-4 border-b border-neutral-800 bg-neutral-900/70">
        <div className="text-lg font-semibold text-white">{it.tripTitle || summary.destination || 'Itinerario'}</div>
        {summary.overview && <div className="text-sm text-neutral-300 mt-1 whitespace-pre-wrap">{summary.overview}</div>}
        <div className="flex flex-wrap gap-3 mt-3 text-sm">
          {summary.startDate && summary.endDate && (
            <Chip>🗓 {fmtDate(summary.startDate)} – {fmtDate(summary.endDate)}{summary.nights ? ` • ${summary.nights} noches` : ''}</Chip>
          )}
          {summary.pax && (
            <Chip>👥 {summary.pax.adults} adultos{summary.pax.children ? `, ${summary.pax.children} niños` : ''}{summary.pax.infants ? `, ${summary.pax.infants} inf.` : ''}</Chip>
          )}
          {summary.theme && summary.theme.length > 0 && (
            <Chip>🎯 {summary.theme.join(' · ')}</Chip>
          )}
          {summary.budget && (
            <Chip>💰 {summary.budget.currency} {summary.budget.amountMin ?? ''}{summary.budget.amountMax ? ` – ${summary.budget.amountMax}` : ''}</Chip>
          )}
          {it.clientBooksLongHaulFlights && <Chip>✈️ Largos vuelos por cuenta del cliente</Chip>}
        </div>
      </div>

      {/* DISCLAIMER */}
      {it.disclaimer && (
        <div className="px-5 py-2 text-xs text-neutral-400 border-b border-neutral-800 bg-neutral-900/60">
          {it.disclaimer}
        </div>
      )}

      {/* BODY: DAYS */}
      <div className="px-5 py-5">
        {days.length === 0 && <div className="text-sm text-neutral-400">Sin días cargados.</div>}

        {days.map((d, idx) => {
          const activities: Activity[] = d.activities || d.timeline || [];
          return (
            <div key={`day-${idx}`} className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4 mb-5">
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

              {/* Actividades (timeline) */}
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
        })}

        <Divider />
        <div className="text-[11px] text-neutral-500">
          *Fechas, horarios y proveedores sujetos a disponibilidad y cambios sin previo aviso.
        </div>
      </div>
    </div>
  );
}