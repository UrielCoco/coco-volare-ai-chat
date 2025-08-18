import OpenAI from 'openai';

// ================= ENV =================
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID || process.env.ASSISTANT_ID || '';
if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY missing');
if (!ASSISTANT_ID) throw new Error('OPENAI_ASSISTANT_ID/ASSISTANT_ID missing');

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// ============== MEMO POR THREAD (proceso) ==============
type LeadMemo = { leadId?: number };
const THREAD_LEAD: Map<string, LeadMemo> = (global as any).__cvThreadLead || new Map();
(global as any).__cvThreadLead = THREAD_LEAD;

const THREAD_TRANSCRIPT: Map<string, string[]> = (global as any).__cvThreadTx || new Map();
(global as any).__cvThreadTx = THREAD_TRANSCRIPT;

// ================= Utils =================
function ensureNum(v: any): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}
function pushTranscript(threadId: string, who: 'User' | 'Assistant', text: string) {
  const t = String(text || '').trim();
  if (!t) return;
  const arr = THREAD_TRANSCRIPT.get(threadId) || [];
  arr.push(`${who}: ${t}`);
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

// ====== Asegurar lead si falta (auto-create) ======
async function ensureLeadId(
  threadId: string,
  hubBaseUrl: string,
  hubSecret: string,
  hint?: { name?: string; notes?: string; price?: number }
): Promise<number> {
  const memo = THREAD_LEAD.get(threadId);
  if (memo?.leadId) return memo.leadId!;
  const name = (hint?.name && String(hint.name).trim()) || `Lead chat ${threadId.slice(-6)}`;
  const notes =
    (hint?.notes && String(hint.notes).trim()) ||
    'Creado automáticamente para asociar contacto/notas/transcripción';
  const price = typeof hint?.price === 'number' ? hint!.price : 0;

  const r = await callHub(hubBaseUrl, hubSecret, {
    action: 'create-lead',
    name,
    price,
    notes,
    source: 'webchat',
  });
  const created = ensureNum(r?.json?.data?.lead_id);
  if (!created) throw new Error(`Auto-create lead failed (${r.status})`);
  THREAD_LEAD.set(threadId, { leadId: created });
  return created!;
}

// ================= Tool Handlers =================
async function handleKommoTool(
  name: string,
  args: any,
  threadId: string,
  hubBaseUrl: string,
  hubSecret: string
) {
  const normalize = (v: any) => (v === undefined || v === null ? undefined : v);

  if (name === 'kommo_create_lead') {
    const payload = {
      action: 'create-lead',
      name: String(args?.name || 'Nuevo lead'),
      price: args?.price ?? 0,
      notes: String(args?.notes || ''),
      source: args?.source || 'webchat',
    };
    const r = await callHub(hubBaseUrl, hubSecret, payload);
    const lid = ensureNum(r?.json?.data?.lead_id);
    if (lid) THREAD_LEAD.set(threadId, { leadId: lid });
    return JSON.stringify(r);
  }

  if (name === 'kommo_attach_contact') {
    const lead_id =
      ensureNum(args?.lead_id) ||
      (await ensureLeadId(threadId, hubBaseUrl, hubSecret, {
        name: args?.name,
        notes: `Auto-lead p/ contacto ${args?.name || ''} ${args?.email || ''} ${args?.phone || ''}`.trim(),
      }));

    const payload = {
      action: 'attach-contact',
      lead_id,
      name: normalize(args?.name),
      email: normalize(args?.email),
      phone: normalize(args?.phone),
      notes: normalize(args?.notes),
    };
    const r = await callHub(hubBaseUrl, hubSecret, payload);
    return JSON.stringify(r);
  }

  if (name === 'kommo_add_note') {
    const lead_id =
      ensureNum(args?.lead_id) ||
      (await ensureLeadId(threadId, hubBaseUrl, hubSecret, { notes: 'Auto-lead p/ notas' }));

    const text = String(args?.text || '').trim();
    const payload = { action: 'add-note', lead_id, text };
    const r = await callHub(hubBaseUrl, hubSecret, payload);
    return JSON.stringify(r);
  }

  if (name === 'kommo_attach_transcript') {
    const lead_id =
      ensureNum(args?.lead_id) ||
      (await ensureLeadId(threadId, hubBaseUrl, hubSecret, { notes: 'Auto-lead p/ transcript' }));

    const payload = { action: 'attach-transcript', lead_id, transcript: getTranscript(threadId) };
    const r = await callHub(hubBaseUrl, hubSecret, payload);
    return JSON.stringify(r);
  }

  return JSON.stringify({ ok: false, error: `unknown tool: ${name}` });
}

// ================= Runner (SDK con runId primero) =================
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
  await openai.beta.threads.messages.create(threadId, { role: 'user', content: userText });
  pushTranscript(threadId, 'User', userText);

  // 3) Definimos tools del run (independiente del Assistant del panel)
  const tools: any[] = [
    {
      type: 'function',
      function: {
        name: 'kommo_create_lead',
        description: 'Crea un lead en Kommo con nombre, precio opcional, notas y origen',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            price: { type: 'number' },
            notes: { type: 'string' },
            source: { type: 'string', enum: ['webchat', 'landing', 'whatsapp', 'other'] },
          },
          required: ['name'],
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'kommo_attach_contact',
        description: 'Crea/actualiza un contacto y lo asocia al lead en Kommo',
        parameters: {
          type: 'object',
          properties: {
            lead_id: { type: 'number' },
            name: { type: 'string' },
            email: { type: 'string' },
            phone: { type: 'string' },
            notes: { type: 'string' },
          },
          required: ['name'],
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'kommo_add_note',
        description: 'Agrega una nota de texto al lead en Kommo',
        parameters: {
          type: 'object',
          properties: {
            lead_id: { type: 'number' },
            text: { type: 'string' },
          },
          required: ['text'],
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'kommo_attach_transcript',
        description: 'Adjunta la transcripción completa de la conversación como notas al lead en Kommo',
        parameters: {
          type: 'object',
          properties: { lead_id: { type: 'number' } },
          required: [],
          additionalProperties: false,
        },
      },
    },
  ];

  const additionalInstructions = `
- Usa el contexto del thread: no repitas lo que ya dijo el cliente.

  1) Llama a kommo_create_lead con nombre descriptivo del viaje (price opcional, notes = resumen).
  2) Si ya tienes nombre + (email o teléfono o instagram) Llama a kommo_attach_contact con name/email/phone y notes.
  3) Si ya tienes destino o fechas agrega notas al lead. Llama a kommo_add_note 
  4) Llama a kommo_add_note con un resumen del itinerario/preferencias.
  5) Llama a kommo_attach_transcript para registrar la conversación cada que responde el cliente.
- Si falta un dato, pregúntalo; no repitas preguntas ya respondidas.
`.trim();

  // 4) Run con tools y tool_choice auto
  let toolEvents: Array<{ name: string; status: number; ok: boolean }> = [];
  let run = await openai.beta.threads.runs.create(threadId, {
    assistant_id: ASSISTANT_ID,
    tools,
    tool_choice: 'auto',
    additional_instructions: additionalInstructions,
  });

  // 5) Loop de ejecución (SDK: runId primero)
  while (true) {
    run = await openai.beta.threads.runs.retrieve(run.id, { thread_id: threadId });
    // Log útil (se verá en Vercel si lo deseas)
    // console.log('CV:/assistant run status=', run.status);

    if (run.status === 'completed') break;

    if (run.status === 'requires_action') {
      const toolCalls = run.required_action?.submit_tool_outputs?.tool_calls || [];
      // console.log('CV:/assistant toolCalls=', toolCalls.map(t => t.function?.name));

      const outputs: { tool_call_id: string; output: string }[] = [];
      for (const call of toolCalls) {
        const name = call.function?.name as string;
        const args = JSON.parse(call.function?.arguments || '{}');

        const out = await handleKommoTool(name, args, threadId!, opts.hubBaseUrl, opts.hubSecret).catch(
          (e) => JSON.stringify({ ok: false, error: String(e?.message || e) })
        );
        outputs.push({ tool_call_id: call.id, output: out });

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

  // 6) Última respuesta del assistant
  const list = await openai.beta.threads.messages.list(threadId!, { order: 'desc', limit: 5 });
  const first = list.data.find((m) => m.role === 'assistant');
  const reply =
    first?.content?.map((c: any) => ('text' in c ? c.text?.value : '')).join('\n').trim() || '';

  if (reply) pushTranscript(threadId!, 'Assistant', reply);

  // 7) Adjunta transcripción si ya hay lead y el texto es suficiente
  const memo = THREAD_LEAD.get(threadId!);
  if (memo?.leadId) {
    try {
      const tx = getTranscript(threadId!);
      if (tx && tx.length > 80) {
        await callHub(opts.hubBaseUrl, opts.hubSecret, {
          action: 'attach-transcript',
          lead_id: memo.leadId,
          transcript: tx,
        });
      }
    } catch {
      // silencioso
    }
  }

  return { reply, threadId: threadId!, toolEvents };
}
