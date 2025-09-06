'use client';

import * as React from 'react';
import { useMemo, useState, useEffect } from 'react';

type AnyObj = Record<string, any>;
type TransportMode = 'ground' | 'maritime' | 'air';
type TimelineKind = 'flight' | 'transport' | 'activity' | 'hotelStay';

type SectionLabels = Partial<{
  summary: string;
  accommodation: string;
  hotelOptions: string;
  transport: string;
  flightsInternational: string;
  flightsDomestic: string;
  activities: string;
  addOns: string;
  weather: string;
  recap: string;
}>;

const DEFAULT_LABELS_ES: Required<SectionLabels> = {
  summary: 'Resumen',
  accommodation: 'Alojamiento',
  hotelOptions: 'Opciones de hotel',
  transport: 'Transporte',
  flightsInternational: 'Vuelos internacionales',
  flightsDomestic: 'Vuelos domésticos',
  activities: 'Actividades',
  addOns: 'Extras',
  weather: 'Clima',
  recap: 'Resumen del viaje',
};

const DEFAULT_LABELS_EN: Required<SectionLabels> = {
  summary: 'Summary',
  accommodation: 'Accommodation',
  hotelOptions: 'Hotel options',
  transport: 'Transport',
  flightsInternational: 'International flights',
  flightsDomestic: 'Domestic flights',
  activities: 'Activities',
  addOns: 'Extras',
  weather: 'Weather',
  recap: 'Trip recap',
};

// Llaves que nunca se deben mostrar en la UI (privacidad / política)
const OMIT_KEYS = new Set(
  [
    'confirmation', 'confirmationcode', 'bookingref', 'bookingreference',
    'recordlocator', 'locator', 'pnr', 'ticket', 'voucher',
    'flightnumber', 'number', 'flight_no', 'vuelo', 'número',
  ].map(s => s.toLowerCase())
);

