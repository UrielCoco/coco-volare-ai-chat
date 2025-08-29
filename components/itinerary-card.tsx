// components/cv/ItineraryCard.tsx
"use client";
import React from "react";

type Weather = {
  tempCmin: number; tempCmax: number;
  tempFmin: number; tempFmax: number;
  humidity: number; icon: string; summary: string;
};

type Day = {
  day: number;
  date: string;
  title?: string;
  locations: { city: string; country: string }[];
  weather?: Weather;
  hotelOptions?: { name: string; area?: string; style?: string }[];
  timeline: Array<{
    time: string;
    category: "transport" | "meal" | "activity" | "hotel" | "ticket" | "reservation" | string;
    title: string;
    location: string;
    duration: string;
    optional?: boolean;
    notes?: string;
    transport?: {
      mode: "air" | "land" | "sea" | string;
      from?: { city: string; country: string };
      to?: { city: string; country: string };
      carrier?: string;
      code?: string;
      duration?: string;
      isInternational?: boolean;
      bookedByClient?: boolean;
    };
    options?: { title: string; notes?: string }[];
  }>;
};

export type Itinerary = {
  lang: "es" | "en";
  tripTitle: string;
  clientBooksLongHaulFlights?: boolean;
  disclaimer?: string;
  days: Day[];
};

export default function ItineraryCard({ data }: { data: Itinerary }) {
  const t = (es: string, en: string) => (data.lang === "es" ? es : en);

  return (
    <div className="w-full rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 shadow-lg">
      <div className="mb-3">
        <h3 className="text-lg font-semibold">{data.tripTitle}</h3>
        {data.disclaimer && (
          <p className="text-xs text-zinc-400">{data.disclaimer}</p>
        )}
      </div>

      <ol className="space-y-4">
        {data.days?.map((d) => (
          <li key={d.day} className="rounded-xl border border-zinc-800 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="font-medium">
                {t("Día", "Day")} {d.day} • {d.date}
                {d.title ? ` — ${d.title}` : ""}
              </div>
              {d.weather && (
                <div className="text-xs text-zinc-300">
                  <span className="mr-2">{d.weather.icon}</span>
                  {t("Min", "Min")} {d.weather.tempCmin}°C / {d.weather.tempFmin}°F •{" "}
                  {t("Max", "Max")} {d.weather.tempCmax}°C / {d.weather.tempFmax}°F •{" "}
                  {t("Humedad", "Humidity")} {d.weather.humidity}% • {d.weather.summary}
                </div>
              )}
            </div>

            <div className="mt-2 text-sm text-zinc-300">
              <div className="mb-2">
                <strong>{t("Ubicaciones", "Locations")}:</strong>{" "}
                {d.locations?.map(l => `${l.city}, ${l.country}`).join(" • ")}
              </div>

              {d.hotelOptions?.length ? (
                <div className="mb-2">
                  <strong>{t("Hoteles", "Hotels")}:</strong>{" "}
                  {d.hotelOptions.map(h => `${h.name}${h.area ? ` (${h.area})` : ""}${h.style ? ` — ${h.style}` : ""}`).join(" • ")}
                </div>
              ) : null}

              <div className="mt-2 space-y-2">
                {d.timeline?.map((tln, idx) => (
                  <div key={idx} className="rounded-lg bg-zinc-800/60 p-2">
                    <div className="text-zinc-200">
                      <span className="font-mono mr-2">{tln.time}</span>
                      <span className="uppercase tracking-wide text-xs text-zinc-400">{tln.category}</span>{" "}
                      — <span className="font-medium">{tln.title}</span>
                    </div>
                    <div className="text-xs text-zinc-300">
                      {t("Ubicación", "Location")}: {tln.location} • {t("Duración", "Duration")}: {tln.duration}
                      {tln.optional ? ` • ${t("Opcional", "Optional")}` : ""}
                      {tln.transport && (
                        <>
                          {" • "}{t("Transporte", "Transport")}: {tln.transport.mode}
                          {tln.transport.from && ` • ${t("De", "From")}: ${tln.transport.from.city}, ${tln.transport.from.country}`}
                          {tln.transport.to && ` • ${t("A", "To")}: ${tln.transport.to.city}, ${tln.transport.to.country}`}
                          {typeof tln.transport.isInternational === "boolean" && (tln.transport.isInternational ? " • Intl" : "")}
                          {typeof tln.transport.bookedByClient === "boolean" && (tln.transport.bookedByClient ? ` • ${t("Cliente reserva", "Client books")}` : "")}
                        </>
                      )}
                      {tln.notes ? ` • ${t("Notas", "Notes")}: ${tln.notes}` : ""}
                    </div>
                    {tln.options?.length ? (
                      <div className="mt-1 text-xs text-zinc-300">
                        <strong>{t("Opciones", "Options")}:</strong>{" "}
                        {tln.options.map(o => o.title).join(" / ")}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
