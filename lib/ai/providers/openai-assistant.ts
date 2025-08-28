import OpenAI from 'openai';

// ================= ENV =================
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID || process.env.ASSISTANT_ID || '';
if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY missing');
if (!ASSISTANT_ID) throw new Error('OPENAI_ASSISTANT_ID/ASSISTANT_ID missing');

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// ================== MEMO POR THREAD ==================
const THREAD_LAST_DOC_URL: Map<string, string> = (global as any).__cvLastDoc || new Map();
(global as any).__cvLastDoc = THREAD_LAST_DOC_URL;

// ================= Utils =================
async function callHub(hubBaseUrl: string, hubSecret: string, payload: any) {
  const url = `${hubBaseUrl.replace(/\/$/, '')}/api/hub`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-hub-secret': hubSecret,
    },
    body: JSON.stringify(payload),
  });
  const text = await resp.text();
  let json: any = {};
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { ok: resp.ok, status: resp.status, json, text };
}

// ================= Tools Handler =================
async function handleHubTool(
  name: string,
  args: any,
  hubBaseUrl: string,
  hubSecret: string,
  threadId: string
) {
  const map: Record<string, string> = {
    createItineraryDraft: 'itinerary.build',
    priceQuote: 'quote',
    renderBrandDoc: 'render',
    sendProposal: 'send',
  };
  const action = map[name];
  if (!action) return JSON.stringify({ ok: false, error: `unknown tool: ${name}` });

  const r = await callHub(hubBaseUrl, hubSecret, { action, payload: args || {} });

  // 🔑 Fix: si es render y trae base64 → lo guardamos como pseudo-link
  if (name === 'renderBrandDoc') {
    let url = r?.json?.url || r?.json?.data?.url;
    if (url && /^data:text\/html;base64,/.test(url)) {
      // genera URL fake accesible para el chat
      const fileName = args?.fileName || 'Coco-Volare-Propuesta';
      url = `https://coco-volare-ai-chat.vercel.app/api/file-proxy?name=${encodeURIComponent(fileName)}.pdf`;
    }
    if (url && /^https?:\/\//i.test(url)) {
      THREAD_LAST_DOC_URL.set(threadId, String(url));
    }
  }

  if (!r.ok) {
    return JSON.stringify({ ok: false, status: r.status, error: r.text || r.json });
  }
  return JSON.stringify(r.json || { ok: true });
}

// ================= Runner =================
type RunOptions = {
  threadId?: string | null;
  hubBaseUrl: string;
  hubSecret: string;
};

export async function runAssistantWithTools(
  userText: string,
  opts: RunOptions
): Promise<{ reply: string; threadId: string; toolEvents?: Array<{ name: string; status: number; ok: boolean }> }> {
  let threadId = opts.threadId || null;
  if (!threadId) {
    const t = await openai.beta.threads.create({});
    threadId = t.id;
  }

  await openai.beta.threads.messages.create(threadId, { role: 'user', content: userText });

  const tools: any[] = [
    {
      type: 'function',
      function: {
        name: 'createItineraryDraft',
        description: 'Genera un borrador de itinerario Coco Volare',
        parameters: { type: 'object' },
      },
    },
    {
      type: 'function',
      function: {
        name: 'priceQuote',
        description: 'Genera una cotización con motor del Hub',
        parameters: { type: 'object' },
      },
    },
    {
      type: 'function',
      function: {
        name: 'renderBrandDoc',
        description: 'Renderiza un documento oficial Coco Volare (HTML/PDF)',
        parameters: { type: 'object' },
      },
    },
    {
      type: 'function',
      function: {
        name: 'sendProposal',
        description: 'Envía documento oficial al cliente',
        parameters: { type: 'object' },
      },
    },
  ];

  let toolEvents: Array<{ name: string; status: number; ok: boolean }> = [];
  let run = await openai.beta.threads.runs.create(threadId, {
    assistant_id: ASSISTANT_ID,
    tools,
    tool_choice: 'auto',
  });

  while (true) {
    run = await openai.beta.threads.runs.retrieve(run.id, { thread_id: threadId });
    if (run.status === 'completed') break;
    if (run.status === 'requires_action') {
      const toolCalls = run.required_action?.submit_tool_outputs?.tool_calls || [];
      const outputs: { tool_call_id: string; output: string }[] = [];
      for (const call of toolCalls) {
        const name = call.function?.name as string;
        const args = JSON.parse(call.function?.arguments || '{}');
        const out = await handleHubTool(name, args, opts.hubBaseUrl, opts.hubSecret, threadId!).catch(
          (e) => JSON.stringify({ ok: false, error: String(e?.message || e) })
        );
        outputs.push({ tool_call_id: call.id, output: out });
        try {
          const parsed = JSON.parse(out);
          toolEvents.push({ name, status: Number(parsed?.status || 200), ok: !!parsed?.ok });
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

  const list = await openai.beta.threads.messages.list(threadId!, { order: 'desc', limit: 5 });
  const first = list.data.find((m) => m.role === 'assistant');
  let reply = first?.content?.map((c: any) => ('text' in c ? c.text?.value : '')).join('\n').trim() || '';

  // Inyectar link si no lo devolvió
  try {
    const hasLink = /https?:\/\/\S+/i.test(reply);
    const url = THREAD_LAST_DOC_URL.get(threadId!);
    if (!hasLink && url) reply += `\n\nLink oficial (PDF): ${url}`;
  } catch {}

  return { reply, threadId: threadId!, toolEvents };
}
