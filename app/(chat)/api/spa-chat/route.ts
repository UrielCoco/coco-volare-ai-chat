// app/(chat)/api/spa-chat/route.ts
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

type Msg = { role: 'user' | 'assistant' | 'system'; content: string };

function iso(d: string) {
  // Normaliza a YYYY-MM-DD (sin TZ)
  return new Date(d + 'T00:00:00').toISOString().slice(0, 10);
}

/**
 * Heurística simple:
 * - Si el último mensaje del usuario contiene “itinerario”, “Estambul” o “Capadocia”,
 *   responde con un parcial de itinerario de demo (12–15 Oct 2025) y resume el pedido.
 */
function buildItineraryPartialFrom(messages: Msg[]) {
  const lastUser = [...messages].reverse().find(m => m.role === 'user');
  const text = (lastUser?.content || '').toLowerCase();

  const looksLikeTrip =
    /itinerario|estambul|istanbul|capadocia|cappadocia/.test(text);

  if (!looksLikeTrip) return null;

  // Demo: 12–15 oct 2025 (1N Estambul, 2N Capadocia)
  const start = iso('2025-10-12');
  const d1 = iso('2025-10-12');
  const d2 = iso('2025-10-13');
  const d3 = iso('2025-10-14');
  const end = iso('2025-10-15');

  return {
    meta: {
      tripTitle: 'Estambul + Capadocia — 12–15 Oct 2025',
      startDate: start,
      endDate: end,
      currency: 'USD',
    },
    summary: {
      rawNote:
        'Estilo: lujo/boutique, ritmo moderado, sin mariscos. Imprescindibles: globo al amanecer, hamam tradicional, cena rooftop.',
    },
    flights: {
      originCountry: 'MX',
      originCity: 'Ciudad de México',
      returnCountry: 'MX',
      returnCity: 'Ciudad de México',
    },
    days: [
      {
        date: d1,
        city: 'Estambul',
        country: 'TR',
        plan: [
          { time: 'Llegada', activity: 'Arribo y traslado privado al hotel.' },
          { time: 'Tarde', activity: 'Paseo ligero barrio histórico.' },
          { time: 'Noche', activity: 'Cena en rooftop con vista.' },
        ],
        hotel: {
          name: 'Boutique con vista',
          nights: 1,
          notes: 'Zona caminable, categoría lujo/boutique.',
        },
      },
      {
        date: d2,
        city: 'Capadocia',
        country: 'TR',
        plan: [
          {
            time: 'Mañana',
            activity: 'Vuelo Estambul → Capadocia y check-in.',
          },
          { time: 'Tarde', activity: 'Tour privado valles menos concurridos.' },
          { time: 'Noche', activity: 'Cena tranquila en hotel.' },
        ],
        hotel: { name: 'Cueva boutique', nights: 2, notes: '' },
      },
      {
        date: d3,
        city: 'Capadocia',
        country: 'TR',
        plan: [
          { time: 'Amanecer', activity: 'Paseo en globo (privado si es posible).' },
          { time: 'Tarde', activity: 'Hamam tradicional / tiempo libre.' },
          { time: 'Noche', activity: 'Cena especial.' },
        ],
      },
    ],
    transports: [
      {
        type: 'flight',
        from: 'Estambul (IST/SAW)',
        to: 'Capadocia (NAV/ASR)',
        date: d2,
        private: false,
        notes: 'Vuelo doméstico recomendado por la mañana.',
      },
      {
        type: 'flight',
        from: 'Capadocia',
        to: 'Estambul',
        date: d3,
        private: false,
        notes: 'Regreso a Estambul si se necesitara conexión internacional.',
      },
      {
        type: 'private',
        from: 'Aeropuerto',
        to: 'Hotel',
        date: d1,
        notes: 'Traslado privado aeropuerto ↔ hotel.',
      },
    ],
    extras: [
      { kind: 'diet', value: 'Sin mariscos' },
      { kind: 'preference', value: 'Evitar multitudes' },
      { kind: 'contact', value: 'daniela.torres@example.com / +573001112233' },
      { kind: 'note', value: 'Prefiere WhatsApp' },
    ],
    lights: {
      // campos auxiliares si tu UI los usa (opcionales)
    },
  };
}

export async function GET() {
  return NextResponse.json(
    { ok: true, message: 'spa-chat vivo. Usa POST para conversar.' },
    { status: 200 }
  );
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      messages?: Msg[];
    };

    const messages = body?.messages ?? [];
    const itineraryPartial = buildItineraryPartialFrom(messages);

    const assistantText = itineraryPartial
      ? 'Perfecto, ya armé un primer borrador del itinerario (puedes seguir refinando y lo iré actualizando).'
      : 'Recibido. ¿En qué parte del itinerario quieres que trabaje?';

    return NextResponse.json(
      {
        assistantText,
        itineraryPartial: itineraryPartial || null,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error('[spa-chat] error:', err);
    return NextResponse.json(
      { error: 'Internal Error in /api/spa-chat' },
      { status: 500 }
    );
  }
}
