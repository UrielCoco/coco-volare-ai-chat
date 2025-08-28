// components/ItineraryRenderer.tsx
"use client";

import React from "react";
import type { ItineraryDraftT } from "@/lib/ai/schemas";

export default function ItineraryRenderer({ data }: { data: ItineraryDraftT }) {
  return (
    <div className="cv-container">
      <header className="cv-header">
        <div className="cv-logo" />
        <h1 className="cv-title">Itinerario</h1>
      </header>

      <div className={`cv-accent-${data.brandMeta.accent}`} />

      <div className="cv-grid">
        <section className="cv-days">
          {data.days.map((d) => (
            <article key={d.dayNumber} className="cv-card">
              <div className="cv-card-head">
                <span className="cv-day">Día {d.dayNumber}</span>
                <h3 className="cv-card-title">{d.title}</h3>
              </div>
              <ul className="cv-activities">
                {d.activities.map((a, i) => (
                  <li key={i} className="cv-act">
                    <div className="cv-time">{a.timeRange || ""}</div>
                    <div className="cv-act-body">
                      <div className="cv-act-title">{a.title}</div>
                      <div className="cv-act-desc">{a.description}</div>
                      {a.logistics && <div className="cv-act-logistics">Logística: {a.logistics}</div>}
                    </div>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </section>
        <aside className="cv-aside">
          <div className="cv-summary">
            <h4>Resumen</h4>
            <div>Perfil: {data.travelerProfile}</div>
            <div>Moneda: {data.currency}</div>
            <div>Bases: {data.cityBases.join(", ")}</div>
          </div>
          <a className="cv-btn" href="#download">Descargar PDF</a>
          <a className="cv-btn-outline" href="#advisor">Hablar con asesor</a>
        </aside>
      </div>
    </div>
  );
}
