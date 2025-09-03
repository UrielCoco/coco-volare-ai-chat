// /lib/kommo-sync.ts — Reusa tu cliente y añade diagnóstico sin cambiar contrato
import { dlog, timeit, short } from '@/lib/diag-log';

const HUB_BASE = process.env.NEXT_PUBLIC_HUB_BASE_URL || '';
const HUB_SECRET = process.env.HUB_BRAIN_SECRET || process.env.HUB_BRIDGE_SECRET || ''; // solo informativo

if (!HUB_BASE) console.warn('⚠️ NEXT_PUBLIC_HUB_BASE_URL no está definido');
if (!HUB_SECRET) console.warn('⚠️ HUB_BRAIN_SECRET/HUB_BRIDGE_SECRET no está definido');

export type KommoRes = { ok: boolean; data?: any; error?: string; detail?: any };

async function callKommo(action: string, payload: Record<string, any>): Promise<KommoRes> {
  const url = `${HUB_BASE.replace(/\/$/, '')}/api/kommo`;
  const body = { action, ...payload };
  const traceId = `cvk_${Math.random().toString(36).slice(2)}`;

  return timeit('kommo.call', async () => {
    try {
      dlog('[CV][diag] kommo.req', { url, action, traceId, bodyPreview: short(JSON.stringify(body)) });

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

      const text = await res.text();
      let json: any = undefined;
      try {
        json = JSON.parse(text);
      } catch {
        // está bien, a veces regresa texto plano
      }

      dlog('[CV][diag] kommo.res', {
        url,
        action,
        traceId,
        status: res.status,
        ok: res.ok,
        textPreview: short(text),
      });

      if (json) return json as KommoRes;
      return { ok: res.ok, detail: text };
    } catch (e: any) {
      dlog('[CV][diag] kommo.err', { action, traceId, err: String(e?.message || e) }, 'error');
      return { ok: false, error: String(e?.message || e) };
    }
  });
}

export async function kommoCreateLead(
  name: string,
  opts?: { price?: number; notes?: string; source?: string }
) {
  return callKommo('create-lead', { payload: { name, ...opts } });
}

export async function kommoUpdateLead(leadId: number, patch: Record<string, any>) {
  return callKommo('update-lead', { payload: { lead_id: leadId, ...patch } });
}

export async function kommoAttachContact(
  leadId: number,
  data: {
    name: string;
    email?: string;
    phone?: string;
    country?: string;
    city?: string;
    preferredContact?: string;
    notes?: string;
  }
) {
  return callKommo('attach-contact', { payload: { lead_id: leadId, ...data } });
}

export async function kommoAddNote(leadId: number, text: string) {
  return callKommo('add-note', { payload: { lead_id: leadId, text } });
}

export async function kommoAttachTranscript(
  leadId: number,
  transcript: string,
  opts?: { translateTo?: string }
) {
  const payload: any = { lead_id: leadId, transcript };
  if (opts?.translateTo) payload.translateTo = opts.translateTo;
  return callKommo('attach-transcript', { payload });
}
