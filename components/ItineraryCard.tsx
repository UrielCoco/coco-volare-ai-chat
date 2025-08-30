'use client';

type Props = {
  data: any; // el JSON del itinerario
};

/**
 * Render básico. Adáptalo a tu diseño visual.
 * Espera campos típicos: title, days[], price, currency, notes, etc.
 */
export default function ItineraryCard({ data }: Props) {
  return (
    <div className="w-full flex justify-start">
      <div className="w-full max-w-3xl rounded-2xl border border-white/10 bg-white text-black shadow p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">{data?.title || 'Itinerario'}</h3>
          {data?.price ? (
            <span className="text-sm font-medium">
              {data.price} {data.currency || ''}
            </span>
          ) : null}
        </div>

        {Array.isArray(data?.days) && (
          <ol className="space-y-2">
            {data.days.map((d: any, i: number) => (
              <li key={i} className="rounded-lg bg-neutral-50 p-3">
                <div className="font-semibold">Día {d?.day || i + 1}: {d?.title || d?.summary || ''}</div>
                {Array.isArray(d?.activities) && (
                  <ul className="list-disc pl-5">
                    {d.activities.map((a: any, j: number) => (
                      <li key={j}>{a?.time ? `${a.time} — ` : ''}{a?.name || a?.title || a}</li>
                    ))}
                  </ul>
                )}
                {d?.notes && <div className="text-sm opacity-80 mt-1">{d.notes}</div>}
              </li>
            ))}
          </ol>
        )}

        {data?.notes && (
          <div className="text-sm opacity-80">{data.notes}</div>
        )}
      </div>
    </div>
  );
}
