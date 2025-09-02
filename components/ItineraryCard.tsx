'use client';

export type Itinerary = {
  lang?: string;
  tripTitle?: string;
  clientBooksLongHaulFlights?: boolean;
  disclaimer?: string;
  days?: Array<{
    day: number;
    date?: string;
    title?: string;
    locations?: Array<{ city?: string; country?: string }>;
    weather?: {
      tempCmin?: number; tempCmax?: number;
      tempFmin?: number; tempFmax?: number;
      humidity?: number; icon?: string; summary?: string;
    };
    hotelOptions?: Array<{ name?: string; area?: string; style?: string }>;
    timeline?: Array<{
      time?: string;
      category?: string;
      title?: string;
      location?: string;
      duration?: string;
      optional?: boolean;
      notes?: string;
    }>;
  }>;
};

function Row({ label, value }: { label: string; value?: string | number | boolean }) {
  if (value === undefined || value === null || value === '') return null;
  return (
    <div className="flex gap-2 text-sm">
      <div className="text-gray-500 w-28">{label}</div>
      <div className="flex-1">{String(value)}</div>
    </div>
  );
}

export default function ItineraryCard({ itinerary }: { itinerary: Itinerary }) {
  const d = itinerary || {};
  return (
    <div className="rounded-2xl border shadow-sm overflow-hidden">
      <div className="px-4 py-3 bg-gray-50 border-b">
        <div className="text-sm font-medium text-gray-500">Itinerario</div>
        <div className="text-lg font-semibold">{d.tripTitle || 'Viaje'}</div>
      </div>

      <div className="p-4 space-y-4">
        <Row label="Idioma" value={d.lang} />
        <Row label="Vuelos Larga Distancia" value={d.clientBooksLongHaulFlights ? 'Cliente' : undefined} />
        {d.disclaimer ? (
          <div className="text-xs text-gray-500 whitespace-pre-wrap">{d.disclaimer}</div>
        ) : null}

        {Array.isArray(d.days) && d.days.length > 0 ? (
          <div className="space-y-4">
            {d.days.map((day) => (
              <div key={day.day} className="rounded-xl border p-3">
                <div className="font-semibold mb-1">
                  Día {day.day}{day.title ? ` — ${day.title}` : ''}{day.date ? ` (${day.date})` : ''}
                </div>
                {day.locations && day.locations.length > 0 ? (
                  <div className="text-sm text-gray-600 mb-1">
                    {day.locations.map((l) => [l.city, l.country].filter(Boolean).join(', ')).join(' · ')}
                  </div>
                ) : null}
                {day.weather ? (
                  <div className="text-sm text-gray-600 mb-2">
                    {day.weather.icon || ''} {day.weather.summary || ''}
                    {day.weather.tempCmin !== undefined && day.weather.tempCmax !== undefined
                      ? ` · ${day.weather.tempCmin}–${day.weather.tempCmax} °C`
                      : ''}
                  </div>
                ) : null}
                {Array.isArray(day.hotelOptions) && day.hotelOptions.length > 0 ? (
                  <div className="text-sm mb-2">
                    <div className="font-medium">Hoteles sugeridos</div>
                    <ul className="list-disc pl-5">
                      {day.hotelOptions.map((h, i) => (
                        <li key={i}>{[h.name, h.area, h.style].filter(Boolean).join(' — ')}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {Array.isArray(day.timeline) && day.timeline.length > 0 ? (
                  <div className="text-sm">
                    <div className="font-medium">Agenda</div>
                    <ul className="list-disc pl-5 space-y-1">
                      {day.timeline.map((t, i) => (
                        <li key={i}>
                          <span className="font-mono mr-1">{t.time}</span>
                          <span className="font-semibold">{t.title}</span>
                          {t.location ? ` · ${t.location}` : ''}
                          {t.optional ? ' (opcional)' : ''}
                          {t.notes ? ` — ${t.notes}` : ''}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-gray-500">Sin días cargados en el itinerario.</div>
        )}
      </div>
    </div>
  );
}
