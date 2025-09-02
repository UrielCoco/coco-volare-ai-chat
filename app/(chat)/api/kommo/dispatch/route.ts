import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

type KommoOp = { action: string; [k: string]: any };
type BodyIn =
  | { internal?: string; ops?: KommoOp[]; threadId?: string | null }
  | { ops?: KommoOp[]; threadId?: string | null }
  | any;

function hasOps(b: any): b is { ops: KommoOp[] } {
  return b && Array.isArray(b.ops);
}

async function forwardToHubBrain(payload: { ops: KommoOp[]; threadId?: string | null }) {
  const url = process.env.HUB_BRAIN_URL;      // ej: https://hub-brain.yourdomain.com/api/kommo/dispatch
  const token = process.env.HUB_BRAIN_TOKEN;  // Bearer
  if (!url) return { ok: false, reason: 'HUB_BRAIN_URL not set' };

  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ ...payload, source: 'coco-volare-ui' }),
  });
  const text = await r.text().catch(() => '');
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch {}
  return { ok: r.ok, status: r.status, data: data ?? text, forwarded: 'hub-brain' as const };
}

async function tryLocalKommoSync(payload: { ops: KommoOp[]; threadId?: string | null }) {
  try {
    // Detecta varias posibles exportaciones
    const mod: any = await import('@/lib/kommo-sync');
    const cand =
      mod?.syncKommoOps ??
      mod?.dispatchKommoOps ??
      mod?.kommoSync ??
      mod?.default;

    if (typeof cand === 'function') {
      const out = await cand(payload);
      return { ok: true, data: out, forwarded: 'local' as const };
    }
    return { ok: false, reason: 'No suitable export in lib/kommo-sync' };
  } catch (err: any) {
    return { ok: false, reason: err?.message || 'Local sync import error' };
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as BodyIn;

    // Aceptar ambos formatos: {internal:"kommo", ops} o {ops}
    const internal = String((body as any)?.internal || '').toLowerCase();
    const payloadOps = hasOps(body) ? body.ops! : [];
    const ops = Array.isArray(payloadOps) ? payloadOps : [];
    const threadId = (body as any)?.threadId ?? null;

    if (internal && internal !== 'kommo') {
      return NextResponse.json({ ok: false, error: 'unsupported internal type' }, { status: 400 });
    }
    if (!ops.length) {
      return NextResponse.json({ ok: false, error: 'missing ops' }, { status: 400 });
    }

    // 1) Intentar Hub Brain si está configurado
    const hub = await forwardToHubBrain({ ops, threadId });
    if (hub.ok) return NextResponse.json(hub);

    // 2) Fallback local (opcional)
    const local = await tryLocalKommoSync({ ops, threadId });
    if (local.ok) return NextResponse.json(local);

    // Si ninguno funcionó
    return NextResponse.json(
      { ok: false, error: 'dispatch failed', hubError: hub.reason || hub.data, localError: local.reason },
      { status: 502 },
    );
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || 'unknown error' }, { status: 500 });
  }
}
