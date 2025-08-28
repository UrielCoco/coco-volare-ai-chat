/* /app/(chat)/api/chat/route.ts
 * Handler antifalla:
 *   1) streamText (AI SDK)
 *   2) fallback: ensamblar texto
 *   3) último recurso: OpenAI Chat Completions directo
 *   + logs detallados + CORS + timeouts
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import OpenAI from "openai";
import { streamText } from "ai";

import { myProvider } from "@/lib/ai/providers";
import {
  hubBuildItinerary,
  hubQuote,
  hubRender,
  hubSend,
} from "@/lib/ai/tools-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ===================== Zod Schemas ===================== */
const BrandMeta = z.object({
  templateId: z.enum(["CV-LUX-01", "CV-CORP-01", "CV-ADVENTURE-01"]),
  accent: z.enum(["gold", "black", "white"]).default("gold"),
  watermark: z.boolean().default(true),
});
const Activity = z.object({
  timeRange: z.string().optional(),
  title: z.string(),
  description: z.string(),
  logistics: z.string().optional(),
  icon: z.string().optional(),
});
const ItineraryDay = z.object({
  dayNumber: z.number(),
  title: z.string(),
  date: z.string().optional(),
  breakfastIncluded: z.boolean().default(true),
  activities: z.array(Activity),
  notes: z.string().optional(),
});
const ItineraryDraft = z.object({
  brandMeta: BrandMeta,
  travelerProfile: z.enum(["corporate", "leisure", "honeymoon", "bleisure"]),
  currency: z.enum(["USD", "COP", "MXN", "EUR"]),
  cityBases: z.array(z.string()),
  days: z.array(ItineraryDay),
});
const QuoteItem = z.object({
  sku: z.string(),
  label: z.string(),
  qty: z.number().int().positive(),
  unitPrice: z.number().nonnegative(),
  subtotal: z.number().nonnegative(),
});
const Line = z.object({ label: z.string(), amount: z.number().nonnegative() });
const Quote = z.object({
  currency: z.enum(["USD", "COP", "MXN", "EUR"]),
  items: z.array(QuoteItem),
  fees: z.array(Line).default([]),
  taxes: z.array(Line).default([]),
  total: z.number().nonnegative(),
  validity: z.string(),
  termsTemplateId: z.enum(["CV-TERMS-STD-01"]),
});

/* ===================== Tools “tool-like” ===================== */
const createItineraryDraft = {
  description: "Crea un borrador de itinerario en formato Coco Volare",
  parameters: z.object({
    travelerProfile: z.enum(["corporate", "leisure", "honeymoon", "bleisure"]),
    cityBases: z.array(z.string()),
    days: z.number().int().min(1).max(31),
    currency: z.enum(["USD", "COP", "MXN", "EUR"]).default("USD"),
    brandMeta: z.object({
      templateId: z.enum(["CV-LUX-01", "CV-CORP-01", "CV-ADVENTURE-01"]),
      accent: z.enum(["gold", "black", "white"]).default("gold"),
      watermark: z.boolean().default(true),
    }),
    preferences: z.record(z.any()).optional(),
  }),
  execute: async (ctx: any) => {
    const { parameters } = ctx ?? {};
    const res = await hubBuildItinerary(parameters);
    const parsed = ItineraryDraft.parse(res.itinerary);
    return { itinerary: parsed };
  },
};

const priceQuote = {
  description: "Genera cotización con motor del hub",
  parameters: z.object({
    destination: z.string(),
    startDate: z.string(),
    endDate: z.string(),
    pax: z.number().int().positive(),
    category: z.enum(["3S", "4S", "5S"]),
    extras: z.array(z.string()).optional(),
    currency: z.enum(["USD", "COP", "MXN", "EUR"]).default("USD"),
  }),
  execute: async (ctx: any) => {
    const { parameters } = ctx ?? {};
    const res = await hubQuote(parameters);
    const parsed = Quote.parse(res.quote);
    return { quote: parsed };
  },
};

const renderBrandDoc = {
  description: "Renderiza documento oficial (HTML/PDF) a partir de JSON",
  parameters: z.object({
    templateId: z.enum([
      "CV-LUX-01",
      "CV-CORP-01",
      "CV-ADVENTURE-01",
      "CV-TERMS-STD-01",
    ]),
    payloadJson: z.any(),
    output: z.enum(["pdf", "html"]).default("html"),
    fileName: z.string().default("Coco-Volare-Propuesta"),
  }),
  execute: async (ctx: any) => {
    const { parameters } = ctx ?? {};
    const res = await hubRender(parameters);
    return res;
  },
};

const sendProposal = {
  description: "Envía la propuesta al cliente (email/WhatsApp)",
  parameters: z.object({
    to: z.string(),
    channel: z.enum(["email", "whatsapp"]),
    docUrl: z.string().url(),
    message: z.string().optional(),
  }),
  execute: async (ctx: any) => {
    const { parameters } = ctx ?? {};
    const res = await hubSend(parameters);
    return res;
  },
};

/* ===================== Modelo del Assistant ===================== */
const ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID!;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;
let cachedAssistantModel: string | null = null;

async function getAssistantModelId(): Promise<string> {
  if (cachedAssistantModel) return cachedAssistantModel;
  try {
    const client = new OpenAI({ apiKey: OPENAI_API_KEY });
    const a = await client.beta.assistants.retrieve(ASSISTANT_ID);
    cachedAssistantModel = a.model || "gpt-4o-mini";
    console.log("CV:/api/chat assistant.model =", cachedAssistantModel);
    return cachedAssistantModel;
  } catch (e: any) {
    console.error("CV:/api/chat assistant retrieve ERROR:", e?.message || e);
    return "gpt-4o-mini";
  }
}

