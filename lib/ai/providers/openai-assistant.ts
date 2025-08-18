import OpenAI from 'openai';

// ===== ENV =====
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID || process.env.ASSISTANT_ID || '';
if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY missing');
if (!ASSISTANT_ID) throw new Error('OPENAI_ASSISTANT_ID/ASSISTANT_ID missing');

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// ===== Memorias por thread (proceso) =====
type LeadMemo = { leadId?: number };
const THREAD_LEAD: Map<string, LeadMemo> = (global as any).__cvThreadLead || new Map();
(global as any).__cvThreadLead = THREAD_LEAD;

const THREAD_TRANSCRIPT: Map<string, string[]> = (global as any).__cvThreadTx || new Map();
(global as any).__cvThreadTx = THREAD_TRANSCRIPT;

// ===== Utils =====
function ensureNum(v: any): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}
function pushTranscript(threadId: string, who: 'User' | 'Assistant', text: string) {
  if (!text) return;
  const arr = THREAD_TRANSCRIPT.get(threadId) || [];
  arr.push(`${who}: ${text}`.trim());
  THREAD_TRANSCRIPT.set(threadId, arr);
}
function getTranscript(threadId: string) {
  return (THREAD_TRANSCRIPT.get(threadId) || []).join('\n\n');
}

