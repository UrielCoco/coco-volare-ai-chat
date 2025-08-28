import OpenAI from "openai";

// ================= ENV =================
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const ASSISTANT_ID =
  process.env.OPENAI_ASSISTANT_ID || process.env.ASSISTANT_ID || "";
if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY missing");
if (!ASSISTANT_ID) throw new Error("OPENAI_ASSISTANT_ID/ASSISTANT_ID missing");

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// ================= In-memory stores =================
type DocBlob = { mime: string; bin: Buffer; filename: string };
const DOC_BLOB_STORE: Map<string, DocBlob> =
  (global as any).__cvDocBlobs || new Map();
(global as any).__cvDocBlobs = DOC_BLOB_STORE;

const THREAD_LAST_DOC_URL: Map<string, string> =
  (global as any).__cvLastDoc || new Map();
(global as any).__cvLastDoc = THREAD_LAST_DOC_URL;

// ================= Utils =================
function uuidLike() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

async function callHub(hubBaseUrl: string, hubSecret: string, payload: any) {
  const url = `${hubBaseUrl.replace(/\/$/, "")}/api/hub`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-hub-secret": hubSecret,
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

function parseDataUrl(dataUrl: string): { mime: string; bin: Buffer } | null {
  // data:<mime>;base64,<payload>
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/i);
  if (!m) return null;
  const mime = m[1];
  const base64 = m[2];
  try {
    const bin = Buffer.from(base64, "base64");
    return { mime, bin };
  } catch {
    return null;
  }
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
    createItineraryDraft: "itinerary.build",
    priceQuote: "quote",
    renderBrandDoc: "render",
    sendProposal: "send",
  };
  const action = map[name];
  if (!action) return JSON.stringify({ ok: false, error: `unknown tool: ${name}` });

  const r = await callHub(hubBaseUrl, hubSecret, { action, payload: args || {} });

  // 🔑 Render: si el Hub devuelve data:URL → lo guardamos y generamos link proxy
  if (name === "renderBrandDoc") {
    let url = r?.json?.url || r?.json?.data?.url;
    if (typeof url === "string" && url.startsWith("data:")) {
      const parsed = parseDataUrl(url);
      if (parsed) {
        const isPdf = parsed.mime.toLowerCase() === "application/pdf";
        const isHtml = parsed.mime.toLowerCase() === "text/html";
        const baseName = String(args?.fileName || "Coco-Volare-Propuesta").replace(/\.(pdf|html)$/i, "");
        const filename = isPdf ? `${baseName}.pdf` : isHtml ? `${baseName}.html` : `${baseName}.bin`;

        const id = uuidLike();
        DOC_BLOB_STORE.set(id, { mime: parsed.mime, bin: parsed.bin, filename });

        // URL del proxy del chat-app
        const base = process.env.NEXT_PUBLIC_SITE_URL || "https://coco-volare-ai-chat.vercel.app";
        url = `${base.replace(/\/$/,"")}/api/file-proxy?id=${encodeURIComponent(id)}&name=${encodeURIComponent(filename)}`;
      }
    }
    if (url && /^https?:\/\//i.test(url)) {
      THREAD_LAST_DOC_URL.set(threadId, String(url));
      // además, reflejamos el nuevo url en la respuesta para el Assistant
      r.json = { ...(r.json || {}), url };
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

  // 2) Mensaje user
  await openai.beta.threads.messages.create(threadId, {
    role: "user",
    content: userText,
  });

  // 3) Tools con JSON Schema COMPLETO
  const tools: any[] = [
    {
      type: "function",
      function: {
        name: "createItineraryDraft",
        description:
          "Genera un borrador oficial de itinerario (Coco Volare). Devuelve JSON estructurado del itinerario.",
        parameters: {
          type: "object",
          properties: {
            travelerProfile: {
              type: "string",
              enum: ["corporate", "leisure", "honeymoon", "bleisure"],
            },
            cityBases: {
              type: "array",
              items: { type: "string" },
              minItems: 1,
            },
            days: { type: "number", minimum: 1, maximum: 31 },
            currency: { type: "string", enum: ["USD", "COP", "MXN", "EUR"], default: "USD" },
            brandMeta: {
              type: "object",
              properties: {
                templateId: {
                  type: "string",
                  enum: ["CV-LUX-01", "CV-CORP-01", "CV-ADVENTURE-01"],
                },
                accent: { type: "string", enum: ["gold", "black", "white"], default: "gold" },
                watermark: { type: "boolean", default: true },
              },
              required: ["templateId"],
              additionalProperties: false,
            },
            preferences: { type: "object" },
          },
          required: ["travelerProfile", "cityBases", "days", "brandMeta"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "priceQuote",
        description:
          "Genera una cotización oficial con desglose (items, fees, taxes, total, vigencia).",
        parameters: {
          type: "object",
          properties: {
            destination: { type: "string" },
            startDate: { type: "string" },
            endDate: { type: "string" },
            pax: { type: "number", minimum: 1 },
            category: { type: "string", enum: ["3S", "4S", "5S"] },
            extras: { type: "array", items: { type: "string" } },
            currency: { type: "string", enum: ["USD", "COP", "MXN", "EUR"], default: "USD" },
          },
          required: ["destination", "startDate", "endDate", "pax", "category"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "renderBrandDoc",
        description:
          "Renderiza itinerario/cotización en formato oficial Coco Volare (HTML o PDF) y devuelve una URL.",
        parameters: {
          type: "object",
          properties: {
            templateId: {
              type: "string",
              enum: ["CV-LUX-01", "CV-CORP-01", "CV-ADVENTURE-01", "CV-TERMS-STD-01"],
            },
            payloadJson: { type: "object" },
            output: { type: "string", enum: ["pdf", "html"], default: "html" },
            fileName: { type: "string", default: "Coco-Volare-Propuesta" },
          },
          required: ["templateId", "payloadJson"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "sendProposal",
        description:
          "Envía el link del documento oficial al cliente por email o WhatsApp (usa docUrl devuelto por renderBrandDoc).",
        parameters: {
          type: "object",
          properties: {
            to: { type: "string" },
            channel: { type: "string", enum: ["email", "whatsapp"] },
            docUrl: { type: "string" },
            message: { type: "string" },
          },
          required: ["to", "channel", "docUrl"],
          additionalProperties: false,
        },
      },
    },
  ];

  let toolEvents: Array<{ name: string; status: number; ok: boolean }> = [];
  let run = await openai.beta.threads.runs.create(threadId, {
    assistant_id: ASSISTANT_ID,
    tools,
    tool_choice: "auto",
  });

  // 4) Loop
  while (true) {
    run = await openai.beta.threads.runs.retrieve(run.id, { thread_id: threadId });
    if (run.status === "completed") break;

    if (run.status === "requires_action") {
      const toolCalls = run.required_action?.submit_tool_outputs?.tool_calls || [];
      const outputs: { tool_call_id: string; output: string }[] = [];

      for (const call of toolCalls) {
        const name = call.function?.name as string;
        const args = JSON.parse(call.function?.arguments || "{}");

        const out = await handleHubTool(
          name,
          args,
          opts.hubBaseUrl,
          opts.hubSecret,
          threadId!
        ).catch((e) => JSON.stringify({ ok: false, error: String(e?.message || e) }));

        outputs.push({ tool_call_id: call.id, output: out });

        try {
          const parsed = JSON.parse(out);
          toolEvents.push({
            name,
            status: Number(parsed?.status || 200),
            ok: !!(parsed?.ok ?? true),
          });
        } catch {
          toolEvents.push({ name, status: 200, ok: true });
        }
      }

      await openai.beta.threads.runs.submitToolOutputs(run.id, {
        thread_id: threadId!,
        tool_outputs: outputs,
      });
    }

    if (["failed", "cancelled", "expired"].includes(run.status)) {
      throw new Error(`Run ${run.status}`);
    }

    await new Promise((r) => setTimeout(r, 500));
  }

  // 5) Obtener última respuesta
  const list = await openai.beta.threads.messages.list(threadId!, {
    order: "desc",
    limit: 8,
  });
  const first = list.data.find((m) => m.role === "assistant");
  let reply =
    first?.content?.map((c: any) => ("text" in c ? c.text?.value : "")).join("\n").trim() ||
    "";

  // 6) Inyectar link si el Assistant no lo pegó
  try {
    const hasLink = /https?:\/\/\S+/i.test(reply);
    const url = THREAD_LAST_DOC_URL.get(threadId!);
    if (!hasLink && url) reply += `\n\nLink oficial (documento): ${url}`;
  } catch {}

  return { reply, threadId: threadId!, toolEvents };
}

// ============== Export para el file-proxy ==============
export function __cvResolveBlob(id: string): DocBlob | undefined {
  return DOC_BLOB_STORE.get(id);
}
