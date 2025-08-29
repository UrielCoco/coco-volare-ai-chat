// /app/(chat)/api/chat/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { runAssistantOnce } from '@/lib/ai/providers/openai-assistant';
import { kommoAddNote, kommoCreateLead } from '@/lib/kommo-sync';

// Detecta bloque oculto enviado por el assistant para efectos CRM
const RE_KOMMO = /```cv:kommo\s*([\s\S]*?)```/i;

export const runtime = 'nodejs';
// Evita que Next intente cachear nada de esta API
export const dynamic = 'force-dynamic';

/** Normaliza respuestas de tu wrapper de Kommo a un leadId:number */
function pickLeadId(x: any): number | null {
  if (typeof x === 'number') return x;
  if (!x || typeof x !== 'object') return null;
  if (typeof x.lead_id === 'number') return x.lead_id;
  if (typeof x.id === 'number') return x.id;
  if (typeof x?.data?.lead_id === 'number') return x.data.lead_id;
  if (Array.isArray(x?.data?.leads) && typeof x.data.leads[0]?.id === 'number') return x.data.leads[0].id;
  return null;
}

/** ✅ Sanity-check: útil para ver si la ruta está viva (evita 405 por confusión) */
export async function GET() {
  return NextResponse.json({ ok: true, route: '/api/chat' });
}

/** ✅ CORS/preflight para integraciones embebidas */
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST,GET,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

/** ✅ Handler principal: ¡esto es lo que evita el 405! */
export async function POST(req: NextRequest) {
  const traceId = `cv_${Math.random().toString(36).slice(2)}`;

  try {
    // ——— lee body flexible (como lo manda tu front) ———
    const body = await req.json().catch(() => ({} as any));
    const rawText =
      body?.message?.parts?.[0]?.text ??
      body?.message?.text ??
      body?.message ??
      body?.text ??
      '';

    const userInput: string = String(rawText || '').trim();
    const threadId: string | undefined = body?.threadId || body?.thread_id || undefined;

    // ——— corre el assistant (ya maneja requires_action internamente) ———
    const { reply, threadId: ensuredThread } = await runAssistantOnce({
      input: userInput,
      threadId,
      metadata: { source: 'webchat' },
    });

    // ——— ejecuta cv:kommo en paralelo; NO bloquea la respuesta ———
    const m = reply.match(RE_KOMMO);
    if (m?.[1]) {
      try {
        const ops = JSON.parse(m[1]);

        (async () => {
          try {
            const list = Array.isArray(ops?.ops) ? ops.ops : [];
            let leadId: number | null = null;

            if (list.some((o: any) => o?.action === 'create_lead')) {
              // tu wrapper espera un string (no objeto)
              const created = await kommoCreateLead('Lead desde webchat');
              leadId = pickLeadId(created);
              console.log('[CV][kommo] leadId', leadId);
            }

            for (const op of list) {
              if (op?.action === 'add_note' && leadId != null) {
                const text =
                  typeof op?.text === 'string'
                    ? op.text
                    : `🧑‍💻 Usuario: ${userInput.slice(0, 500)}`;
                await kommoAddNote(leadId, text); // (leadId:number, text:string)
              }
            }
          } catch (err) {
            console.warn('[CV][kommo] failed:', err);
          }
        })();
      } catch (err) {
        console.warn('[CV][kommo] invalid json:', err);
      }
    }

    // ——— respuesta al front: tal cual (para que el front parsee cv:itinerary) ———
    const res = NextResponse.json({
      reply,
      threadId: ensuredThread || threadId || null,
    });

    // CORS headers (si lo usas embebido en otras origins)
    res.headers.set('Access-Control-Allow-Origin', '*');
    res.headers.set('Access-Control-Allow-Methods', 'POST,GET,OPTIONS');
    res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    return res;
  } catch (e: any) {
    console.error(
      JSON.stringify({
        level: 'error',
        tag: '[CV][server]',
        msg: 'exception',
        meta: { traceId, error: String(e?.message || e) },
      }),
    );

    const reply =
      'Ocurrió un error, lamentamos los inconvenientes. / An error occurred, we apologize for the inconvenience.';

    return NextResponse.json({ reply }, { status: 500 });
  }
}
