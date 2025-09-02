import React from 'react';

type Itinerary = {
  tripTitle?: string;
  days?: any[];
  disclaimer?: string;
  [k: string]: any;
};

export default function ItineraryCard({ itinerary }: { itinerary?: Itinerary }) {
  if (!itinerary || !Array.isArray(itinerary.days)) {
    // Evita tarjeta vacía si llegase un objeto inválido
    return (
      <div className="rounded-xl border bg-card text-card-foreground shadow-sm p-4">
        <div className="text-sm opacity-70">Sin datos cargados en el itinerario.</div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-card text-card-foreground shadow-sm p-4">
      <div className="text-xs uppercase opacity-60 mb-1">Itinerario</div>
      <div className="text-lg font-semibold mb-2">
        {itinerary.tripTitle || 'Viaje'}
      </div>
      <div className="text-sm opacity-70">
        {itinerary.days.length} {itinerary.days.length === 1 ? 'día' : 'días'}
      </div>
      {itinerary.disclaimer ? (
        <div className="text-xs opacity-60 mt-3">{itinerary.disclaimer}</div>
      ) : null}
    </div>
  );
}
