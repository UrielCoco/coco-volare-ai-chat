/* /app/(chat)/api/chat/route.ts – Versión sin `tool()` (compila en ai@5.0.0-beta.6)
 * - Prompt vive en consola del Assistant (no importamos nada).
 * - Tools como objetos simples; sin sobrecargas de tipos.
 * - Valida respuestas del hub con Zod.
 */

import { NextRequest } from "next/server";
import { z } from "zod";

// Ajusta esta ruta a TU provider real:
import { myProvider } from "@/lib/ai/providers";

// Clientes HTTP hacia tu Hub (Pages Router)
import {
  hubBuildItinerary,
  hubQuote,
  hubRender,
  hubSend,
} from "@/lib/ai/tools-client";

// AI SDK (SOLO streamText)
import { streamText } from "ai";

/* ---------- Zod Schemas ---------- */
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

/* ---------- Tools “tool-like” (sin factory) ---------- */
/* Definimos objetos planos con { description, parameters, execute }.
   Tipamos execute con `any` para evitar el bug de d.ts que te arrojaba (parameters: never).
*/

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
  // 👇 ctx: any para esquivar el problema de “never/undefined”
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
    return res; // { url, html? }
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
    return res; // { ok: true }
  },
};

/* ---------- Handler ---------- */
export async function POST(req: NextRequest) {
  const { messages, selectedChatModel } = await req.json();

  return streamText({
    model: myProvider.languageModel(selectedChatModel),
    // El system prompt vive en la consola del Assistant
    messages,
    // Tip-off: si TS insiste, castea a any en el “tools”
    tools: {
      createItineraryDraft: createItineraryDraft as any,
      priceQuote: priceQuote as any,
      renderBrandDoc: renderBrandDoc as any,
      sendProposal: sendProposal as any,
    },
    experimental_telemetry: { isEnabled: true },
  });
}
