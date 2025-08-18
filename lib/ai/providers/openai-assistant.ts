import OpenAI from 'openai';
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

/* ---------- Helpers de compatibilidad con la API beta (idénticos a tu versión previa) ---------- */
const runsAny = (openai as any).beta.threads.runs;
const messagesAny = (openai as any).beta.threads.messages;

async function createThread() { const t = await (openai as any).beta.threads.create(); return t.id as string; }
async function addUserMessage(threadId: string, content: string) { return messagesAny.create(threadId, { role: 'user', content }); }
async function createRun(threadId: string, params: { assistant_id: string; tools?: any[] }) {
  try { return await runsAny.create(threadId, params); } catch { return await runsAny.create({ thread_id: threadId, ...params }); }
}
async function retrieveRun(threadId: string, runId: string) {
  try { return await runsAny.retrieve(threadId, runId); } catch { return await runsAny.retrieve(runId, { thread_id: threadId }); }
}
async function submitToolOutputs(threadId: string, runId: string, tool_outputs: any[]) {
  try { return await runsAny.submitToolOutputs(threadId, runId, { tool_outputs }); }
  catch { return await runsAny.submitToolOutputs(runId, { thread_id: threadId, tool_outputs }); }
}
async function listMessages(threadId: string, limit = 100) { return (openai as any).beta.threads.messages.list(threadId, { limit }); }

function extractTextFromMessage(m: any): string {
  if (!m?.content) return '';
  const parts = Array.isArray(m.content) ? m.content : [];
  const out: string[] = [];
  for (const p of parts) {
    if (!p || typeof p !== 'object') continue;
    if (p.type === 'text' && p.text?.value) out.push(p.text.value);
    else if (p.type === 'input_text' && p.input_text?.value) out.push(p.input_text.value);
    else if (p?.[p.type]?.text) out.push(String(p[p.type].text));
  }
  return out.filter(Boolean).join('\n');
}

/* ---------- HUB bridge ---------- */
async function callHub(hubBaseUrl: string, secret: string, path: string, payload: any) {
  const base = hubBaseUrl.replace(/\/+$/, '');
  const u = new URL(base + path);
  // fallback por query además del header
  if (secret) u.searchParams.set('secret', secret);

  const r = await fetch(u.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-bridge-secret': secret },
    body: JSON.stringify(payload),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`HUB ${u.pathname} ${r.status}: ${data?.error || 'hub_error'}`);
  return data;
}

