// lib/kommo-sync.ts — Cliente minimal para enviar eventos al Hub → Kommo
const HUB_BASE = process.env.NEXT_PUBLIC_HUB_BASE_URL || '';
const HUB_SECRET = process.env.HUB_BRAIN_SECRET || process.env.HUB_BRIDGE_SECRET || '';

if (!HUB_BASE) console.warn('⚠️ NEXT_PUBLIC_HUB_BASE_URL no está definido');
if (!HUB_SECRET) console.warn('⚠️ HUB_BRAIN_SECRET/HUB_BRIDGE_SECRET no está definido');

export type KommoRes = { ok: boolean; data?: any; error?: string; detail?: any };

async function callKommo(action: string, payload: Record<string, any>): Promise<KommoRes> {
  const url = `${HUB_BASE.replace(/\/$/, '')}/api/kommo`;
  const body = { action, ...payload };
  const traceId = `cvk_${Math.random().toString(36).slice(2)}`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-bridge-secret': HUB_SECRET,
        'x-webhook-secret': HUB_SECRET,
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
    const text = await res.text();
    let json: any = {};
    try { json = JSON.parse(text); } catch { json = { raw: text }; }
    console.log(JSON.stringify({ level: 'info', traceId, msg: 'CV:kommo call', meta: { action, status: res.status, jsonPreview: JSON.stringify(json).slice(0, 200) } }));
    return json as KommoRes;
  } catch (e: any) {
    console.error(JSON.stringify({ level: 'error', msg: 'CV:kommo fetch error', meta: { action, error: String(e?.message || e) } }));
    return { ok: false, error: String(e?.message || e) };
  }
}

export async function kommoCreateLead(name: string, opts?: { price?: number; notes?: string; source?: string }) {
  return callKommo('create-lead', { payload: { name, ...opts } });
}
export async function kommoUpdateLead(leadId: number, patch: Record<string, any>) {
  return callKommo('update-lead', { payload: { lead_id: leadId, ...patch } });
}
export async function kommoAttachContact(leadId: number, data: { name: string; email?: string; phone?: string; country?: string; city?: string; preferredContact?: string; notes?: string }) {
  return callKommo('attach-contact', { payload: { lead_id: leadId, ...data } });
}
export async function kommoAddNote(leadId: number, text: string) {
  return callKommo('add-note', { payload: { lead_id: leadId, text } });
}
export async function kommoAttachTranscript(leadId: number, transcript: string, opts?: { translateTo?: string }) {
  const payload: any = { lead_id: leadId, transcript };
  if (opts?.translateTo) payload.translateTo = opts.translateTo;
  return callKommo('attach-transcript', { payload });
}
