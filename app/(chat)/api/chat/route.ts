/* eslint-disable @typescript-eslint/no-explicit-any */
import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

// ---------- Utils ----------
const logI = (...args: any[]) => console.info('[CV][server]', ...args);
const logE = (...args: any[]) => console.error('[CV][server]', ...args);

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
    try {
      data = await res.json();
    } catch {
      // puede no devolver JSON
    }

    logI('[kommo] upsert ok', { status: res.status, data });
  } catch (err) {
    logE('[kommo] upsert error', err);
  }
}

// ---------- Heurística simple de lead ----------
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

// ---------- Parseo de bloques cv:itinerary / cv:quote ----------
function parsePartsFromText(text: string): any[] {
  const parts: any[] = [];
  if (!text) return parts;

  const fenceRegex = /```(cv:(itinerary|quote))\s*([\s\S]*?)```/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;

  while ((m = fenceRegex.exec(text))) {
    const [full, , subType, body] = m;
    const start = m.index;

    const before = text.slice(lastIndex, start).trim();
    if (before) parts.push({ type: 'text', text: before });

    if (subType === 'itinerary') {
      try {
        const json = JSON.parse(body.trim());
        parts.push({ type: 'itinerary', itinerary: json });
      } catch {
        parts.push({ type: 'text', text: body.trim() });
      }
    } else if (subType === 'quote') {
      try {
        const json = JSON.parse(body.trim());
        parts.push({ type: 'quote', quote: json });
      } catch {
        parts.push({ type: 'text', text: body.trim() });
      }
    }

    lastIndex = m.index + full.length;
  }

  const tail = text.slice(lastIndex).trim();
  if (tail) parts.push({ type: 'text', text: tail });

  if (parts.length === 0) parts.push({ type: 'text', text });

  return parts;
}

// ---------- Helpers OpenAI ----------
async function ensureThread(threadId?: string) {
  if (threadId) return threadId;
  const th = await openai.beta.threads.create({});
  return th.id;
}

async function appendUserMessage(threadId: string, text: string) {
  await openai.beta.threads.messages.create(threadId, {
    role: 'user',
    content: text,
  });
}

async function runAssistant(threadId: string) {
  const assistantId = process.env.OPENAI_ASSISTANT_ID!;
  const run = await openai.beta.threads.runs.create(threadId, {
    assistant_id: assistantId,
  });
  return run.id;
}

/**
 * Compatibilidad con ambas firmas de SDK:
 * - Antiguo: runs.retrieve(threadId, runId)
 * - Nuevo:   runs.retrieve({ thread_id, run_id })
 */
async function retrieveRunSafe(threadId: string, runId: string): Promise<any> {
  const fn: any = (openai as any).beta.threads.runs.retrieve;

  // Si la función declara 2 parámetros, asumimos firma antigua
  if (typeof fn === 'function' && fn.length >= 2) {
    return await fn(threadId, runId);
  }

  // Si no, probamos la firma nueva
  try {
    return await fn({ thread_id: threadId, run_id: runId });
  } catch {
    // Fallback por si los tipos no coinciden pero en runtime sí
    return await (openai as any).beta.threads.runs.retrieve(threadId, runId);
  }
}

async function pollRun(threadId: string, runId: string, timeoutMs = 60_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const run = await retrieveRunSafe(threadId, runId);

    if (run.status === 'completed') {
      logI('[CV][server] run completed', { threadId, runId });
      return run;
    }
    if (['failed', 'cancelled', 'expired'].includes(run.status)) {
      logI('[CV][server] run final', { status: run.status });
      return run;
    }

    logI('[CV][server] polling', { status: run.status });
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('Run polling timeout');
}

async function getLastAssistantMessage(threadId: string): Promise<string> {
  const list = await openai.beta.threads.messages.list(threadId, { limit: 20 });
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

// ---------- Handler principal ----------
export async function POST(req: NextRequest) {
  try {
    const { text, threadId: threadIn, meta } = await req.json();
    const textPreview = (text || '').slice(0, 140);
    logI('incoming', { threadId: threadIn, textPreview });

    const threadId = await ensureThread(threadIn);

    await appendUserMessage(threadId, text);
    logI('appended message to thread', threadId);

    const hints = extractLeadHints(text || '');
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
      transcriptAppend: text || '',
    }).catch(() => {});

    const runId = await runAssistant(threadId);
    logI('run created', { runId });

    await pollRun(threadId, runId);

    const assistantText = await getLastAssistantMessage(threadId);
    logI('reply ready', {
      ms: Date.now(),
      replyPreview: assistantText.slice(0, 140),
      threadId,
    });

    const parts = parsePartsFromText(assistantText);

    // Si hubo itinerario, agregamos call-to-action en el mismo idioma
    const hasItinerary = parts.some((p) => p.type === 'itinerary');
    if (hasItinerary) {
      try {
        const it = parts.find((p) => p.type === 'itinerary')?.itinerary;
        const lang = String(it?.lang || '').toLowerCase().startsWith('es') ? 'es' : 'en';
        const msg =
          lang === 'es'
            ? '¿Continuamos con la cotización o prefieres que te contacte un asesor?'
            : 'Shall we proceed with the quote, or would you like an advisor to contact you?';
        parts.push({ type: 'text', text: msg });
      } catch {}
    }

    return NextResponse.json({ ok: true, threadId, parts }, { status: 200 });
  } catch (err: any) {
    logE('error', err?.message || err);
    return NextResponse.json({ ok: false, error: String(err?.message || err) }, { status: 500 });
  }
}

// -------- Healthcheck --------
export async function GET() {
  return NextResponse.json({
    ok: true,
    service: 'coco-volare-ai-chat',
    kommo: HAS_KOMMO,
  });
}
