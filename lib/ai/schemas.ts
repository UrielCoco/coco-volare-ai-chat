import { z } from "zod";

export const BrandMeta = z.object({
  templateId: z.enum(["CV-LUX-01","CV-CORP-01","CV-ADVENTURE-01"]),
  accent: z.enum(["gold","black","white"]).default("gold"),
  watermark: z.boolean().default(true),
});

export const Activity = z.object({
  timeRange: z.string().optional(),
  title: z.string(),
  description: z.string(),
  logistics: z.string().optional(),
  icon: z.string().optional(),
});

export const ItineraryDay = z.object({
  dayNumber: z.number(),
  title: z.string(),
  date: z.string().optional(),
  breakfastIncluded: z.boolean().default(true),
  activities: z.array(Activity),
  notes: z.string().optional(),
});

export const ItineraryDraft = z.object({
  brandMeta: BrandMeta,
  travelerProfile: z.enum(["corporate","leisure","honeymoon","bleisure"]),
  currency: z.enum(["USD","COP","MXN","EUR"]),
  cityBases: z.array(z.string()),
  days: z.array(ItineraryDay),
});

export const QuoteItem = z.object({
  sku: z.string(),
  label: z.string(),
  qty: z.number().int().positive(),
  unitPrice: z.number().nonnegative(),
  subtotal: z.number().nonnegative(),
});

export const Line = z.object({ label: z.string(), amount: z.number().nonnegative() });

export const Quote = z.object({
  currency: z.enum(["USD","COP","MXN","EUR"]),
  items: z.array(QuoteItem),
  fees: z.array(Line).default([]),
  taxes: z.array(Line).default([]),
  total: z.number().nonnegative(),
  validity: z.string(),
  termsTemplateId: z.enum(["CV-TERMS-STD-01"]),
});

export type ItineraryDraftT = z.infer<typeof ItineraryDraft>;
export type QuoteT = z.infer<typeof Quote>;
