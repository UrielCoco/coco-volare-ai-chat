"use client";

import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

type Activity = {
  timeRange?: string;
  title: string;
  description: string;
  logistics?: string;
  icon?: string;              // opcional
  lat?: number;               // opcional
  lng?: number;               // opcional
  address?: string;           // opcional
};

type ItineraryDay = {
  dayNumber: number;
  title: string;
  date?: string;
  breakfastIncluded?: boolean;
  activities: Activity[];
  notes?: string;
};

type BrandMeta = {
  templateId: "CV-LUX-01" | "CV-CORP-01" | "CV-ADVENTURE-01";
  accent?: "gold" | "black" | "white";
  watermark?: boolean;
};

export type ItineraryDraft = {
  brandMeta: BrandMeta;
  travelerProfile: "corporate" | "leisure" | "honeymoon" | "bleisure";
  currency: "USD" | "COP" | "MXN" | "EUR";
  cityBases: string[];
  days: ItineraryDay[];
  // opcionales para enriquecer UI
  hotelOptions?: Array<{ name: string; note?: string }>;
  restaurantIdeas?: Array<{ name: string; note?: string }>;
  transfers?: Array<{ label: string }>;
};

function AccentBar({ accent }: { accent?: BrandMeta["accent"] }) {
  const color =
    accent === "black" ? "bg-black" : accent === "white" ? "bg-white" : "bg-amber-500";
  return <div className={`h-1 w-full ${color} rounded-full`} />;
}

function MapEmbed({ lat, lng, title }: { lat: number; lng: number; title?: string }) {
  const src = useMemo(() => {
    // OpenStreetMap embed sin API key
    // Nota: bbox amplio para asegurar carga del marker
    const bbox = `${lng - 0.02}%2C${lat - 0.02}%2C${lng + 0.02}%2C${lat + 0.02}`;
    return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat}%2C${lng}`;
  }, [lat, lng]);

  return (
    <div className="rounded-xl overflow-hidden border border-white/10">
      <iframe
        title={title || "map"}
        src={src}
        className="w-full h-56"
        loading="lazy"
      />
      <a
        className="block text-xs text-amber-400 hover:underline px-2 py-1 bg-black/40"
        target="_blank"
        rel="noreferrer"
        href={`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`}
      >
        Ver en mapa ↗
      </a>
    </div>
  );
}

function DayCard({ day }: { day: ItineraryDay }) {
  const [open, setOpen] = useState(true);

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-md p-4 md:p-5">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between text-left"
      >
        <div>
          <p className="text-sm text-white/70">Día {day.dayNumber}</p>
          <h3 className="text-lg md:text-xl font-semibold">{day.title}</h3>
          {day.date ? (
            <p className="text-xs text-white/60 mt-1">{day.date}</p>
          ) : null}
        </div>
        <span className="text-white/70 text-sm">{open ? "–" : "+"}</span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <div className="mt-4 space-y-4">
              {day.breakfastIncluded ? (
                <div className="text-sm text-white/90">
                  🥐 Desayuno incluido
                </div>
              ) : null}

              {day.activities?.map((a, i) => (
                <div
                  key={i}
                  className="rounded-xl border border-white/10 bg-black/30 p-3 md:p-4"
                >
                  <div className="flex items-start gap-3">
                    <div className="shrink-0">
                      <div className="w-10 h-10 rounded-lg bg-amber-500/15 flex items-center justify-center">
                        <span className="text-amber-400">
                          {a.icon || "★"}
                        </span>
                      </div>
                    </div>
                    <div className="grow">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        {a.timeRange ? (
                          <span className="text-[11px] px-2 py-1 rounded-lg border border-white/10 bg-white/5">
                            {a.timeRange}
                          </span>
                        ) : null}
                        <h4 className="text-base md:text-lg font-semibold">
                          {a.title}
                        </h4>
                      </div>
                      <p className="text-sm text-white/90 mt-1">{a.description}</p>
                      {a.logistics ? (
                        <p className="text-xs text-white/60 italic mt-1">
                          (Logística: {a.logistics})
                        </p>
                      ) : null}
                      {(a.lat && a.lng) ? (
                        <div className="mt-3">
                          <MapEmbed lat={a.lat!} lng={a.lng!} title={a.title} />
                          {a.address ? (
                            <p className="text-xs text-white/60 mt-1">{a.address}</p>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}

              {day.notes ? (
                <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-white/80">
                  {day.notes}
                </div>
              ) : null}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function ItineraryCard({
  data,
  title = "Itinerario Exclusivo Coco Volare",
}: {
  data: ItineraryDraft;
  title?: string;
}) {
  const accent = data?.brandMeta?.accent || "gold";

  return (
    <div className="w-full max-w-3xl rounded-3xl bg-gradient-to-b from-black/70 to-black/50 border border-white/10 p-4 md:p-6 text-white shadow-2xl">
      <AccentBar accent={accent} />
      <h2 className="text-xl md:text-2xl font-extrabold mt-4">
        ✨ {title} – {data?.cityBases?.[0] || "Destino"}
      </h2>

      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
        <div className="rounded-xl bg-black/30 border border-white/10 p-3">
          <span className="font-semibold">Brand:</span>{" "}
          {data.brandMeta.templateId} ·{" "}
          <span className="font-semibold">Acento:</span>{" "}
          {data.brandMeta.accent || "gold"}
        </div>
        <div className="rounded-xl bg-black/30 border border-white/10 p-3">
          <span className="font-semibold">Perfil:</span> {data.travelerProfile} ·{" "}
          <span className="font-semibold">Moneda:</span> {data.currency}
        </div>
      </div>

      {/* listas opcionales */}
      {(data.transfers?.length || data.hotelOptions?.length || data.restaurantIdeas?.length) ? (
        <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
          {data.transfers?.length ? (
            <div className="rounded-xl bg-black/30 border border-white/10 p-3">
              <p className="font-semibold mb-2">🚘 Traslados</p>
              <ul className="list-disc list-inside space-y-1">
                {data.transfers.map((t, i) => (
                  <li key={i}>{t.label}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {data.hotelOptions?.length ? (
            <div className="rounded-xl bg-black/30 border border-white/10 p-3">
              <p className="font-semibold mb-2">🏨 Hoteles sugeridos</p>
              <ul className="list-disc list-inside space-y-1">
                {data.hotelOptions.map((h, i) => (
                  <li key={i}>
                    {h.name}
                    {h.note ? <span className="text-white/60"> — {h.note}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {data.restaurantIdeas?.length ? (
            <div className="rounded-xl bg-black/30 border border-white/10 p-3">
              <p className="font-semibold mb-2">🍽️ Restaurantes</p>
              <ul className="list-disc list-inside space-y-1">
                {data.restaurantIdeas.map((r, i) => (
                  <li key={i}>
                    {r.name}
                    {r.note ? <span className="text-white/60"> — {r.note}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="mt-6 space-y-4">
        {data.days?.map((d) => (
          <DayCard key={d.dayNumber} day={d} />
        ))}
      </div>
    </div>
  );
}
