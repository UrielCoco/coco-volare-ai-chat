import { NextResponse } from 'next/server'

// ---------- Tipos ----------
type KommoOp =
  | { action: 'create-lead'; payload: { name?: string; price?: number; notes?: string; source?: string } }
  | { action: 'update-lead'; payload: { lead_id: number; name?: string; price?: number } }
  | { action: 'attach-contact'; payload: { lead_id: number; name?: string; email?: string; phone?: string; notes?: string } }
  | { action: 'add-note'; payload: { lead_id: number; text: string } }
  | { action: 'attach-transcript'; payload: { lead_id: number; transcript: string } }
  | { action: string; payload: Record<string, any> }

type KommoDispatchBody = {
  ops?: KommoOp[]
  threadId?: string | null
  // Compat single-op (curl, tests)
  action?: string
  payload?: Record<string, any>
}

// ---------- Utils ----------
function slog(event: string, meta: any = {}) {
  try { console.log('[CV][kommo-proxy]', event, meta) } catch {}
}

function pickHubUrl(): string | null {
  const full = process.env.HUB_BRAIN_KOMMO_URL || process.env.BRAIN_HUB_KOMMO_URL
  if (full) return full
  const base = process.env.HUB_BRAIN_URL || process.env.BRAIN_HUB_URL || process.env.NEXT_PUBLIC_HUB_BASE_URL
  if (!base) return null
  return `${base.replace(/\/+$/,'')}/api/kommo`
}

function buildHeaders(threadId?: string | null) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const bearer = process.env.HUB_BRAIN_SECRET || process.env.HUB_BRAIN_API_KEY || process.env.HUB_BRAIN_TOKEN || process.env.BRAIN_HUB_TOKEN
  const xBridge = process.env.HUB_BRIDGE_SECRET || process.env.BRIDGE_HUB_SECRET || process.env.WEBHOOK_SECRET
  const xApiKey = process.env.HUB_BRAIN_API_KEY || process.env.BRAIN_HUB_API_KEY
  if (bearer) headers['Authorization'] = `Bearer ${bearer}`
  if (xBridge) headers['x-bridge-secret'] = xBridge
  if (xApiKey) headers['x-api-key'] = xApiKey
  if (threadId) headers['X-Thread-Id'] = String(threadId)
  return headers
}

async function postToHub(url: string, headers: Record<string,string>, body: any) {
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
  const text = await res.text()
  let json: any = null
  try { json = JSON.parse(text) } catch {}
  return { status: res.status, ok: res.ok, text, json }
}

// ---- Normalizaciones clave ----

// kebabifica: snake_case, camelCase o con espacios -> kebab-case
function kebabifyAction(a: string): string {
  if (!a) return a
  let s = a.trim()
  // camelCase -> camel-Case
  s = s.replace(/([a-z0-9])([A-Z])/g, '$1-$2')
  // underscores/espacios -> -
  s = s.replace(/[_\s]+/g, '-')
  s = s.toLowerCase()
  // algunos alias comunes
  const map: Record<string,string> = {
    'createlead': 'create-lead',
    'updatelead': 'update-lead',
    'attachcontact': 'attach-contact',
    'addnote': 'add-note',
    'attachtranscript': 'attach-transcript',
  }
  const compact = s.replace(/-/g,'')
  return map[compact] ?? s
}

// Aplana op.payload -> raíz; convierte action -> kebab-case
function normalizeOp(op: KommoOp): { action: string; body: any } | null {
  if (!op || typeof op !== 'object') return null
  const rawAction = (op as any).action
  const action = typeof rawAction === 'string' ? kebabifyAction(rawAction) : null
  const payload = (op as any).payload || {}
  if (!action) return null
  return { action, body: { action, ...payload } }
}

// Extrae lead_id de respuestas del Hub en diferentes formas
function extractLeadId(resp: any): number | null {
  if (!resp) return null
  const d = resp.data ?? resp
  const cand = d?.lead_id ?? d?.id ?? d?.data?.lead_id ?? d?.data?.id
  const n = Number(cand)
  return Number.isFinite(n) && n > 0 ? n : null
}

// Reemplaza "$LAST" por el último lead_id conocido dentro de un objeto body (solo top-level)
function resolveLast(body: any, lastLeadId: number | null) {
  if (!body || lastLeadId == null) return body
  const out: any = { ...body }
  for (const k of Object.keys(out)) {
    if (typeof out[k] === 'string' && out[k] === '$LAST') out[k] = lastLeadId
  }
  return out
}

// ---------- Handler ----------
export async function POST(req: Request) {
  const hubUrl = pickHubUrl()
  if (!hubUrl) {
    slog('reject.noHubUrl', {})
    return NextResponse.json({ ok: false, error: 'missing HUB_BRAIN_KOMMO_URL / HUB_BRAIN_URL' }, { status: 500 })
  }

  const t0 = Date.now()
  try {
    const body: KommoDispatchBody = await req.json().catch(() => ({} as any))
    const threadId = body.threadId ?? null
    const headers = buildHeaders(threadId)

    // Compat: single-op (action + payload)
    if (!body.ops?.length && body.action) {
      const op = normalizeOp({ action: body.action, payload: body.payload || {} } as any)
      if (!op) {
        slog('reject.badSingleOp', { bodyPreview: JSON.stringify(body).slice(0, 300) })
        return NextResponse.json({ ok: false, error: 'bad single op' }, { status: 400 })
      }
      const send = resolveLast(op.body, null)
      slog('forward.begin', { url: hubUrl, action: op.action, normalized: op.action, threadId })
      const r = await postToHub(hubUrl, headers, send)
      slog('forward.end', { status: r.status, ok: r.ok, bodyPreview: (r.text || '').slice(0, 300) })
      return NextResponse.json({ ok: r.ok, status: r.status, data: r.json ?? r.text }, { status: r.ok ? 200 : 502 })
    }

    const ops = Array.isArray(body.ops) ? body.ops : []
    if (!ops.length) {
      slog('reject.emptyOps', {})
      return NextResponse.json({ ok: false, error: 'empty ops' }, { status: 400 })
    }

    let lastLeadId: number | null = null
    const results: Array<{ action: string; status: number; ok: boolean; data: any }> = []

    for (let i = 0; i < ops.length; i++) {
      const norm = normalizeOp(ops[i] as any)
      if (!norm) {
        results.push({ action: String((ops[i] as any)?.action || '?'), status: 400, ok: false, data: { error: 'invalid op' } })
        continue
      }

      const send = resolveLast(norm.body, lastLeadId)

      slog('forward.begin', { url: hubUrl, idx: i, action: (ops[i] as any)?.action, normalized: norm.action, threadId })
      const r = await postToHub(hubUrl, headers, send)
      slog('forward.end', { idx: i, status: r.status, ok: r.ok, bodyPreview: (r.text || '').slice(0, 300) })

      results.push({ action: norm.action, status: r.status, ok: r.ok, data: r.json ?? r.text })

      if (norm.action === 'create-lead') {
        const createdId = extractLeadId(r.json)
        if (createdId) lastLeadId = createdId
      }

      if (r.status === 401 || r.status === 403) break
    }

    const allOk = results.every(r => r.ok)
    return NextResponse.json({ ok: allOk, status: allOk ? 200 : 502, data: { results } }, { status: allOk ? 200 : 502 })
  } catch (err: any) {
    slog('forward.error', { err: String(err) })
    return NextResponse.json({ ok: false, error: String(err) }, { status: 502 })
  } finally {
    slog('time', { ms: Date.now() - t0 })
  }
}
