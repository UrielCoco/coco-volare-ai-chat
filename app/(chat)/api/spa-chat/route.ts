import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

type Msg = { role: 'user' | 'assistant' | 'system'; content: string };

function iso(d: string) {
  return new Date(d + 'T00:00:00').toISOString().slice(0, 10);
}

function buildDemoPartial(messages: Msg[]) {
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  const text = (lastUser?.content || '').toLowerCase();
  const looksLikeTrip = /itinerario|estambul|istanbul|capadocia|cappadocia/.test(text);
  if (!looksLikeTrip) return null;

  const start = iso('2025-10-12');
  const d1 = iso('2025-10-12');
  const d2 = iso('2025-10-13');
  const d3 = iso('2025-10-14');
  const end = iso('2025-10-15');

  return {
    meta: { tripTitle: 'Estambul + Capadocia — 12–15 Oct 2025', startDate: start, endDate: end, currency: 'USD' },
    summary: {
      rawNote:
        'Estilo: lujo/boutique, moderado, sin mariscos. Imprescindibles: globo, hamam, cena rooftop.',
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
          { time: 'Llegada', activity: 'Traslado privado a hotel' },
          { time: 'Tarde', activity: 'Paseo barrio histórico' },
          { time: 'Noche', activity: 'Cena rooftop' },
        ],
        hotel: { name: 'Boutique con vista', nights: 1, notes: 'Zona caminable' },
      },
      {
        date: d2,
        city: 'Capadocia',
        country: 'TR',
        plan: [
          { time: 'Mañana', activity: 'Vuelo IST→Capadocia y check-in' },
          { time: 'Tarde', activity: 'Valles poco concurridos (privado)' },
          { time: 'Noche', activity: 'Cena en hotel' },
        ],
        hotel: { name: 'Cueva boutique', nights: 2, notes: '' },
      },
      {
        date: d3,
        city: 'Capadocia',
        country: 'TR',
        plan: [
          { time: 'Amanecer', activity: 'Paseo en globo' },
          { time: 'Tarde', activity: 'Hamam tradicional / libre' },
          { time: 'Noche', activity: 'Cena especial' },
        ],
      },
    ],
    transports: [
      { type: 'flight', from: 'Estambul', to: 'Capadocia', date: d2, private: false, notes: 'Doméstico AM' },
      { type: 'flight', from: 'Capadocia', to: 'Estambul', date: d3, private: false, notes: 'Regreso si aplica' },
      { type: 'private', from: 'Aeropuerto', to: 'Hotel', date: d1, notes: 'Traslado privado' },
    ],
    extras: [
      { kind: 'diet', value: 'Sin mariscos' },
      { kind: 'preference', value: 'Evitar multitudes' },
      { kind: 'contact', value: 'daniela.torres@example.com / +573001112233 (WhatsApp)' },
    ],
    lights: {},
  };
}

function log(reqId: string, msg: string, data?: any) {
  const base = { reqId, ts: new Date().toISOString(), msg };
  // En Vercel aparecerá como una sola línea JSON
  console.log(JSON.stringify(data ? { ...base, data } : base));
}

export async function GET() {
  return NextResponse.json({ ok: true, message: 'spa-chat OK (GET). Usa POST.' }, { status: 200 });
}

export async function POST(req: NextRequest) {
  const reqId = Math.random().toString(36).slice(2, 8);
  try {
    const body = (await req.json()) as { messages?: Msg[] };
    const messages = body?.messages ?? [];

    log(reqId, 'request.received', {
      url: req.nextUrl.pathname,
      method: 'POST',
      msgCount: messages.length,
      vercel: process.env.VERCEL ? true : false,
      env: { AUTO_DRAFT: process.env.AUTO_DRAFT ?? '0' },
    });

    const AUTO = process.env.AUTO_DRAFT === '1';
    const demoPartial = AUTO ? buildDemoPartial(messages) : null;

    const assistantText = demoPartial
      ? 'Perfecto, ya armé un primer borrador del itinerario (puedes seguir refinando y lo iré actualizando).'
      : ''; // sin respuesta automática si no hay parcial

    const payload = {
      assistantText,
      itineraryPartial: demoPartial || null,
    };

    log(reqId, 'response.sending', {
      hasAssistantText: Boolean(assistantText),
      hasPartial: Boolean(demoPartial),
    });

    return NextResponse.json(payload, { status: 200 });
  } catch (err: any) {
    log(reqId, 'error', { message: err?.message, stack: err?.stack });
    return NextResponse.json({ error: 'Internal Error in /api/spa-chat' }, { status: 500 });
  }
}
