// app/(chat)/api/kommo/dispatch/route.ts
import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { kommoCreateLead, kommoAttachContact, kommoAddNote, kommoAttachTranscript, kommoUpdateLead } from '@/lib/kommo-sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

function jlog(event: string, meta: any = {}) {
  try { console.log(JSON.stringify({ tag: '[CV][kommo]', event, ...meta })); } catch {}
}

function pickLeadId(data: any): number | null {
  if (!data) return null;
  if (typeof data === 'number') return data;
  return (
    data.lead_id ||
    data.leadId ||
    data.id ||
    data.lead?.id ||
    data.data?.lead_id ||
    data.data?.id ||
    null
  );
}

async function buildTranscript(threadId: string): Promise<string> {
  const parts: string[] = [];
  try {
    const res = await client.beta.threads.messages.list(threadId, { order: 'asc', limit: 100 });
    for (const m of res.data) {
      const role = m.role;
      for (const c of m.content) {
        if (c.type === 'text' && c.text?.value) {
          parts.push(`${role.toUpperCase()}: ${c.text.value}`);
        }
      }
    }
  } catch (e: any) {
    parts.push(`[WARN] Could not fetch thread transcript: ${String(e?.message||e)}`);
  }
  return parts.join('\n');
}

export async function POST(req: NextRequest) {
  try {
    const { ops, threadId } = await req.json();
    if (!Array.isArray(ops) || ops.length === 0) {
      return NextResponse.json({ ok: false, error: 'ops must be a non-empty array' }, { status: 400 });
    }

    let leadId: number | null = null;
    const results: any[] = [];

    for (const op of ops) {
      const action = String(op?.action || '').toLowerCase();
      if (!action) continue;

      if (action === 'create_lead' || action === 'create-lead') {
        const name = op?.name || 'Lead Coco Volare';
        const res = await kommoCreateLead(name, { price: op?.price, notes: op?.notes, source: op?.source || 'webchat:cocovolare' });
        const id = pickLeadId(res?.data);
        if (id) leadId = id;
        results.push({ action, ok: !!res?.ok, data: res?.data, leadId });
      } else if (action === 'update_lead' || action === 'update-lead') {
        const id = Number(op?.lead_id || op?.leadId || leadId);
        if (!id) { results.push({ action, ok: false, error: 'lead_id missing' }); continue; }
        const res = await kommoUpdateLead(id, op?.patch || {});
        results.push({ action, ok: !!res?.ok, data: res?.data, leadId: id });
      } else if (action === 'attach_contact' || action === 'attach-contact') {
        const id = Number(op?.lead_id || op?.leadId || leadId);
        if (!id) { results.push({ action, ok: false, error: 'lead_id missing' }); continue; }
        const payload: any = {
          name: op?.name,
          email: op?.email,
          phone: op?.phone,
          country: op?.country,
          city: op?.city,
          preferredContact: op?.preferredContact,
          notes: op?.notes,
        };
        const res = await kommoAttachContact(id, payload);
        results.push({ action, ok: !!res?.ok, data: res?.data, leadId: id });
      } else if (action === 'add_note' || action === 'add-note') {
        const id = Number(op?.lead_id || op?.leadId || leadId);
        if (!id) { results.push({ action, ok: false, error: 'lead_id missing' }); continue; }
        const text = String(op?.text || '').slice(0, 5000);
        const res = await kommoAddNote(id, text);
        results.push({ action, ok: !!res?.ok, data: res?.data, leadId: id });
      } else if (action === 'attach_transcript' || action === 'attach-transcript') {
        const id = Number(op?.lead_id || op?.leadId || leadId);
        if (!id) { results.push({ action, ok: false, error: 'lead_id missing' }); continue; }
        const transcript = await buildTranscript(String(threadId));
        const res = await kommoAttachTranscript(id, transcript, { translateTo: op?.translateTo });
        results.push({ action, ok: !!res?.ok, data: res?.data, leadId: id });
      } else {
        results.push({ action, ok: false, error: 'unknown action' });
      }
    }

    return NextResponse.json({ ok: true, leadId, results });
  } catch (e: any) {
    jlog('error', { error: String(e?.message || e) });
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
