/* /app/(chat)/api/chat/route.ts – usa el modelo configurado en el Assistant
 * - Lee assistant.model con el SDK oficial de OpenAI
 * - Usa ese modelId en streamText (no dependemos de selectedChatModel)
 * - Mantiene tus tools hacia el hub
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import OpenAI from "openai";

import { myProvider } from "@/lib/ai/providers";
import {
  hubBuildItinerary,
  hubQuote,
  hubRender,
  hubSend,
} from "@/lib/ai/tools-client";

import { streamText } from "ai";

/* ---------- Zod Schemas (igual) ---------- */
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

/* ---------- Tools “tool-like” ---------- */
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

/* ---------- Leer el modelo del Assistant ---------- */
const ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID!;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;
let cachedAssistantModel: string | null = null;

async function getAssistantModelId(): Promise<string> {
  if (cachedAssistantModel) return cachedAssistantModel;
  try {
    const client = new OpenAI({ apiKey: OPENAI_API_KEY });
    const assistant = await client.beta.assistants.retrieve(ASSISTANT_ID);
    cachedAssistantModel = assistant.model || "gpt-4o-mini";
    return cachedAssistantModel;
  } catch {
    return "gpt-4o-mini";
  }
}

/* ---------- Handler ---------- */
/* ---------- Handler ---------- */
export async function POST(req: NextRequest) {
  try {
    const { messages } = await req.json();

    const modelId = await getAssistantModelId(); // si no usas esto, deja tu selectedChatModel

    const result = await streamText({
      model: myProvider.languageModel(modelId),
      messages,
      tools: {
        createItineraryDraft: createItineraryDraft as any,
        priceQuote: priceQuote as any,
        renderBrandDoc: renderBrandDoc as any,
        sendProposal: sendProposal as any,
      },
      experimental_telemetry: { isEnabled: true },
    });

    // ⬇️ convierte a Response (NECESARIO en Next.js App Router)
    if (typeof (result as any).toDataStreamResponse === "function") {
      return (result as any).toDataStreamResponse();
    }
    if (typeof (result as any).toAIStreamResponse === "function") {
      return (result as any).toAIStreamResponse();
    }

    // Fallback ultra defensivo (no debería usarse)
    const text = await (result as any).text;
    return new Response(text ?? "", {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: String(err?.message || err) }),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }
}

