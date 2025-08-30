import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

export const runtime = 'nodejs';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

export async function POST(req: NextRequest) {
  try {
    const { threadId, runId } = await req.json();

    if (!threadId) {
      return NextResponse.json({ error: 'threadId requerido' }, { status: 400 });
    }

    // Si no llega runId, buscamos el activo más reciente
    let targetRunId: string | undefined = runId;
    if (!targetRunId) {
      // list: tu versión acepta bien la firma posicional
      const list = await client.beta.threads.runs.list(threadId, { order: 'desc', limit: 5 });
      const active = list.data.find(r =>
        ['queued', 'in_progress', 'requires_action', 'cancelling'].includes(String(r.status))
      );
      if (active) targetRunId = active.id;
    }

    if (!targetRunId) {
      return NextResponse.json({ ok: true, info: 'no-active-run' });
    }

    // 👇 FIX mínimo por desajuste de typings en 5.11/5.12:
    //    El runtime espera OBJETO { thread_id, run_id } pero TS a veces exige posicional.
    //    Casteamos sólo "runs" a any para evitar la pelea de sobrecargas.
    const runsAny = client.beta.threads.runs as any;

    await runsAny.cancel({ thread_id: threadId, run_id: targetRunId });

    // Confirmación rápida (poll corto)
    const t0 = Date.now();
    let status = 'cancelling';
    while (status !== 'cancelled' && Date.now() - t0 < 8000) {
      const run = await runsAny.retrieve({ thread_id: threadId, run_id: targetRunId });
      status = String(run.status);
      if (status === 'cancelled') break;
      await new Promise((r: any) => setTimeout(r, 250));
    }

    return NextResponse.json({ ok: true, status, runId: targetRunId });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'cancel error' }, { status: 500 });
  }
}
