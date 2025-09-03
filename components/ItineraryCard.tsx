// components/ItineraryCard.tsx
'use client';

import * as React from 'react';

type AnyObj = Record<string, any>;

type Props = {
  data: AnyObj; // JSON ya parseado que envía el assistant
  className?: string;
};

function cx(...args: Array<string | false | null | undefined>) {
  return args.filter(Boolean).join(' ');
}

const isNonEmptyStr = (v: any) => typeof v === 'string' && v.trim().length > 0;
const asArr = (v: any) => (Array.isArray(v) ? v : v ? [v] : []) as any[];

function fmtDate(s?: string) {
  if (!isNonEmptyStr(s)) return '';
  try {
    const d = new Date(s as string);
    if (Number.isNaN(+d)) return String(s);
    return d.toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return String(s);
  }
}

function chip(text?: string) {
  if (!isNonEmptyStr(text)) return null;
  return (
    <span className="inline-flex items-center rounded-full px-2 py-1 text-xs bg-white/15 text-white">
      {text}
    </span>
  );
}

export default function ItineraryCard({ data, className }: Props) {
  const summary = (data?.summary ?? {}) as AnyObj;

  const days = asArr(data?.days);
  const [idx, setIdx] = React.useState(0);
  const current = days[idx] ?? {};

  const totalDays = Math.max(days.length, Number(data?.nights ?? 0) + 1 || 0);

  const title =
    data?.tripTitle ||
    summary?.title ||
    summary?.tripTitle ||
    `Viaje a ${summary?.destination || ''}`.trim();

  const destination =
    summary?.destination ||
    summary?.dest ||
    data?.destination ||
    '';

  const start = summary?.startDate || data?.startDate || '';
  const end = summary?.endDate || data?.endDate || '';
  const nights =
    data?.nights ??
    summary?.nights ??
    (start && end
      ? Math.max(
          0,
          Math.round(
            (new Date(end).getTime() - new Date(start).getTime()) /
              (1000 * 60 * 60 * 24),
          ),
        )
      : undefined);

  const hasHeaderMeta =
    isNonEmptyStr(destination) ||
    isNonEmptyStr(start) ||
    isNonEmptyStr(end) ||
    typeof nights === 'number';

  // --- Día actual: leer con tolerancia ---
  const dayNumber =
    current?.day ??
    (typeof current?.dayIndex === 'number' ? current.dayIndex + 1 : undefined) ??
    idx + 1;

  const dayTitle =
    current?.title ||
    current?.name ||
    (isNonEmptyStr(current?.date) ? `Día ${dayNumber}` : '');

  const dateStr = fmtDate(current?.date);

  const locations = asArr(current?.locations).filter(
    (l) => isNonEmptyStr(l?.city) || isNonEmptyStr(l?.country) || isNonEmptyStr(l?.name),
  );

  const weather = current?.weather ?? {};
  const weatherLabel =
    weather?.summary ||
    weather?.icon ||
    (typeof weather?.tempCmax === 'number' && typeof weather?.tempCmin === 'number'
      ? `${weather.tempCmin}–${weather.tempCmax}°C`
      : '');

  const flights = asArr(current?.flightsInternational)
    .concat(asArr(current?.flightsDomestic))
    .concat(asArr(current?.flights));

  const transports = asArr(current?.transports ?? current?.transport);

  const hotel =
    current?.hotel ||
    current?.stay ||
    current?.accommodation ||
    undefined;

  const activities =
    asArr(current?.activities)
      .concat(asArr(current?.activity))
      .concat(asArr(current?.experiences))
      .filter(Boolean);

  const hasAnyDetail =
    locations.length ||
    isNonEmptyStr(weatherLabel) ||
    flights.length ||
    transports.length ||
    activities.length ||
    !!hotel;

  const next = () => setIdx((p) => (p + 1 < days.length ? p + 1 : p));
  const prev = () => setIdx((p) => (p - 1 >= 0 ? p - 1 : p));

  return (
    <div
      className={cx(
        'w-full',
        'rounded-3xl',
        'p-3 sm:p-4',
        'bg-black', // Fondo negro pedido
        className,
      )}
    >
      <div
        className={cx(
          'relative w-full rounded-3xl',
          'bg-white/10 backdrop-blur-xl', // cristal esmerilado
          'shadow-xl',
          'p-4 sm:p-6',
          'text-white',
        )}
      >
        {/* Header */}
        <div className="flex items-start gap-3">
          <img
            src="/images/logo-coco-volare.png"
            alt="Coco Volare"
            className="w-12 h-12 sm:w-14 sm:h-14 rounded-full object-contain"
            // logo más grande
          />
          <div className="min-w-0 flex-1">
            {isNonEmptyStr(title) && (
              <h2 className="text-base sm:text-lg font-semibold leading-tight">
                {title}
              </h2>
            )}
            {hasHeaderMeta && (
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs sm:text-sm text-white/80">
                {isNonEmptyStr(destination) && chip(destination)}
                {(isNonEmptyStr(start) || isNonEmptyStr(end)) &&
                  chip(
                    `${fmtDate(start)}${
                      isNonEmptyStr(end) ? ` – ${fmtDate(end)}` : ''
                    }`,
                  )}
                {typeof nights === 'number' && chip(`${nights} noches`)}
              </div>
            )}
          </div>

          {/* Nav días */}
          {days.length > 1 && (
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={prev}
                className="w-8 h-8 rounded-full bg-white/15 hover:bg-white/25 transition flex items-center justify-center"
                aria-label="Día anterior"
              >
                ‹
              </button>
              <div className="px-2 py-1 rounded-full bg-white/10 text-xs sm:text-sm">
                Día {dayNumber}
              </div>
              <button
                onClick={next}
                className="w-8 h-8 rounded-full bg-white/15 hover:bg-white/25 transition flex items-center justify-center"
                aria-label="Día siguiente"
              >
                ›
              </button>
            </div>
          )}
        </div>

        {/* Línea del día */}
        <div className="mt-4 border-t border-white/10 pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              {isNonEmptyStr(dayTitle) && (
                <h3 className="text-[15px] sm:text-base font-semibold leading-tight">
                  {dayTitle}
                </h3>
              )}
              {isNonEmptyStr(dateStr) && (
                <div className="text-xs sm:text-sm text-white/75">{dateStr}</div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {locations.length > 0 &&
                chip(
                  locations
                    .map((l) =>
                      [l?.city, l?.country, l?.name]
                        .filter(isNonEmptyStr)
                        .join(', '),
                    )
                    .filter(isNonEmptyStr)
                    .join(' • '),
                )}
              {isNonEmptyStr(weatherLabel) && chip(String(weatherLabel))}
            </div>
          </div>

          {/* Detalles del día */}
          {hasAnyDetail ? (
            <div className="mt-4 space-y-4">
              {/* Flights */}
              {flights.length > 0 && (
                <Section title="Vuelos">
                  <ul className="space-y-2">
                    {flights.map((f, i) => {
                      const from = f?.from || f?.origin;
                      const to = f?.to || f?.destination;
                      const time = f?.time || f?.depTime || f?.departure;
                      const code = f?.code || f?.flight || '';
                      const line = [code, from && `de ${from}`, to && `a ${to}`, time && `(${time})`]
                        .filter(isNonEmptyStr)
                        .join(' ');
                      return (
                        <li key={i} className="text-sm text-white/90">
                          • {line || 'Vuelo'}
                        </li>
                      );
                    })}
                  </ul>
                </Section>
              )}

              {/* Transports */}
              {transports.length > 0 && (
                <Section title="Traslados">
                  <ul className="space-y-2">
                    {transports.map((t, i) => {
                      const mode = t?.mode || t?.type || 'Traslado';
                      const from = t?.from;
                      const to = t?.to;
                      const time = t?.time;
                      const dur = t?.duration;
                      const txt = [
                        mode,
                        from && `de ${from}`,
                        to && `a ${to}`,
                        time && `• ${time}`,
                        dur && `• ${dur}`,
                      ]
                        .filter(isNonEmptyStr)
                        .join(' ');
                      return (
                        <li key={i} className="text-sm text-white/90">
                          • {txt || mode}
                        </li>
                      );
                    })}
                  </ul>
                </Section>
              )}

              {/* Activities */}
              {activities.length > 0 && (
                <Section title="Actividades">
                  <ul className="space-y-2">
                    {activities.map((a, i) => {
                      const hour = a?.time || a?.hour;
                      const name = a?.title || a?.name || a?.activity || 'Actividad';
                      const where =
                        isNonEmptyStr(a?.location)
                          ? a.location
                          : [a?.city, a?.place].filter(isNonEmptyStr).join(', ');
                      const line = [hour, name, where && `(${where})`]
                        .filter(isNonEmptyStr)
                        .join(' • ');
                      return (
                        <li key={i} className="text-sm text-white/90">
                          • {line || name}
                        </li>
                      );
                    })}
                  </ul>
                </Section>
              )}

              {/* Hotel (sin costos) */}
              {hotel && (isNonEmptyStr(hotel?.name) || isNonEmptyStr(hotel?.area) || isNonEmptyStr(hotel?.checkin) || isNonEmptyStr(hotel?.checkout)) && (
                <Section title="Alojamiento">
                  <div className="text-sm text-white/90 space-y-1">
                    {isNonEmptyStr(hotel?.name) && <div>• {hotel.name}</div>}
                    {isNonEmptyStr(hotel?.area) && <div>• Zona: {hotel.area}</div>}
                    {isNonEmptyStr(hotel?.checkin) && <div>• Check-in: {fmtDate(hotel.checkin)}</div>}
                    {isNonEmptyStr(hotel?.checkout) && <div>• Check-out: {fmtDate(hotel.checkout)}</div>}
                    {isNonEmptyStr(hotel?.notes) && <div>• {hotel.notes}</div>}
                  </div>
                </Section>
              )}
            </div>
          ) : (
            <div className="mt-4 text-sm text-white/75">
              Sin actividades registradas para este día.
            </div>
          )}
        </div>

        {/* Footer: chips de día */}
        {days.length > 1 && (
          <div className="mt-6 flex flex-wrap items-center gap-2">
            {chip('Resumen')}
            {days.map((d, i) => (
              <button
                key={i}
                onClick={() => setIdx(i)}
                className={cx(
                  'px-3 py-1 rounded-full text-xs',
                  'bg-white/15 hover:bg-white/25 transition',
                  i === idx && 'ring-2 ring-white/60',
                )}
              >
                Día {d?.day ?? i + 1}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  if (!children) return null;
  return (
    <section>
      <h4 className="text-sm font-semibold text-white/90">{title}</h4>
      <div className="mt-2">{children}</div>
    </section>
  );
}