export default function ItineraryCard({ data }: { data: AnyObj }) {
  // --------- Helpers de lectura segura ----------
  const summary = data?.summary ?? {};
  const days: AnyObj[] = Array.isArray(data?.days) ? data.days : [];
  const totalDays = days.length || 1;

  const [dayIdx, setDayIdx] = useState(0);
  const current = days[dayIdx] ?? {};

  // Idioma (para formateos y labels por defecto)
  const lang: string = (data?.lang || summary?.lang || 'es-MX') as string;
  const DEFAULT_LABELS = lang.toLowerCase().startsWith('en') ? DEFAULT_LABELS_EN : DEFAULT_LABELS_ES;
  const labels: Required<SectionLabels> = { ...DEFAULT_LABELS, ...(data?.sectionLabels || {}) };

  // Imágenes del carrusel
  const heroImages = useMemo(
    () => [
      '/images/CocoVolare1.jpg',
      '/images/CocoVolare2.jpg',
      '/images/CocoVolare3.jpg',
      '/images/CocoVolare4.jpg',
      '/images/CocoVolare5.jpg',
      '/images/CocoVolare6.jpg',
      '/images/CocoVolare7.jpg',
      '/images/CocoVolare8.jpg',
    ],
    [],
  );

  const [imgIdx, setImgIdx] = useState(0);
  useEffect(() => {
    const id = setInterval(() => {
      setImgIdx((p) => (p + 1) % heroImages.length);
    }, 4000);
    return () => clearInterval(id);
  }, [heroImages.length]);

  // --------- Formateadores / utils ----------
  const fmtDate = (s?: string) => {
    if (!s) return '';
    try {
      const d = new Date(s);
      return d.toLocaleDateString(lang, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
    } catch {
      return s;
    }
  };

  const fmtTime = (s?: string) => {
    if (!s) return '';
    try {
      const d = new Date(s);
      if (isNaN(d.getTime())) {
        // intentar HH:mm directo
        const hhmm = s.match(/^(\d{2}):(\d{2})/);
        return hhmm ? hhmm[0] : s;
      }
      return d.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' });
    } catch {
      return s;
    }
  };

  const hhmmRange = (start?: string, end?: string) => {
    const a = fmtTime(start), b = fmtTime(end);
    return a && b ? `${a}–${b}` : (a || b || '');
  };

  const diffHours = (start?: string, end?: string) => {
    if (!start || !end) return undefined;
    const a = new Date(start).getTime();
    const b = new Date(end).getTime();
    if (isNaN(a) || isNaN(b)) return undefined;
    const h = (b - a) / 36e5;
    return h > 0 ? Number(h.toFixed(2)) : undefined;
  };

  const pill = (text?: string | number) =>
    !text && text !== 0 ? null : (
      <span className="inline-block rounded-full bg-neutral-800 text-neutral-200 px-2.5 py-1 text-[11px] sm:text-xs whitespace-nowrap">
        {String(text)}
      </span>
    );

  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div className="space-y-1">
      <div className="text-[12px] sm:text-sm text-neutral-300">{title}</div>
      <div className="text-[13px] sm:text-base text-neutral-100">{children}</div>
    </div>
  );

  const list = (items?: any[]) =>
    !items || items.length === 0 ? null : (
      <ul className="list-disc pl-5 space-y-1">
        {items.map((it, i) => (
          <li key={i} className="text-[13px] sm:text-[14px] leading-5">
            {typeof it === 'string' ? it : stringifySmall(it)}
          </li>
        ))}
      </ul>
    );

  const chips = (items?: any[]) =>
    !items || items.length === 0 ? null : (
      <div className="flex flex-wrap gap-1.5">
        {items.map((it, i) => (
          <span
            key={i}
            className="inline-block rounded-full bg-neutral-800/80 text-neutral-200 px-2.5 py-1 text-[11px] sm:text-xs"
          >
            {typeof it === 'string' ? it : stringifySmall(it)}
          </span>
        ))}
      </div>
    );

  function stringifySmall(v: any): string {
    if (v == null) return '';
    if (typeof v === 'string' || typeof v === 'number') return String(v);
    if (Array.isArray(v)) return v.filter(Boolean).map(stringifySmall).join(', ');
    if (typeof v === 'object') {
      // formatos comunes
      if (v.city || v.country) return [v.city, v.country].filter(Boolean).join(', ');
      if (v.name && (v.area || v.address || v.style))
        return [v.name, v.area, v.style].filter(Boolean).join(' · ');
      if (v.summary && (v.tempCmax || v.tempCmin))
        return `${v.summary} · ${[v.tempCmin, v.tempCmax].filter(Boolean).join('–')}°C`;
      if (v.text) return String(v.text);

      // serializar objeto filtrando llaves sensibles
      return Object.entries(v)
        .filter(([k]) => !OMIT_KEYS.has(String(k).toLowerCase()))
        .map(([k, val]) => `${k}: ${stringifySmall(val)}`)
        .join(' · ');
    }
    return String(v);
  }

  // --------- Datos encabezado ----------
  const title =
    data?.tripTitle ||
    data?.title ||
    `Viaje a ${summary?.destination || ''}`.trim() ||
    (lang.toLowerCase().startsWith('en') ? 'Itinerary' : 'Itinerario');

  const dateStart = fmtDate(summary?.startDate || data?.startDate);
  const dateEnd = fmtDate(summary?.endDate || data?.endDate);
  const nights = summary?.nights ?? data?.nights;

  const headerBadges: (string | null)[] = [
    (Array.isArray(summary?.destinations)
      ? summary.destinations.map((d: any) => stringifySmall(d)).join(', ')
      : stringifySmall(summary?.destination)) || null,
    dateStart && dateEnd ? `${dateStart} – ${dateEnd}` : null,
    nights ? `${nights} ${lang.toLowerCase().startsWith('en') ? (Number(nights) === 1 ? 'night' : 'nights') : `noche${Number(nights) === 1 ? '' : 's'}`}` : null,
  ].filter(Boolean) as string[];

  // --------- Datos del día ----------
  const locations = Array.isArray(current?.locations) ? current.locations : undefined;
  const weather = current?.weather;

  const activities = Array.isArray(current?.activities) ? current.activities : [];
  const hotel = current?.hotel;
  const hotelOptions = Array.isArray(current?.hotelOptions) ? current.hotelOptions : [];

  const transports: Array<{
    mode: TransportMode;
    from: string; to: string;
    departure?: string; arrival?: string;
    durationHours?: number;
    provider?: string; notes?: string;
  }> = Array.isArray(current?.transports) ? current.transports : [];

  const addonsArray = Array.isArray(current?.addons)
    ? current.addons
    : Array.isArray(current?.addOns)
    ? current.addOns
    : Array.isArray(current?.extras)
    ? current.extras
    : [];

  // Otros bloques condicionales
  const extraBlocks: { label: string; content: React.ReactNode }[] = [];

  if (current?.flightsInternational && current.flightsInternational.length) {
    extraBlocks.push({
      label: labels.flightsInternational,
      content: list(current.flightsInternational),
    });
  }
  if (current?.flightsDomestic && current.flightsDomestic.length) {
    extraBlocks.push({
      label: labels.flightsDomestic,
      content: list(current.flightsDomestic),
    });
  }
  if (current?.highlights && current.highlights.length) {
    extraBlocks.push({ label: 'Highlights', content: list(current.highlights) });
  }
  if (current?.notes && String(current.notes).trim().length) {
    extraBlocks.push({ label: lang.toLowerCase().startsWith('en') ? 'Notes' : 'Notas', content: <p>{current.notes}</p> });
  }

  // --------- Render helpers de secciones nuevas ----------
  const MODE_ICON: Record<TransportMode, string> = { ground: '🚗', maritime: '⛴️', air: '✈️' };
  const MODE_LABEL_ES: Record<TransportMode, string> = { ground: 'Terrestre', maritime: 'Marítima', air: 'Aérea' };
  const MODE_LABEL_EN: Record<TransportMode, string> = { ground: 'Ground', maritime: 'Maritime', air: 'Air' };
  const MODE_LABEL = lang.toLowerCase().startsWith('en') ? MODE_LABEL_EN : MODE_LABEL_ES;

  function RenderTransports({ items = [] as AnyObj[] }) {
    if (!items.length) return null;
    return (
      <div className="space-y-2">
        {items.map((t, i) => {
          const mode: TransportMode = (t.mode || 'ground') as TransportMode;
          const dh = typeof t.durationHours === 'number' ? t.durationHours : diffHours(t.departure, t.arrival);
          const line1 = `${MODE_ICON[mode]} ${MODE_LABEL[mode]} · ${t.from} → ${t.to}`;
          const line2 = [hhmmRange(t.departure, t.arrival), dh ? `${dh} h` : null, t.provider].filter(Boolean).join(' · ');
          return (
            <div key={i} className="leading-snug">
              <div><strong>{line1}</strong></div>
              {line2 && <div className="text-sm opacity-80">{line2}</div>}
              {t.notes && <div className="text-sm italic opacity-80">“{t.notes}”</div>}
            </div>
          );
        })}
      </div>
    );
  }

  function RenderActivities({ items = [] as AnyObj[] }) {
    if (!items.length) return null;
    return (
      <div className="space-y-3">
        {items.map((a, i) => (
          <div key={i} className="leading-snug">
            <div className="font-medium">{a.title || stringifySmall(a)}</div>
            {(a.start || a.end || a.durationHours || a?.location?.name) && (
              <div className="text-sm opacity-80">
                {[hhmmRange(a.start, a.end), a.durationHours ? `${a.durationHours} h` : null, a?.location?.name]
                  .filter(Boolean).join(' · ')}
              </div>
            )}
            {(a.cost || a.bookingRequired || a.private || a.dressCode || a.intensity) && (
              <div className="text-xs opacity-70 mt-0.5">
                {[
                  a.cost ? `${lang.toLowerCase().startsWith('en') ? 'Cost' : 'Costo'}: ${a.cost.currency} ${a.cost.amount}` : null,
                  a.bookingRequired ? (lang.toLowerCase().startsWith('en') ? 'Booking required' : 'Reserva requerida') : null,
                  a.private ? (lang.toLowerCase().startsWith('en') ? 'Private' : 'Privado') : null,
                  a.dressCode ? `${lang.toLowerCase().startsWith('en') ? 'Dress code' : 'Código de vestir'}: ${a.dressCode}` : null,
                  a.intensity ? `${lang.toLowerCase().startsWith('en') ? 'Intensity' : 'Intensidad'}: ${a.intensity}` : null
                ].filter(Boolean).join(' · ')}
              </div>
            )}
            {a.notes && <div className="text-sm italic opacity-80 mt-0.5">“{a.notes}”</div>}
            {Array.isArray(a.tags) && a.tags.length ? <div className="mt-1">{chips(a.tags)}</div> : null}
          </div>
        ))}
      </div>
    );
  }

  function RenderHotelOptions({ options = [] as AnyObj[] }) {
    if (!options.length) return null;
    return (
      <div className="space-y-2">
        {options.map((h, i) => (
          <div key={i} className="leading-snug">
            <div className="font-medium">{h.name}</div>
            <div className="text-sm opacity-80">
              {[h.area, h.style, h.category || h.Category].filter(Boolean).join(' · ')}
            </div>
            {h.note && <div className="text-sm italic opacity-80">“{h.note}”</div>}
          </div>
        ))}
      </div>
    );
  }

  function RenderSummaryComments({ comments = [] as string[] }) {
    if (!comments.length) return null;
    return (
      <ul className="list-disc pl-5 text-sm space-y-1">
        {comments.map((c, i) => (<li key={i}>{c}</li>))}
      </ul>
    );
  }

  type TimelineItem = { date: string; time?: string; durationHours?: number; kind: TimelineKind; label: string };

  function buildTimeline(data: AnyObj): TimelineItem[] {
    if (Array.isArray(data?.finalTimeline) && data.finalTimeline.length) return data.finalTimeline as TimelineItem[];
    const items: TimelineItem[] = [];

    for (const d of (data.days || [])) {
      // transportes
      (d.transports || []).forEach((t: any) => {
        items.push({
          date: d.date,
          time: t.departure ? fmtTime(t.departure) : undefined,
          durationHours: typeof t.durationHours === 'number' ? t.durationHours : diffHours(t.departure, t.arrival),
          kind: 'transport',
          label: `${t.from} → ${t.to}`,
        });
      });
      // actividades
      (d.activities || []).forEach((a: any) => {
        items.push({
          date: d.date,
          time: a.start ? fmtTime(a.start) : undefined,
          durationHours: typeof a.durationHours === 'number' ? a.durationHours : diffHours(a.start, a.end),
          kind: 'activity',
          label: a.title || 'Actividad',
        });
      });
      // estadías de hotel (check-in/out si vienen)
      if (d.hotel?.checkIn) items.push({ date: d.date, time: fmtTime(d.hotel.checkIn), kind: 'hotelStay', label: `Check-in ${d.hotel.name}` });
      if (d.hotel?.checkOut) items.push({ date: d.date, time: fmtTime(d.hotel.checkOut), kind: 'hotelStay', label: `Check-out ${d.hotel.name}` });
    }

    return items.sort((a, b) => (`${a.date} ${a.time || '99:99'}`).localeCompare(`${b.date} ${b.time || '99:99'}`));
  }

  function RenderFinalTimeline({ data }: { data: AnyObj }) {
    const tl = buildTimeline(data);
    if (!tl.length) return null;
    return (
      <div className="space-y-2">
        {tl.map((e: TimelineItem, i: number) => (
          <div key={i} className="text-sm">
            <span className="font-mono">{e.time ?? '— —'}</span>
            {e.durationHours ? ` · ${e.durationHours} h` : ''} · {e.label}
          </div>
        ))}
      </div>
    );
  }

  // --------- Render ----------
  return (
    <div className="w-full">
      <div
        className="
          w-full rounded-3xl shadow-xl bg-neutral-900 text-neutral-100
          overflow-hidden
        "
      >
        {/* HERO - carrusel */}
        <div className="relative w-full h-[180px] sm:h-[220px] md:h-[260px]">
          <img
            src={heroImages[imgIdx]}
            alt="Coco Volare"
            className="absolute inset-0 w-full h-full object-cover"
            draggable={false}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/10 to-transparent" />
          {/* Logo + título */}
          <div className="absolute left-0 right-0 bottom-0 px-4 sm:px-6 pb-3 sm:pb-4">
            <div className="flex items-center gap-3">
              <img
                src="/images/logo-coco-volare.png"
                alt="Coco Volare"
                className="h-9 w-9 sm:h-11 sm:w-11 rounded-full bg-black/60 p-1 shadow"
                draggable={false}
              />
              <div className="min-w-0">
                <div className="text-[15px] sm:text-[17px] font-semibold leading-tight line-clamp-2">
                  {title}
                </div>
                {headerBadges.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {headerBadges.map((t, i) => (
                      <span
                        key={i}
                        className="inline-block rounded-full bg-black/50 text-neutral-200 px-2.5 py-1 text-[11px] sm:text-xs"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* CONTENIDO */}
        <div className="p-4 sm:p-6 space-y-5">
          {/* Top meta del día */}
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[12px] sm:text-[13px] text-neutral-400">
                {(lang.toLowerCase().startsWith('en') ? 'Day' : 'Día')} {current?.day || dayIdx + 1}
              </div>
              {current?.title && (
                <div className="text-[15px] sm:text-[17px] font-semibold leading-tight">{current.title}</div>
              )}
              {current?.date && (
                <div className="text-[12px] sm:text-[13px] text-neutral-300">{fmtDate(current.date)}</div>
              )}
            </div>
            <div className="flex-shrink-0 flex gap-1.5">
              {chips(
                [
                  ...(Array.isArray(locations) ? locations.map((l: AnyObj) => stringifySmall(l)) : []),
                  weather?.summary ? stringifySmall(weather) : undefined,
                ].filter(Boolean) as string[],
              )}
            </div>
          </div>

          {/* Actividades */}
          {activities && activities.length > 0 ? (
            <Section title={labels.activities}>
              <RenderActivities items={activities} />
            </Section>
          ) : (
            <div className="text-[13px] sm:text-[14px] text-neutral-400">
              {lang.toLowerCase().startsWith('en') ? 'N/A.' : 'N/A.'}
            </div>
          )}

          {/* Alojamiento */}
          {hotel && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Section title={labels.accommodation}>
                <div className="space-y-1">
                  {hotel?.name && (
                    <div className="font-medium text-[14px] sm:text-[15px]">{hotel.name}</div>
                  )}
                  <div className="flex flex-wrap gap-1.5">
                    {pill(hotel?.area)}
                    {pill(hotel?.style)}
                    {pill(hotel?.address)}
                    {pill(hotel?.Category || hotel?.category)}
                  </div>
                </div>
              </Section>
              <div className="space-y-2">
                <Section title={lang.toLowerCase().startsWith('en') ? 'Check-in / out' : 'Check-in / out'}>
                  <div className="flex flex-wrap gap-2">
                    {/* Soporte a mayúsculas/minúsculas: checkIn/checkin */}
                    {(hotel?.checkIn || hotel?.checkin) && pill(`Check-in: ${fmtDate(hotel?.checkIn || hotel?.checkin)}`)}
                    {(hotel?.checkOut || hotel?.checkout) && pill(`Check-out: ${fmtDate(hotel?.checkOut || hotel?.checkout)}`)}
                    {/* Nunca mostrar confirmación */}
                    {/* {hotel?.confirmation && pill(`Conf.: ${hotel.confirmation}`)} */}
                  </div>
                </Section>
              </div>
            </div>
          )}

          {/* Opciones de hotel */}
          {hotelOptions && hotelOptions.length > 0 && (
            <Section title={labels.hotelOptions}>
              <RenderHotelOptions options={hotelOptions} />
            </Section>
          )}

          {/* Transporte */}
          {transports && transports.length > 0 && (
            <Section title={labels.transport}>
              <RenderTransports items={transports} />
            </Section>
          )}

          {/* Add-ons / Extras */}
          {addonsArray && addonsArray.length > 0 && (
            <Section title={labels.addOns}>
              {chips(addonsArray)}
            </Section>
          )}

          {/* Extras si vienen */}
          {extraBlocks.map(
            (b, i) => b.content && <div key={i}><Section title={b.label}>{b.content}</Section></div>,
          )}

          {/* Summary principal */}
          {(summary?.pax || summary?.theme || summary?.overview || (Array.isArray(summary?.comments) && summary.comments.length)) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
              {(summary?.overview || (Array.isArray(summary?.comments) && summary.comments.length)) && (
                <Section title={labels.summary}>
                  {summary?.overview ? <p className="mb-2">{summary.overview}</p> : null}
                  {Array.isArray(summary?.comments) && summary.comments.length ? (
                    <RenderSummaryComments comments={summary.comments} />
                  ) : null}
                </Section>
              )}
              <div className="space-y-3">
                {summary?.pax &&
                  <Section title={lang.toLowerCase().startsWith('en') ? 'Pax' : 'Pax'}>
                    <div className="flex flex-wrap gap-1.5">
                      {pill(
                        `${summary.pax.adults ?? 0} ${
                          lang.toLowerCase().startsWith('en')
                            ? (Number(summary.pax?.adults) === 1 ? 'adult' : 'adults')
                            : `adulto${Number(summary.pax?.adults) === 1 ? '' : 's'}`
                        }`,
                      )}
                      {summary.pax.children ? pill(`${summary.pax.children} ${lang.toLowerCase().startsWith('en') ? 'child(ren)' : 'niño(s)'}`) : null}
                      {summary.pax.infants ? pill(`${summary.pax.infants} ${lang.toLowerCase().startsWith('en') ? 'infant(s)' : 'infante(s)'}`) : null}
                    </div>
                  </Section>}
                {summary?.theme && <Section title={lang.toLowerCase().startsWith('en') ? 'Theme' : 'Tema'}>{chips(summary.theme)}</Section>}
                {summary?.budget && <Section title={lang.toLowerCase().startsWith('en') ? 'Budget' : 'Presupuesto'}>
                  {pill(`${summary.budget.currency} ${summary.budget.amountMin ?? 0} – ${summary.budget.amountMax ?? 0}`)}
                </Section>}
              </div>
            </div>
          )}

          {/* Recap final (timeline) */}
          <Section title={labels.recap}>
            <RenderFinalTimeline data={data} />
          </Section>
        </div>

        {/* NAV DÍAS */}
        <div className="px-4 sm:px-6 pb-4">
          <div className="w-full bg-black rounded-full shadow-inner flex items-center justify-between p-1.5">
            <button
              type="button"
              onClick={() => setDayIdx((p) => (p - 1 + totalDays) % totalDays)}
              className="h-9 w-9 rounded-full bg-[#bba36d] text-black grid place-items-center active:scale-[0.98]"
              aria-label={lang.toLowerCase().startsWith('en') ? 'Previous day' : 'Día anterior'}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
            <div className="text-neutral-200 text-[13px] sm:text-[14px]">
              {lang.toLowerCase().startsWith('en') ? 'Day' : 'Día'} {Math.min(dayIdx + 1, totalDays)} {lang.toLowerCase().startsWith('en') ? 'of' : 'de'} {totalDays}
            </div>
            <button
              type="button"
              onClick={() => setDayIdx((p) => (p + 1) % totalDays)}
              className="h-9 w-9 rounded-full bg-[#bba36d] text-black grid place-items-center active:scale-[0.98]"
              aria-label={lang.toLowerCase().startsWith('en') ? 'Next day' : 'Día siguiente'}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Ajustes de tipografía responsiva generales */}
      <style jsx>{`
        :global(.itn-clamp-title) {
          font-size: clamp(15px, 2.8vw, 18px);
        }
      `}</style>
    </div>
  );
}
