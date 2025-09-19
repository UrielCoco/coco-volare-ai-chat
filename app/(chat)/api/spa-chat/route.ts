// app/(chat)/api/spa-chat/route.ts
import { NextRequest, NextResponse } from 'next/server';

// Si prefieres Edge, cambia a: export const runtime = 'edge';
export const runtime = 'nodejs';

/**
 * Health-check / debug rápido:
 *  - GET  -> responde que el endpoint está vivo
 *  - POST -> hace echo del body y retorna un texto "assistantText"
 */
export async function GET() {
  return NextResponse.json(
    { ok: true, message: 'spa-chat vivo. Usa POST para conversar.' },
    { status: 200 }
  );
}

export async function POST(req: NextRequest) {
  try {
    // Intenta parsear el JSON que envía el ChatPanel
    const body = await req
      .json()
      .catch(() => null as unknown as Record<string, unknown> | null);

    // ----
    // Aquí luego pegamos la lógica real (OpenAI/tool-calls/etc.)
    // Por ahora devolvemos una respuesta de verificación de conectividad.
    // ----
    return NextResponse.json(
      {
        assistantText: 'Hola 👋 — backend /api/spa-chat conectado correctamente ✅',
        echo: body ?? null, // útil para depurar que sí llega tu mensaje
        // itineraryPartial: {...} // cuando quieras actualizar el JSON central, colócalo aquí
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
