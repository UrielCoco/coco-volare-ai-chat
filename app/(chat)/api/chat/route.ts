/* eslint-disable @typescript-eslint/no-explicit-any */
import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

// ---------- Logs ----------
const logI = (...a: any[]) => console.info('[CV][server]', ...a);
const logE = (...a: any[]) => console.error('[CV][server]', ...a);

// ---------- Kommo ----------
const HAS_KOMMO = Boolean(process.env.KOMMO_BASE_URL && process.env.KOMMO_API_KEY);
async function upsertKommo(payload: any) {
  if (!HAS_KOMMO) {
    logI('[kommo] saltado: faltan envs');
    return;
  }
  try {
    const res = await fetch(`${process.env.KOMMO_BASE_URL}/upsert`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.KOMMO_API_KEY}`,
      },
      body: JSON.stringify(payload),
    });
    let data: any = null;
    try { data = await res.json(); } catch {}
    logI('[kommo] upsert ok', { status: res.status, data });
  } catch (err) {
    logE('[kommo] upsert error', err);
  }
}

// ---------- Lead hints ----------
function extractLeadHints(text: string) {
  const t = (text || '').trim();
  const paxMatch =
    /(for|para)\s+(\d{1,2})\s*(people|personas)/i.exec(t) ||
    /(\d{1,2})\s*(people|personas)/i.exec(t);
  const pax = paxMatch ? Number(paxMatch[2] || paxMatch[1]) : undefined;
  const dateIso = /(\d{4}-\d{2}-\d{2})/.exec(t)?.[1];
  const dateLatam = /(\d{1,2}\/\d{1,2}\/\d{4})/.exec(t)?.[1];
  const destMatch =
    /(to|a)\s+([A-Za-zÀ-ÿ\s,]+?)(?:\s+for|\s+on|\s+the|$|,|\.)/i.exec(t);
  const destino = destMatch ? destMatch[2].trim() : undefined;
  const email = /[\w.+-]+@[\w-]+\.[\w.-]+/i.exec(t)?.[0];
  const whatsapp = /\+?\d{8,15}/.exec(t)?.[0];
  return { destino, fechas: dateIso || dateLatam, pax, email, whatsapp };
}

// ---------- Parser de bloques cv:itinerary / cv:quote ----------
function parsePartsFromText(text: string): any[] {
  const parts: any[] = [];
  if (!text) return parts;

  const fence = /```(cv:(itinerary|quote))\s*([\s\S]*?)```/g;
  let last = 0; let m: RegExpExecArray | null;
  while ((m = fence.exec(text))) {
    const [full, , subtype, body] = m;
    const start = m.index;

    const before = text.slice(last, start).trim();
    if (before) parts.push({ type: 'text', text: before });

    if (subtype === 'itinerary') {
      try { parts.push({ type: 'itinerary', itinerary: JSON.parse(body.trim()) }); }
      catch { parts.push({ type: 'text', text: body.trim() }); }
    } else if (subtype === 'quote') {
      try { parts.push({ type: 'quote', quote: JSON.parse(body.trim()) }); }
      catch { parts.push({ type: 'text', text: body.trim() }); }
    }
    last = m.index + full.length;
  }
  const tail = text.slice(last).trim();
  if (tail) parts.push({ type: 'text', text: tail });
  if (parts.length === 0) parts.push({ type: 'text', text });
  return parts;
}

// ---------- OpenAI helpers ----------
async function ensureThread(threadId?: string) {
  if (threadId) return threadId;
  const th = await openai.beta.threads.create({});
  return th.id;
}

async function appendUserMessage(threadId: string, text: string) {
  await openai.beta.threads.messages.create(threadId, { role: 'user', content: text });
}

async function runAssistant(threadId: string) {
  const run = await openai.beta.threads.runs.create(threadId, {
    assistant_id: process.env.OPENAI_ASSISTANT_ID!,
  });
  return run.id;
}

/**
 * Compat sin perder `this/_client`:
 * - Si la aridad (length) es 2 → firma vieja, pero algunos SDKs la esperan invertida.
 *   Usamos prefijos de los IDs y probamos el orden correcto (y si falla, intentamos el otro).
 * - Si la aridad es 1 → firma nueva con objeto.
 */
async function retrieveRunSafe(threadId: string, runId: string): Promise<any> {
  const runsApi = (openai as any).beta.threads.runs;
  const arity = typeof runsApi.retrieve === 'function' ? runsApi.retrieve.length : 1;

  // Prefijos típicos
  const isThread = (s: string) => typeof s === 'string' && s.startsWith('thread_');
  const isRun = (s: string) => typeof s === 'string' && s.startsWith('run_');

  if (arity >= 2) {
    // Firma vieja con 2 args, intentamos el orden más lógico según prefijos
    try {
      if (isThread(threadId) && isRun(runId)) {
        return await runsApi.retrieve(threadId, runId); // (thread, run)
      }
      if (isRun(threadId) && isThread(runId)) {
        return await runsApi.retrieve(runId, threadId); // (thread, run) pero args invertidos al pasar
      }
      // Si no están claros los prefijos, probamos ambos
      try {
        return await runsApi.retrieve(threadId, runId);
      } catch {
        return await runsApi.retrieve(runId, threadId);
      }
    } catch (e) {
      // Como último recurso, probamos con objeto
      return await runsApi.retrieve({ thread_id: threadId, run_id: runId });
    }
  }

  // Firma nueva 1 arg (objeto)
  return await runsApi.retrieve({ thread_id: threadId, run_id: runId });
}

/** list messages: firma vieja y nueva, sin desacoplar */
async function listMessagesSafe(threadId: string, limit = 20): Promise<any> {
  const msgApi = (openai as any).beta.threads.messages;
  const arity = typeof msgApi.list === 'function' ? msgApi.list.length : 1;
  if (arity >= 2) {
    return await msgApi.list(threadId, { limit });
  }
  return await msgApi.list({ thread_id: threadId, limit });
}

async function pollRun(threadId: string, runId: string, timeoutMs = 60_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const run = await retrieveRunSafe(threadId, runId);
    if (run.status === 'completed') {
      logI('run completed', { threadId, runId });
      return run;
    }
    if (['failed', 'cancelled', 'expired'].includes(run.status)) {
      logI('run final', { status: run.status });
      return run;
    }
    logI('polling', { status: run.status });
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('Run polling timeout');
}

async function getLastAssistantMessage(threadId: string): Promise<string> {
  const list = await listMessagesSafe(threadId, 20);
  for (const m of list.data) {
    if (m.role === 'assistant') {
      let buf = '';
      for (const c of (m.content as any[]) || []) {
        if (c.type === 'text') buf += c.text.value + '\n';
      }
      return buf.trim();
    }
  }
  return '';
}

// ---------- Handler ----------
export async function POST(req: NextRequest) {
  try {
    const { text, threadId: threadIn, meta } = await req.json();
    const userText = (text ?? '').trim();
    logI('incoming', { threadId: threadIn, textPreview: userText.slice(0, 140) });

    const threadId = await ensureThread(threadIn);

    // Evitar 400 "Missing content" si es bootstrap/ping
    if (userText.length > 0) {
      await appendUserMessage(threadId, userText);
      logI('appended message to thread', threadId);

      // Kommo sólo con texto real
      const hints = extractLeadHints(userText);
      upsertKommo({
        lead: {
          title: `Coco Volare · ${hints.destino || 'Viaje'}`,
          notes: { ...hints, fuente: 'webchat', threadId },
        },
        contact: {
          name: meta?.name || 'Web Chat',
          whatsapp: hints.whatsapp || meta?.whatsapp || '',
          email: hints.email || meta?.email || '',
          instagram: meta?.instagram || '',
        },
        transcriptAppend: userText,
      }).catch(() => {});
    } else {
      logI('skip append: empty text (bootstrap/ping)');
    }

    const runId = await runAssistant(threadId);
    logI('run created', { runId });

    await pollRun(threadId, runId);

    const assistantText = await getLastAssistantMessage(threadId);
    logI('reply ready', { replyPreview: assistantText.slice(0, 140), threadId });

    const parts = parsePartsFromText(assistantText);

    // CTA al final si hubo itinerario
    if (parts.some((p) => p.type === 'itinerary')) {
      try {
        const it = parts.find((p) => p.type === 'itinerary')?.itinerary;
        const lang = String(it?.lang || '').toLowerCase().startsWith('es') ? 'es' : 'en';
        parts.push({
          type: 'text',
          text:
            lang === 'es'
              ? '¿Continuamos con la cotización o prefieres que te contacte un asesor?'
              : 'Shall we proceed with the quote, or would you like an advisor to contact you?',
        });
      } catch {}
    }

    return NextResponse.json({ ok: true, threadId, parts }, { status: 200 });
  } catch (err: any) {
    logE('error', err?.message || err);
    return NextResponse.json({ ok: false, error: String(err?.message || err) }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: 'coco-volare-ai-chat',
    kommo: HAS_KOMMO,
  });
}
