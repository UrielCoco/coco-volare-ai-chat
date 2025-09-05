'use client';

import * as React from 'react';
import { useMemo, useState, useEffect } from 'react';

type AnyObj = Record<string, any>;

export default function ItineraryCard({ data }: { data: AnyObj }) {
  // --------- Helpers de lectura segura ----------
  const summary = data?.summary ?? {};
  const days: AnyObj[] = Array.isArray(data?.days) ? data.days : [];
  const totalDays = days.length || 1;

  const [dayIdx, setDayIdx] = useState(0);
  const current = days[dayIdx] ?? {};

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
    // rotación automática suave
    const id = setInterval(() => {
      setImgIdx((p) => (p + 1) % heroImages.length);
    }, 4000);
    return () => clearInterval(id);
  }, [heroImages.length]);

  // --------- Formateadores ----------
  const fmtDate = (s?: string) => {
    if (!s) return '';
    try {
      const d = new Date(s);
      return d.toLocaleDateString(summary?.lang || 'es-MX', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
    } catch {
      return s;
    }
  };

  const pill = (text?: string | number) =>
    !text ? null : (
      <span className="inline-block rounded-full bg-neutral-800 text-neutral-200 px-2.5 py-1 text-[11px] sm:text-xs whitespace-nowrap">
        {String(text)}
      </span>
    );

  const section = (label: string, children: React.ReactNode) => (
    <div className="space-y-1">
      <div className="text-[12px] sm:text-sm text-neutral-300">{label}</div>
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
    // objetos típicos (locations, weather)
    if (typeof v === 'object') {
      if (v.city || v.country) return [v.city, v.country].filter(Boolean).join(', ');
      if (v.name && (v.area || v.address || v.style))
        return [v.name, v.area, v.style].filter(Boolean).join(' · ');
      if (v.summary && (v.tempCmax || v.tempCmin))
        return `${v.summary} · ${[v.tempCmin, v.tempCmax].filter(Boolean).join('–')}°C`;
      if (v.text) return String(v.text);
      return Object.entries(v)
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
    'Itinerario';
  const dateStart = fmtDate(summary?.startDate || data?.startDate);
  const dateEnd = fmtDate(summary?.endDate || data?.endDate);
  const nights = data?.nights ?? summary?.nights;

  const headerBadges: (string | null)[] = [
    (Array.isArray(summary?.destinations)
      ? summary.destinations.map((d: any) => stringifySmall(d)).join(', ')
      : stringifySmall(summary?.destination)) || null,
    dateStart && dateEnd ? `${dateStart} – ${dateEnd}` : null,
    nights ? `${nights} noche${Number(nights) === 1 ? '' : 's'}` : null,
  ].filter(Boolean) as string[];

  // --------- Datos del día ----------
  const locations = Array.isArray(current?.locations) ? current.locations : undefined;
  const weather = current?.weather;
  const activities =
    (Array.isArray(current?.activities) && current.activities.length > 0
      ? current.activities
      : Array.isArray(current?.hotelOptions)
      ? current.hotelOptions
      : []) || [];

  const hotel = current?.hotel;
  const transports = Array.isArray(current?.transports) ? current.transports : [];
  const addonsArray = Array.isArray(current?.addons)
    ? current.addons
    : Array.isArray(current?.addOns)
    ? current.addOns
    : Array.isArray(current?.extras)
    ? current.extras
    : [];

  // Otros campos útiles que no queremos perder si llegan
  const extraBlocks: { label: string; content: React.ReactNode }[] = [];

  if (current?.flightsInternational && current.flightsInternational.length) {
    extraBlocks.push({
      label: 'Vuelos',
      content: list(current.flightsInternational),
    });
  }
  if (current?.highlights && current.highlights.length) {
    extraBlocks.push({ label: 'Highlights', content: list(current.highlights) });
  }
  if (current?.notes && String(current.notes).trim().length) {
    extraBlocks.push({ label: 'Notas', content: <p>{current.notes}</p> });
  }

  // --------- Render ----------
  return (
    <div className="w-full">
      <div
        className="
          w-full rounded-3xl shadow-xl bg-neutral-900 text-neutral-100
          overflow-hidden
        "
        // sin bordes, solo sombra
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
              <div className="text-[12px] sm:text-[13px] text-neutral-400">Día {current?.day || dayIdx + 1}</div>
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
                  ...(locations ? locations.map((l: AnyObj) => stringifySmall(l)) : []),
                  weather?.summary ? stringifySmall(weather) : undefined,
                ].filter(Boolean) as string[],
              )}
            </div>
          </div>

          {/* Actividades */}
          {activities && activities.length > 0 ? (
            section(
              'Actividades',
              <div className="space-y-1">
                {activities.map((a: any, i: number) => (
                  <div key={i} className="text-[13px] sm:text-[14px] leading-5">
                    • {typeof a === 'string' ? a : stringifySmall(a)}
                  </div>
                ))}
              </div>,
            )
          ) : (
            <div className="text-[13px] sm:text-[14px] text-neutral-400">
              Sin actividades registradas para este día.
            </div>
          )}

          {/* Alojamiento */}
          {hotel && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {section(
                'Alojamiento',
                <div className="space-y-1">
                  {hotel?.name && (
                    <div className="font-medium text-[14px] sm:text-[15px]">{hotel.name}</div>
                  )}
                  <div className="flex flex-wrap gap-1.5">
                    {pill(hotel?.area)}
                    {pill(hotel?.style)}
                    {pill(hotel?.address)}
                  </div>
                </div>,
              )}
              <div className="space-y-2">
                {section(
                  'Check-in / out',
                  <div className="flex flex-wrap gap-2">
                    {hotel?.checkin && pill(`Check-in: ${fmtDate(hotel.checkin)}`)}
                    {hotel?.checkout && pill(`Check-out: ${fmtDate(hotel.checkout)}`)}
                    {hotel?.confirmation && pill(`Conf.: ${hotel.confirmation}`)}
                  </div>,
                )}
              </div>
            </div>
          )}

          {/* Traslados */}
          {transports && transports.length > 0 && section('Traslados', list(transports))}

          {/* Addons (chips / lista) */}
          {addonsArray && addonsArray.length > 0 && section('Add-ons', chips(addonsArray))}

          {/* Extras si vienen */}
          {extraBlocks.map(
            (b, i) => b.content && <div key={i}>{section(b.label, b.content)}</div>,
          )}

          {/* Meta inferior de resumen (si llega) */}
          {(summary?.pax || summary?.theme || summary?.overview) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
              {summary?.overview && section('Resumen', <p>{summary.overview}</p>)}
              <div className="space-y-3">
                {summary?.pax &&
                  section(
                    'Pax',
                    <div className="flex flex-wrap gap-1.5">
                      {pill(
                        `${summary.pax.adults ?? 0} adulto${
                          Number(summary.pax?.adults) === 1 ? '' : 's'
                        }`,
                      )}
                      {summary.pax.children ? pill(`${summary.pax.children} niño(s)`) : null}
                      {summary.pax.infants ? pill(`${summary.pax.infants} infante(s)`) : null}
                    </div>,
                  )}
                {summary?.theme && section('Tema', pill(summary.theme))}
              </div>
            </div>
          )}
        </div>

        {/* NAV DÍAS */}
        <div className="px-4 sm:px-6 pb-4">
          <div className="w-full bg-black rounded-full shadow-inner flex items-center justify-between p-1.5">
            <button
              type="button"
              onClick={() => setDayIdx((p) => (p - 1 + totalDays) % totalDays)}
              className="h-9 w-9 rounded-full bg-[#bba36d] text-black grid place-items-center active:scale-[0.98]"
              aria-label="Día anterior"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
            <div className="text-neutral-200 text-[13px] sm:text-[14px]">
              Día {Math.min(dayIdx + 1, totalDays)} de {totalDays}
            </div>
            <button
              type="button"
              onClick={() => setDayIdx((p) => (p + 1) % totalDays)}
              className="h-9 w-9 rounded-full bg-[#bba36d] text-black grid place-items-center active:scale-[0.98]"
              aria-label="Día siguiente"
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
