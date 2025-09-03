import { NextResponse } from 'next/server';
import { dlog, timeit, short } from '@/lib/diag-log';


type KommoPayload = {
  ops?: any[];
  threadId?: string | null;
};

function slog(event: string, meta: any = {}) {
  try { console.log('[CV][kommo-proxy]', event, meta); } catch {}
}

function getHubUrl() {
  // Opción 1: URL completa al endpoint
  const full = process.env.HUB_BRAIN_KOMMO_URL || process.env.BRAIN_HUB_KOMMO_URL;
  if (full) return full;
  // Opción 2: base + path por defecto
  const base = process.env.HUB_BRAIN_URL || process.env.BRAIN_HUB_URL;
  if (!base) return null;
  return `${base.replace(/\/+$/,'')}/api/kommo/dispatch`;
}

export async function POST(req: Request) {
  let body: KommoPayload | null = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Bad JSON' }, { status: 400 });
  }

  const ops = Array.isArray(body?.ops) ? body!.ops : [];
  const threadId = body?.threadId ?? null;

  if (!ops.length) {
    slog('reject.noOps', { threadId });
    return NextResponse.json({ ok: false, error: 'ops[] required' }, { status: 400 });
  }

  const url = getHubUrl();
  if (!url) {
    slog('reject.noHubUrl', {});
    return NextResponse.json(
      { ok: false, error: 'Hub Brain URL not configured' },
      { status: 501 }
    );
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Client-App': 'coco-volare-ai-chat',
  };
  const apiKey =
    process.env.HUB_BRAIN_API_KEY ||
    process.env.BRAIN_HUB_API_KEY ||
    process.env.HUB_BRAIN_TOKEN ||
    process.env.BRAIN_HUB_TOKEN;
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
  if (threadId) headers['X-Thread-Id'] = String(threadId);

  try {
    slog('forward.begin', { url, ops: ops.length, threadId });
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ops, threadId }),
    });

    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch {}
    slog('forward.end', { status: res.status, ok: res.ok, bodyPreview: text.slice(0, 300) });

    return NextResponse.json(
      { ok: res.ok, status: res.status, data: json ?? text },
      { status: res.ok ? 200 : 502 }
    );
  } catch (err: any) {
    slog('forward.error', { err: String(err) });
    return NextResponse.json({ ok: false, error: String(err) }, { status: 502 });
  }
}
