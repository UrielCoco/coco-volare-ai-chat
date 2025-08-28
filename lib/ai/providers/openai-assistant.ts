import OpenAI from 'openai';

/* ================= ENV ================= */
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID || process.env.ASSISTANT_ID || '';
if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY missing');
if (!ASSISTANT_ID) throw new Error('OPENAI_ASSISTANT_ID/ASSISTANT_ID missing');

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

/* ============== MEMO POR THREAD (proceso) ============== */
type LeadMemo = { leadId?: number };
const THREAD_LEAD: Map<string, LeadMemo> = (global as any).__cvThreadLead || new Map();
(global as any).__cvThreadLead = THREAD_LEAD;

const THREAD_TRANSCRIPT: Map<string, string[]> = (global as any).__cvThreadTx || new Map();
(global as any).__cvThreadTx = THREAD_TRANSCRIPT;

/* ================= Utils ================= */
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

/* ================= HTTP helpers ================= */
async function postJson(url: string, headers: Record<string,string>, body: any) {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body ?? {}),
  });
  const text = await resp.text();
  try {
    const json = JSON.parse(text);
    return { ok: resp.ok, status: resp.status, json, raw: text };
  } catch {
    return { ok: resp.ok, status: resp.status, json: null, raw: text };
  }
}

/** Bridge Kommo (pages router): usamos /api/kommo */
async function callKommo(hubBaseUrl: string, hubSecret: string, payload: any) {
  const url = `${hubBaseUrl.replace(/\/$/, '')}/api/kommo?secret=${encodeURIComponent(hubSecret)}`;
  return postJson(url, { 'x-bridge-secret': hubSecret }, payload);
}

/** Bridge Hub (pages router): usamos /api/hub con action + payload */
async function callHubAction(
  hubBaseUrl: string,
  hubSecret: string,
  action: 'itinerary.build' | 'quote' | 'render' | 'send',
  payload: any
) {
  const url = `${hubBaseUrl.replace(/\/$/, '')}/api/hub`;
  return postJson(url, { 'x-hub-secret': hubSecret }, { action, payload });
}

/* ====== Asegurar lead si falta (auto-create, vía Kommo) ====== */
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

  const r = await callKommo(hubBaseUrl, hubSecret, {
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

/* ================= Tool Handlers ================= */
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
    const r = await callKommo(hubBaseUrl, hubSecret, payload);
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
    const r = await callKommo(hubBaseUrl, hubSecret, payload);
    return JSON.stringify(r);
  }

  if (name === 'kommo_add_note') {
    const lead_id =
      ensureNum(args?.lead_id) ||
      (await ensureLeadId(threadId, hubBaseUrl, hubSecret, { notes: 'Auto-lead p/ notas' }));

    const text = String(args?.text || '').trim();
    const payload = { action: 'add-note', lead_id, text };
    const r = await callKommo(hubBaseUrl, hubSecret, payload);
    return JSON.stringify(r);
  }

  if (name === 'kommo_attach_transcript') {
    const lead_id =
      ensureNum(args?.lead_id) ||
      (await ensureLeadId(threadId, hubBaseUrl, hubSecret, { notes: 'Auto-lead p/ transcript' }));

    const payload = { action: 'attach-transcript', lead_id, transcript: getTranscript(threadId) };
    const r = await callKommo(hubBaseUrl, hubSecret, payload);
    return JSON.stringify(r);
  }

  return JSON.stringify({ ok: false, error: `unknown kommo tool: ${name}` });
}

async function handleHubTool(
  name: string,
  args: any,
  _threadId: string,
  hubBaseUrl: string,
  hubSecret: string
) {
  if (name === 'createItineraryDraft') {
    const r = await callHubAction(hubBaseUrl, hubSecret, 'itinerary.build', args);
    return JSON.stringify(r.json || r);
  }
  if (name === 'priceQuote') {
    const r = await callHubAction(hubBaseUrl, hubSecret, 'quote', args);
    return JSON.stringify(r.json || r);
  }
  if (name === 'renderBrandDoc') {
    const r = await callHubAction(hubBaseUrl, hubSecret, 'render', args);
    return JSON.stringify(r.json || r);
  }
  if (name === 'sendProposal') {
    const r = await callHubAction(hubBaseUrl, hubSecret, 'send', args);
    return JSON.stringify(r.json || r);
  }
  return JSON.stringify({ ok: false, error: `unknown hub tool: ${name}` });
}