/* ---------- TOOLS: orden que pediste ---------- */
function toolsSchema() {
  return [
    {
      type: 'function',
      function: {
        name: 'kommo_create_lead',
        description: 'Crea un lead en Kommo SIN contacto. Úsalo cuando se identifica intención de compra o una oportunidad.',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Nombre interno del lead (o usa algo descriptivo del viaje/consulta)' },
            price: { type: 'number' },
            pipeline_id: { type: 'number' },
            status_id: { type: 'number' },
            tags: { type: 'array', items: { type: 'string' } },
            source: { type: 'string' },
            notes: { type: 'string' },
            custom_fields: { type: 'object' },
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'kommo_update_lead',
        description: 'Actualiza campos del lead existente (precio, etapa, tags, custom_fields) y opcionalmente agrega nota.',
        parameters: {
          type: 'object',
          properties: {
            lead_id: { type: 'number' },
            price: { type: 'number' },
            pipeline_id: { type: 'number' },
            status_id: { type: 'number' },
            tags: { type: 'array', items: { type: 'string' } },
            custom_fields: { type: 'object' },
            notes: { type: 'string' }
          },
          required: ['lead_id']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'kommo_attach_contact',
        description: 'Crea o actualiza un CONTACTO y lo vincula al LEAD. Úsalo al recibir email/teléfono/nombre.',
        parameters: {
          type: 'object',
          properties: {
            lead_id: { type: 'number' },
            name: { type: 'string' },
            email: { type: 'string' },
            phone: { type: 'string' },
            notes: { type: 'string' }
          },
          required: ['lead_id']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'kommo_add_note',
        description: 'Agrega una nota al LEAD (resúmenes intermedios, decisiones, etc.).',
        parameters: {
          type: 'object',
          properties: { lead_id: { type: 'number' }, text: { type: 'string' } },
          required: ['lead_id','text']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'kommo_attach_transcript',
        description: 'Adjunta la conversación completa (hasta ahora) al LEAD. Úsalo al cierre o hitos.',
        parameters: {
          type: 'object',
          properties: { lead_id: { type: 'number' }, title: { type: 'string' } },
          required: ['lead_id']
        }
      }
    },
  ] as any[];
}

/* ---------- Ejecutor ---------- */
export async function runAssistantWithTools(
  userMessage: string,
  opts?: { threadId?: string | null; hubBaseUrl?: string; hubSecret?: string },
) {
  const assistantId = process.env.OPENAI_ASSISTANT_ID;
  if (!assistantId) throw new Error('Missing OPENAI_ASSISTANT_ID');

  const hubBaseUrl = (opts?.hubBaseUrl || process.env.NEXT_PUBLIC_HUB_BASE_URL || '').toString();
  const hubSecret  = (opts?.hubSecret  || process.env.HUB_BRIDGE_SECRET || '').toString();
  if (!hubBaseUrl || !hubSecret) throw new Error('HUB envs missing');

  let threadId = opts?.threadId || null;
  if (!threadId) threadId = await createThread();

  await addUserMessage(threadId, userMessage);

  let run = await createRun(threadId, { assistant_id: assistantId, tools: toolsSchema() });

  while (true) {
    run = await retrieveRun(threadId, run.id);

    if (run.status === 'completed') break;

    if (run.status === 'requires_action') {
      const calls = (run.required_action as any)?.submit_tool_outputs?.tool_calls || [];
      const outputs: { tool_call_id: string; output: string }[] = [];

      for (const tc of calls) {
        const name = tc.function?.name as string;
        const args = (() => { try { return JSON.parse(tc.function?.arguments || '{}'); } catch { return {}; } })();

        try {
          if (name === 'kommo_create_lead') {
            const result = await callHub(hubBaseUrl, hubSecret, '/api/kommo', { action: 'create-lead', ...args });
            outputs.push({ tool_call_id: tc.id, output: JSON.stringify(result) });

          } else if (name === 'kommo_update_lead') {
            const result = await callHub(hubBaseUrl, hubSecret, '/api/kommo', { action: 'update-lead', ...args });
            outputs.push({ tool_call_id: tc.id, output: JSON.stringify(result) });

          } else if (name === 'kommo_attach_contact') {
            const result = await callHub(hubBaseUrl, hubSecret, '/api/kommo', { action: 'attach-contact', ...args });
            outputs.push({ tool_call_id: tc.id, output: JSON.stringify(result) });

          } else if (name === 'kommo_add_note') {
            const result = await callHub(hubBaseUrl, hubSecret, '/api/kommo', { action: 'add-note', ...args });
            outputs.push({ tool_call_id: tc.id, output: JSON.stringify(result) });

          } else if (name === 'kommo_attach_transcript') {
            // construir transcript desde el thread
            const msgsRes = await listMessages(threadId, 100);
            const lines: string[] = [];
            const data = Array.isArray(msgsRes?.data) ? msgsRes.data : [];
            for (const m of data.slice().reverse()) {
              const role = String(m.role || '').toUpperCase();
              const txt = extractTextFromMessage(m);
              if (txt) lines.push(`${role}: ${txt}`);
            }
            const transcript = lines.join('\n\n');
            const result = await callHub(hubBaseUrl, hubSecret, '/api/kommo', {
              action: 'attach-transcript',
              lead_id: args?.lead_id,
              title: args?.title,
              transcript,
            });
            outputs.push({ tool_call_id: tc.id, output: JSON.stringify(result) });

          } else {
            outputs.push({ tool_call_id: tc.id, output: JSON.stringify({ error: `unknown_tool ${name}` }) });
          }
        } catch (err: any) {
          outputs.push({ tool_call_id: tc.id, output: JSON.stringify({ error: err?.message || 'tool_call_failed' }) });
        }
      }

      await submitToolOutputs(threadId, run.id, outputs);
      continue;
    }

    if (['failed', 'cancelled', 'expired'].includes(run.status)) {
      throw new Error(`Run ${run.status}`);
    }

    await new Promise((r) => setTimeout(r, 500));
  }

  const listRes = await listMessages(threadId, 10);
  const last = (listRes?.data || []).find((m: any) => m.role === 'assistant');
  const reply = extractTextFromMessage(last) || '¿Algo más en lo que te ayude?';

  return { reply, threadId };
}
