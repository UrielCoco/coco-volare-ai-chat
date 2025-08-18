// lib/ai/providers/openai-assistant.ts
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

type RunWithToolsArgs = {
  userMessage: string;
  threadId?: string | null;
  hubBaseUrl?: string;
  hubSecret?: string;
};

async function callHub(hubBaseUrl: string, secret: string, path: string, payload: any) {
  const r = await fetch(`${hubBaseUrl.replace(/\/+$/, '')}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-bridge-secret': secret },
    body: JSON.stringify(payload),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`HUB ${path} ${r.status}: ${data?.error || 'hub_error'}`);
  return data;
}

function toolsSchema() {
  return [
    {
      type: 'function',
      function: {
        name: 'kommo_upsert',
        description: 'Crea/actualiza contacto y lead en Kommo y devuelve ids.',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            email: { type: 'string' },
            phone: { type: 'string' },
            price: { type: 'number' },
            pipeline_id: { type: 'number' },
            status_id: { type: 'number' },
            tags: { type: 'array', items: { type: 'string' } },
            source: { type: 'string' },
            notes: { type: 'string' },
            custom_fields: { type: 'object' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'kommo_add_note',
        description: 'Agrega una nota de texto a un lead existente en Kommo.',
        parameters: {
          type: 'object',
          properties: {
            lead_id: { type: 'number' },
            text: { type: 'string' },
          },
          required: ['lead_id', 'text'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'kommo_attach_transcript',
        description: 'Adjunta toda la conversación actual como notas al lead.',
        parameters: {
          type: 'object',
          properties: {
            lead_id: { type: 'number' },
            title: { type: 'string' },
          },
          required: ['lead_id'],
        },
      },
    },
  ] as any[];
}

/** ---------- Helpers de compatibilidad con cambios de firma ---------- */
const runsAny = (openai as any).beta.threads.runs;
const messagesAny = (openai as any).beta.threads.messages;

async function createThread() {
  const t = await (openai as any).beta.threads.create();
  return t.id as string;
}

async function addUserMessage(threadId: string, content: string) {
  // Firma estable: (threadId, { role, content })
  return messagesAny.create(threadId, { role: 'user', content });
}

async function createRun(threadId: string, params: { assistant_id: string; tools?: any[] }) {
  // Soportar ambas firmas: (threadId, params) y ({ thread_id, ... })
  try {
    return await runsAny.create(threadId, params);
  } catch {
    return await runsAny.create({ thread_id: threadId, ...params });
  }
}

async function retrieveRun(threadId: string, runId: string) {
  // Soportar (threadId, runId) y (runId, { thread_id })
  try {
    return await runsAny.retrieve(threadId, runId);
  } catch {
    return await runsAny.retrieve(runId, { thread_id: threadId });
  }
}

async function submitToolOutputs(threadId: string, runId: string, tool_outputs: any[]) {
  // Soportar (threadId, runId, { tool_outputs }) y (runId, { thread_id, tool_outputs })
  try {
    return await runsAny.submitToolOutputs(threadId, runId, { tool_outputs });
  } catch {
    return await runsAny.submitToolOutputs(runId, { thread_id: threadId, tool_outputs });
  }
}

async function listMessages(threadId: string, limit = 100) {
  // Firma estable: (threadId, { limit })
  return (openai as any).beta.threads.messages.list(threadId, { limit });
}

/** ---------- Utilidad: sacar texto seguro de mensajes ---------- */
function extractTextFromMessage(m: any): string {
  if (!m?.content) return '';
  const parts = Array.isArray(m.content) ? m.content : [];
  const texts: string[] = [];
  for (const p of parts) {
    if (!p || typeof p !== 'object') continue;
    // Tipos más comunes
    if (p.type === 'text' && p.text?.value) texts.push(p.text.value);
    // Algunos SDKs pueden exponer variantes:
    else if (p.type === 'input_text' && p.input_text?.value) texts.push(p.input_text.value);
    else if (p?.[p.type]?.text) texts.push(String(p[p.type].text));
  }
  return texts.filter(Boolean).join('\n');
}

/** ---------- Función pública ---------- */
export async function runAssistantWithTools(
  userMessage: string,
  opts?: { threadId?: string | null; hubBaseUrl?: string; hubSecret?: string },
) {
  const assistantId = process.env.OPENAI_ASSISTANT_ID;
  if (!assistantId) throw new Error('Missing OPENAI_ASSISTANT_ID');

  const hubBaseUrl = (opts?.hubBaseUrl || process.env.NEXT_PUBLIC_HUB_BASE_URL || '').toString();
  const hubSecret  = (opts?.hubSecret  || process.env.HUB_BRIDGE_SECRET || '').toString();
  if (!hubBaseUrl || !hubSecret) throw new Error('HUB envs missing');

  // 1) Thread persistente
  let threadId = opts?.threadId || null;
  if (!threadId) threadId = await createThread();

  // 2) Mensaje del usuario
  await addUserMessage(threadId, userMessage);

  // 3) Correr Assistant con tools
  let run = await createRun(threadId, { assistant_id: assistantId, tools: toolsSchema() });

  // 4) Loop de estado
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
          if (name === 'kommo_upsert') {
            const result = await callHub(hubBaseUrl, hubSecret, '/api/kommo/upsert', args);
            outputs.push({ tool_call_id: tc.id, output: JSON.stringify(result) });

          } else if (name === 'kommo_add_note') {
            const result = await callHub(hubBaseUrl, hubSecret, '/api/kommo/add-note', args);
            outputs.push({ tool_call_id: tc.id, output: JSON.stringify(result) });

          } else if (name === 'kommo_attach_transcript') {
            // Transcript del thread
            const msgsRes = await listMessages(threadId, 100);
            const lines: string[] = [];
            const data = Array.isArray(msgsRes?.data) ? msgsRes.data : [];
            for (const m of data.slice().reverse()) {
              const role = String(m.role || '').toUpperCase();
              const txt = extractTextFromMessage(m);
              if (txt) lines.push(`${role}: ${txt}`);
            }
            const transcript = lines.join('\n\n');

            const result = await callHub(hubBaseUrl, hubSecret, '/api/kommo/attach-transcript', {
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

  // 5) Última respuesta
  const listRes = await listMessages(threadId, 10);
  const last = (listRes?.data || []).find((m: any) => m.role === 'assistant');
  const reply = extractTextFromMessage(last) || '¿Algo más en lo que te ayude?';

  return { reply, threadId };
}