/* ================= Runner (SDK con runId primero) ================= */
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
  await openai.beta.threads.messages.create(threadId!, { role: 'user', content: userText });
  pushTranscript(threadId!, 'User', userText);

  // 3) Definimos TODAS las tools (Kommo + Hub) para este run
  const tools: any[] = [
    // ===== Kommo =====
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

    // ===== Hub =====
    {
      type: 'function',
      function: {
        name: 'createItineraryDraft',
        description: 'Crea un borrador de itinerario en formato Coco Volare',
        parameters: {
          type: 'object',
          properties: {
            travelerProfile: { type: 'string', enum: ['corporate', 'leisure', 'honeymoon', 'bleisure'] },
            cityBases: { type: 'array', items: { type: 'string' } },
            days: { type: 'number', minimum: 1, maximum: 31 },
            currency: { type: 'string', enum: ['USD', 'COP', 'MXN', 'EUR'], default: 'USD' },
            brandMeta: {
              type: 'object',
              properties: {
                templateId: { type: 'string', enum: ['CV-LUX-01', 'CV-CORP-01', 'CV-ADVENTURE-01'] },
                accent: { type: 'string', enum: ['gold', 'black', 'white'], default: 'gold' },
                watermark: { type: 'boolean', default: true },
              },
              required: ['templateId'],
              additionalProperties: true,
            },
            preferences: { type: 'object', additionalProperties: true },
          },
          required: ['travelerProfile', 'cityBases', 'days', 'brandMeta'],
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'priceQuote',
        description: 'Genera cotización con desglose',
        parameters: {
          type: 'object',
          properties: {
            destination: { type: 'string' },
            startDate: { type: 'string' },
            endDate: { type: 'string' },
            pax: { type: 'number' },
            category: { type: 'string', enum: ['3S', '4S', '5S'] },
            extras: { type: 'array', items: { type: 'string' } },
            currency: { type: 'string', enum: ['USD', 'COP', 'MXN', 'EUR'], default: 'USD' },
          },
          required: ['destination', 'startDate', 'endDate', 'pax', 'category'],
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'renderBrandDoc',
        description: 'Renderiza documento oficial (HTML/PDF) a partir de JSON',
        parameters: {
          type: 'object',
          properties: {
            templateId: { type: 'string', enum: ['CV-LUX-01', 'CV-CORP-01', 'CV-ADVENTURE-01', 'CV-TERMS-STD-01'] },
            payloadJson: { type: 'object', additionalProperties: true },
            output: { type: 'string', enum: ['pdf', 'html'], default: 'html' },
            fileName: { type: 'string', default: 'Coco-Volare-Propuesta' },
          },
          required: ['templateId', 'payloadJson'],
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'sendProposal',
        description: 'Envía la propuesta al cliente (email/WhatsApp)',
        parameters: {
          type: 'object',
          properties: {
            to: { type: 'string' },
            channel: { type: 'string', enum: ['email', 'whatsapp'] },
            docUrl: { type: 'string' },
            message: { type: 'string' },
          },
          required: ['to', 'channel', 'docUrl'],
          additionalProperties: false,
        },
      },
    },
  ];

  const additionalInstructions = `
- Usa el contexto del thread: no repitas lo que ya dijo el cliente.

- Reglas Kommo:
  1) kommo_create_lead con nombre descriptivo del viaje (price opcional, notes = resumen).
  2) Si ya tienes nombre + (email o teléfono o instagram) → kommo_attach_contact.
  3) Si ya tienes destino/fechas/pax/preferencias → kommo_add_note con resumen.
  4) Al final de cada bloque de avance → kommo_attach_transcript.

- Reglas Hub:
  - createItineraryDraft cuando piden itinerario (con brandMeta).
  - priceQuote cuando piden cotización; usar moneda y categoría.
  - renderBrandDoc para HTML/PDF oficial; NO inventes links.
  - sendProposal para enviar a WhatsApp/email con el docUrl devuelto.

- Si falta un dato crítico, pregúntalo breve; no repitas preguntas ya respondidas.
`.trim();

  // 4) Run con tools y tool_choice auto
  let toolEvents: Array<{ name: string; status: number; ok: boolean }> = [];
  let run = await openai.beta.threads.runs.create(threadId!, {
    assistant_id: ASSISTANT_ID,
    tools,
    tool_choice: 'auto',
    additional_instructions: additionalInstructions,
  });

  // 5) Loop de ejecución
  while (true) {
    run = await openai.beta.threads.runs.retrieve(run.id, { thread_id: threadId! });

    if (run.status === 'completed') break;

    if (run.status === 'requires_action') {
      const toolCalls = run.required_action?.submit_tool_outputs?.tool_calls || [];
      const outputs: { tool_call_id: string; output: string }[] = [];

      for (const call of toolCalls) {
        const name = call.function?.name as string;
        const args = JSON.parse(call.function?.arguments || '{}');

        let out = '';
        try {
          if (name.startsWith('kommo_')) {
            out = await handleKommoTool(name, args, threadId!, opts.hubBaseUrl, opts.hubSecret);
          } else {
            out = await handleHubTool(name, args, threadId!, opts.hubBaseUrl, opts.hubSecret);
          }
        } catch (e: any) {
          out = JSON.stringify({ ok: false, error: String(e?.message || e) });
        }

        outputs.push({ tool_call_id: call.id, output: out });

        // logging/estado para Vercel
        try {
          const parsed = JSON.parse(out);
          toolEvents.push({ name, status: Number(parsed?.status || 200), ok: !!(parsed?.ok ?? true) });
          const lid =
            ensureNum(parsed?.json?.data?.lead_id) ||
            ensureNum(parsed?.data?.lead_id);
          if (lid && name.startsWith('kommo_')) THREAD_LEAD.set(threadId!, { leadId: lid });
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
  const list = await openai.beta.threads.messages.list(threadId!, { order: 'desc', limit: 6 });
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
        await callKommo(opts.hubBaseUrl, opts.hubSecret, {
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
