// lib/ai/tools/emitItinerary.ts
import { z } from 'zod';

export const itinerarySchema = z.object({
  title: z.string(),
  days: z.array(z.object({
    day: z.number().int().min(1),
    date: z.string().optional(),
    meals: z.object({
      breakfast: z.string(),
      lunch: z.string(),
      dinner: z.string(),
    }).optional(),
    activities: z.array(z.object({
      time: z.string(),
      title: z.string(),
      location: z.string().optional(),
      notes: z.string().optional(),
    })),
    hotelPickup: z.boolean().optional().default(true),
    hotelDropoff: z.boolean().optional().default(true),
  })),
  currency: z.string().optional().default('COP'),
  notes: z.string().optional(),
});
