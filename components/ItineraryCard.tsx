"use client";

import React from "react";
import { motion } from "framer-motion";

export type Activity = {
  timeRange?: string;
  title: string;
  description?: string;
  logistics?: string;
  icon?: string;
};

export type ItineraryDay = {
  dayNumber: number;
  title: string;
  date?: string;
  breakfastIncluded?: boolean;
  activities: Activity[];
  notes?: string;
};

export type BrandMeta = {
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
  notes?: string;
};

function AccentBar({ accent = "gold" }: { accent?: BrandMeta["accent"] }) {
  const color =
    accent === "black"
      ? "from-zinc-900 to-zinc-700"
      : accent === "white"
      ? "from-zinc-50 to-zinc-200"
      : "from-amber-400 to-yellow-600";
  return <div className={`h-1 w-full bg-gradient-to-r ${color} rounded-full`} />;
}

export default function ItineraryCard({ data }: { data: ItineraryDraft }) {
  const { brandMeta, travelerProfile, currency, cityBases, days, notes } = data;
  const accent = brandMeta?.accent ?? "gold";

  return (
    <div className="flex-1">
      <div className="rounded-2xl border border-white/10 bg-zinc-950 text-zinc-100 shadow-2xl overflow-hidden">
        <div className="p-5 md:p-6">
          <div className="mb-3">
            <AccentBar accent={accent} />
          </div>

          <h2 className="text-xl md:text-2xl font-semibold tracking-tight">
            ✨ Itinerario Exclusivo Coco Volare — {cityBases?.[0] ?? "Destino"}
          </h2>

          <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-2 text-sm text-zinc-300">
            <div>
              <span className="font-semibold">Brand:</span> {brandMeta.templateId} ·{" "}
              <span className="font-semibold">Acento:</span> {accent}
            </div>
            <div>
              <span className="font-semibold">Perfil:</span> {travelerProfile}
            </div>
            <div>
              <span className="font-semibold">Moneda:</span> {currency}
            </div>
          </div>

          {notes ? (
            <div className="mt-3 text-sm text-zinc-300">
              <span className="font-semibold">Notas:</span> {notes}
            </div>
          ) : null}

          <div className="mt-5 space-y-4">
            {days?.map((d, idx) => (
              <motion.details
                key={idx}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.05 }}
                className="group rounded-xl border border-white/10 bg-black/40 open:bg-black/60"
                open={idx === 0}
              >
                <summary className="cursor-pointer select-none list-none px-4 py-3 md:px-5 md:py-4 text-amber-400 font-semibold flex items-center justify-between">
                  <span>
                    Día {d.dayNumber} — {d.title}
                  </span>
                  <span className="text-xs text-zinc-400 ml-3">
                    {d.breakfastIncluded ? "Desayuno incluido" : ""}
                  </span>
                </summary>

                <div className="px-4 pb-4 md:px-5 md:pb-5 space-y-3 text-sm">
                  {d.activities?.length ? (
                    d.activities.map((a, i) => (
                      <div
                        key={i}
                        className="rounded-xl border border-white/10 bg-zinc-900 p-3 md:p-4"
                      >
                        {a.timeRange ? (
                          <div className="mb-2 text-xs rounded-lg border border-white/10 bg-black/40 inline-block px-2 py-1 text-zinc-300">
                            {a.timeRange}
                          </div>
                        ) : null}
                        <div className="font-semibold text-zinc-100">{a.title}</div>
                        {a.description ? (
                          <div className="text-zinc-300">{a.description}</div>
                        ) : null}
                        {a.logistics ? (
                          <div className="text-zinc-400 italic text-xs">
                            (Logística: {a.logistics})
                          </div>
                        ) : null}
                      </div>
                    ))
                  ) : (
                    <div className="text-zinc-400 italic">Actividades por definir.</div>
                  )}
                  {d.notes ? <div className="text-zinc-300">{d.notes}</div> : null}
                </div>
              </motion.details>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