async function callHub(hubBaseUrl: string, hubSecret: string, payload: any) {
  const url = `${hubBaseUrl.replace(/\/$/, '')}/api/kommo?secret=${encodeURIComponent(hubSecret)}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-bridge-secret': hubSecret },
    body: JSON.stringify(payload),
  });
  const json = await resp.json().catch(() => ({}));
  return { ok: resp.ok, status: resp.status, json };
}

// ===== Asegurar lead (auto-create si falta) =====
async function ensureLeadId(
  threadId: string,
  hubBaseUrl: string,
  hubSecret: string,
  hint?: { name?: string; notes?: string; price?: number }
): Promise<number> {
  const memo = THREAD_LEAD.get(threadId);
  if (memo?.leadId) return memo.leadId!;

  const name = (hint?.name && String(hint.name).trim()) || `Lead desde chat ${threadId.slice(-6)}`;
  const notes = (hint?.notes && String(hint.notes).trim()) || 'Creado automáticamente para asociar contacto/notas';
  const price = typeof hint?.price === 'number' ? hint!.price : 0;

  const r = await callHub(hubBaseUrl, hubSecret, {
    action: 'create-lead',
    name,
    price,
    notes,
    source: 'webchat',
  });

  const created = ensureNum(r?.json?.data?.lead_id);
  if (!created) throw new Error(`No fue posible crear lead automáticamente (${r.status})`);
  THREAD_LEAD.set(threadId, { leadId: created });
  return created!;
}

// ===== Tool handlers =====
async function handleKommoTool(
  name: string,
  args: any,
  threadId: string,
  hubBaseUrl: string,
  hubSecret: string
) {
  // Normaliza args
  const norm = (v: any) => (v === undefined || v === null ? undefined : v);

  if (name === 'kommo_create_lead') {
    const payload = {
      action: 'create-lead',
      name: String(args?.name || 'Nuevo lead'),
      price: args?.price ?? 0,
      notes: String(args?.notes || ''),
      source: args?.source || 'webchat',
    };
    const r = await callHub(hubBaseUrl, hubSecret, payload);
    const leadId = ensureNum(r?.json?.data?.lead_id);
    if (leadId) THREAD_LEAD.set(threadId, { leadId });
    return JSON.stringify(r);
  }

  if (name === 'kommo_attach_contact') {
    // 🔒 Garantiza lead_id antes de enlazar contacto
    const lead_id =
      ensureNum(args?.lead_id) ||
      (await ensureLeadId(threadId, hubBaseUrl, hubSecret, {
        name: args?.name,
        notes: `Auto-lead para contacto ${args?.name || ''} ${args?.email || ''} ${args?.phone || ''}`,
      }));

    const payload = {
      action: 'attach-contact',
      lead_id,
      name: norm(args?.name),
      email: norm(args?.email),
      phone: norm(args?.phone),
      notes: norm(args?.notes) || undefined,
    };
    const r = await callHub(hubBaseUrl, hubSecret, payload);
    return JSON.stringify(r);
  }

  if (name === 'kommo_add_note') {
    const lead_id =
      ensureNum(args?.lead_id) ||
      (await ensureLeadId(threadId, hubBaseUrl, hubSecret, { notes: 'Auto-lead para notas' }));

    const payload = {
      action: 'add-note',
      lead_id,
      text: String(args?.text || '').slice(1, 15000), // evita string vacío "232"
    };
    const r = await callHub(hubBaseUrl, hubSecret, payload);
    return JSON.stringify(r);
  }

  if (name === 'kommo_attach_transcript') {
    const lead_id =
      ensureNum(args?.lead_id) ||
      (await ensureLeadId(threadId, hubBaseUrl, hubSecret, { notes: 'Auto-lead para transcript' }));

    const transcript = getTranscript(threadId);
    const payload = { action: 'attach-transcript', lead_id, transcript };
    const r = await callHub(hubBaseUrl, hubSecret, payload);
    return JSON.stringify(r);
  }

  return JSON.stringify({ ok: false, error: `unknown tool: ${name}` });
}

// ===== Core runner =====
type RunOptions = {
  threadId?: string | null;
  hubBaseUrl: string;
  hubSecret: string;
};

export async function runAssistantWithTools(
  userText: string,
  opts: RunOptions
): Promise<{
  reply: string;
  threadId: string;
  toolEvents?: Array<{ name: string; status: number; ok: boolean }>;
}> {
  // 1) Thread
  let threadId = opts.threadId || null;
  if (!threadId) {
    const t = await openai.beta.threads.create({});
    threadId = t.id;
  }

  // 2) Mensaje usuario
  await openai.beta.threads.messages.create(threadId, {
    role: 'user',
    content: userText,
  });
  pushTranscript(threadId, 'User', userText);

  // 3) Run + resolver tools (firma SDK de tu proyecto)
  let toolEvents: Array<{ name: string; status: number; ok: boolean }> = [];
  let run = await openai.beta.threads.runs.create(threadId, { assistant_id: ASSISTANT_ID });

  while (true) {
    run = await openai.beta.threads.runs.retrieve(run.id, { thread_id: threadId });

    if (run.status === 'completed') break;

    if (run.status === 'requires_action') {
      const toolCalls = run.required_action?.submit_tool_outputs?.tool_calls || [];

      const outputs: { tool_call_id: string; output: string }[] = [];
      for (const call of toolCalls) {
        const name = call.function?.name as string;
        const args = JSON.parse(call.function?.arguments || '{}');

        // Si assistant no mandó lead_id, lo resolvemos nosotros adentro de cada tool
        const out = await handleKommoTool(name, args, threadId!, opts.hubBaseUrl, opts.hubSecret).catch(
          (e) => JSON.stringify({ ok: false, error: String(e?.message || e) })
        );
        outputs.push({ tool_call_id: call.id, output: out });

        // Log/evento
        try {
          const parsed = JSON.parse(out);
          toolEvents.push({ name, status: Number(parsed?.status || 200), ok: !!parsed?.ok });
          const lid =
            ensureNum(parsed?.json?.data?.lead_id) ||
            ensureNum(parsed?.data?.lead_id);
          if (lid) THREAD_LEAD.set(threadId!, { leadId: lid });
        } catch {
          toolEvents.push({ name, status: 200, ok: true });
        }
      }

      await openai.beta.threads.runs.submitToolOutputs(run.id, {
        thread_id: threadId!,
        tool_outputs: outputs,
      });
    }

    if (['failed', 'cancelled', 'expired'].includes(run.status)) {
      throw new Error(`Run ${run.status}`);
    }

    await new Promise((r) => setTimeout(r, 500));
  }

  // 4) Último mensaje del assistant
  const list = await openai.beta.threads.messages.list(threadId!, { order: 'desc', limit: 5 });
  const first = list.data.find((m) => m.role === 'assistant');
  const reply =
    first?.content?.map((c: any) => ('text' in c ? c.text?.value : '')).join('\n').trim() || '';

  if (reply) pushTranscript(threadId!, 'Assistant', reply);

  // 5) Adjuntar transcripción si ya hay lead
  const memo = THREAD_LEAD.get(threadId!);
  if (memo?.leadId) {
    try {
      const transcript = getTranscript(threadId!);
      if (transcript && transcript.length > 80) {
        await callHub(opts.hubBaseUrl, opts.hubSecret, {
          action: 'attach-transcript',
          lead_id: memo.leadId,
          transcript,
        });
      }
    } catch {
      // silencioso
    }
  }

  return { reply, threadId: threadId!, toolEvents };
}