/* ===================== CORS ===================== */
function withCORS(resp: Response) {
  const r = new NextResponse(resp.body, resp);
  r.headers.set("access-control-allow-origin", "*");
  r.headers.set("access-control-allow-headers", "content-type");
  r.headers.set("access-control-allow-methods", "POST,OPTIONS");
  return r;
}
export async function OPTIONS() {
  return withCORS(new Response(null, { status: 204 }));
}

/* ===================== Handler ===================== */
export async function POST(req: NextRequest) {
  const t0 = Date.now();
  console.log("CV:/api/chat POST start");

  try {
    // ---- Parse body flexible
    const body = await req.json().catch(() => ({}));
    let messages = Array.isArray(body?.messages) ? body.messages : [];
    if (messages.length === 0) {
      const text =
        body?.text || body?.message || body?.prompt || body?.content || "";
      if (typeof text === "string" && text.trim()) {
        messages = [{ role: "user", content: String(text).trim() }];
      }
    }
    console.log("CV:/api/chat messages.count =", messages.length);
    if (messages.length === 0) {
      console.error("CV:/api/chat no messages in body");
      return withCORS(
        new Response(JSON.stringify({ error: "no_messages" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        })
      );
    }

    // ---- Lee modelo desde Assistant
    const modelId = await getAssistantModelId().catch(() => "gpt-4o-mini");
    console.log("CV:/api/chat using model =", modelId);

    // ---- Timeout por si el stream se cuelga
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      console.error("CV:/api/chat TIMEOUT 25s – aborting stream");
      controller.abort();
    }, 25_000);

    // ---- 1) STREAM
    let result: any;
    try {
      result = await streamText({
        model: myProvider.languageModel(modelId),
        messages,
        tools: {
          createItineraryDraft: createItineraryDraft as any,
          priceQuote: priceQuote as any,
          renderBrandDoc: renderBrandDoc as any,
          sendProposal: sendProposal as any,
        },
        experimental_telemetry: { isEnabled: true },
        abortSignal: controller.signal as any,
      });
    } catch (e: any) {
      console.error("CV:/api/chat streamText ERROR:", e?.message || e);
    } finally {
      clearTimeout(timeout);
    }

    // ---- ¿Tenemos método para convertir a Response?
    if (result) {
      const toResp =
        result?.toDataStreamResponse || result?.toAIStreamResponse;
      if (typeof toResp === "function") {
        const resp: Response = toResp.call(result);
        console.log(
          "CV:/api/chat stream OK in",
          Date.now() - t0,
          "ms – headers:",
          Object.fromEntries(resp.headers.entries())
        );
        return withCORS(resp);
      }
    }

    // ---- 2) Fallback: intenta obtener texto del resultado
    let textOut = "";
    try {
      if (typeof result?.text === "string") {
        textOut = result.text;
      } else if (result?.text && typeof result.text.then === "function") {
        textOut = await result.text;
      } else if (
        result?.partialResults &&
        typeof result.partialResults[Symbol.asyncIterator] === "function"
      ) {
        const chunks: string[] = [];
        for await (const part of result.partialResults as any) {
          if (typeof part?.text === "string") chunks.push(part.text);
          else if (typeof part?.delta === "string") chunks.push(part.delta);
          else if (typeof part?.textDelta === "string")
            chunks.push(part.textDelta);
        }
        textOut = chunks.join("");
      }
    } catch (e: any) {
      console.error(
        "CV:/api/chat FALLBACK assemble ERROR:",
        e?.message || e
      );
    }

    if (textOut && textOut.trim()) {
      console.warn(
        "CV:/api/chat FALLBACK text returned (len=",
        textOut.length,
        ")"
      );
      return withCORS(
        new Response(textOut, {
          status: 200,
          headers: { "content-type": "text/plain; charset=utf-8" },
        })
      );
    }

    // ---- 3) Último recurso: llamada directa a OpenAI Chat Completions
    try {
      console.warn("CV:/api/chat HARD FALLBACK → OpenAI chat.completions");
      const client = new OpenAI({ apiKey: OPENAI_API_KEY });
      const cc = await client.chat.completions.create({
        model: modelId,
        messages: messages as any,
        temperature: 0.8,
      });
      const finalText =
        cc.choices?.[0]?.message?.content || "[sin contenido de OpenAI]";
      return withCORS(
        new Response(finalText, {
          status: 200,
          headers: { "content-type": "text/plain; charset=utf-8" },
        })
      );
    } catch (e: any) {
      console.error(
        "CV:/api/chat HARD FALLBACK ERROR:",
        e?.message || e
      );
      return withCORS(
        new Response(
          JSON.stringify({ error: "openai_chat_fallback_failed" }),
          { status: 502, headers: { "content-type": "application/json" } }
        )
      );
    }
  } catch (err: any) {
    console.error("CV:/api/chat UNCAUGHT ERROR:", err?.stack || err?.message || err);
    return withCORS(
      new Response(JSON.stringify({ error: String(err?.message || err) }), {
        status: 500,
        headers: { "content-type": "application/json" },
      })
    );
  } finally {
    console.log("CV:/api/chat POST end in", Date.now() - t0, "ms");
  }
}
