import OpenAI from 'openai';

// ===== ENV =====
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID || process.env.ASSISTANT_ID || '';
if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY missing');
if (!ASSISTANT_ID) throw new Error('OPENAI_ASSISTANT_ID/ASSISTANT_ID missing');

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// ===== Memorias simples en proceso (por thread) =====
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

// ===== Tool handlers =====
async function handleKommoTool(
  name: string,
  args: any,
  threadId: string,
  hubBaseUrl: string,
  hubSecret: string
) {
  const leadMemo = THREAD_LEAD.get(threadId) || {};

  // inyecta lead_id si ya lo tenemos
  const withLead = (obj: any) => {
    const lid = ensureNum(obj?.lead_id) || leadMemo.leadId;
    if (lid) obj.lead_id = lid;
    return obj;
  };

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
    const payload = withLead({
      action: 'attach-contact',
      lead_id: args?.lead_id,
      name: args?.name,
      email: args?.email,
      phone: args?.phone,
      notes: args?.notes || '',
    });
    const r = await callHub(hubBaseUrl, hubSecret, payload);
    return JSON.stringify(r);
  }

  if (name === 'kommo_add_note') {
    const payload = withLead({
      action: 'add-note',
      lead_id: args?.lead_id,
      text: String(args?.text || '').slice(0, 15000),
      // transcript lo mandamos aparte cuando aplique
    });
    const r = await callHub(hubBaseUrl, hubSecret, payload);
    return JSON.stringify(r);
  }

  if (name === 'kommo_attach_transcript') {
    const transcript = getTranscript(threadId);
    const payload = withLead({ action: 'attach-transcript', lead_id: args?.lead_id, transcript });
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

  // 3) Run + resolver tools
  let toolEvents: Array<{ name: string; status: number; ok: boolean }> = [];
  let run = await openai.beta.threads.runs.create(threadId, { assistant_id: ASSISTANT_ID });

  // ⚠️ En tu versión del SDK:
  // retrieve(runId, { thread_id })
  // submitToolOutputs(runId, { thread_id, tool_outputs })
  while (true) {
    run = await openai.beta.threads.runs.retrieve(run.id, { thread_id: threadId });

    if (run.status === 'completed') break;

    if (run.status === 'requires_action') {
      const toolCalls = run.required_action?.submit_tool_outputs?.tool_calls || [];

      const outputs: { tool_call_id: string; output: string }[] = [];
      for (const call of toolCalls) {
        const name = call.function?.name as string;
        const args = JSON.parse(call.function?.arguments || '{}');

        // Inyecta lead_id si lo tenemos
        if (!args?.lead_id) {
          const memo = THREAD_LEAD.get(threadId);
          if (memo?.leadId) args.lead_id = memo.leadId;
        }

        const out = await handleKommoTool(name, args, threadId, opts.hubBaseUrl, opts.hubSecret).catch(
          (e) => JSON.stringify({ ok: false, error: String(e?.message || e) })
        );
        outputs.push({ tool_call_id: call.id, output: out });

        // Log/evento
        try {
          const parsed = JSON.parse(out);
          toolEvents.push({ name, status: Number(parsed?.status || 200), ok: !!parsed?.ok });
          const lid = ensureNum(parsed?.json?.data?.lead_id) || ensureNum(parsed?.data?.lead_id);
          if (lid) THREAD_LEAD.set(threadId, { leadId: lid });
        } catch {
          toolEvents.push({ name, status: 200, ok: true });
        }
      }

      await openai.beta.threads.runs.submitToolOutputs(run.id, {
        thread_id: threadId,
        tool_outputs: outputs,
      });
    }

    if (['failed', 'cancelled', 'expired'].includes(run.status)) {
      throw new Error(`Run ${run.status}`);
    }

    await new Promise((r) => setTimeout(r, 500));
  }

  // 4) Último mensaje del assistant
  const list = await openai.beta.threads.messages.list(threadId, { order: 'desc', limit: 5 });
  const first = list.data.find((m) => m.role === 'assistant');
  const reply =
    first?.content?.map((c: any) => ('text' in c ? c.text?.value : '')).join('\n').trim() || '';

  if (reply) pushTranscript(threadId, 'Assistant', reply);

  // 5) Adjuntar transcripción si ya hay lead
  const memo = THREAD_LEAD.get(threadId);
  if (memo?.leadId) {
    try {
      const transcript = getTranscript(threadId);
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

  return { reply, threadId, toolEvents };
}
