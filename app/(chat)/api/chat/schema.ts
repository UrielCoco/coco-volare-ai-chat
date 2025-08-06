import { z } from 'zod';

// Parte como objeto de texto
const textPartSchema = z.object({
  type: z.literal('text'),
  text: z.string().min(1).max(2000),
});

// Parte como archivo (imagen)
const filePartSchema = z.object({
  type: z.literal('file'),
  mediaType: z.enum(['image/jpeg', 'image/png']),
  name: z.string().min(1).max(100),
  url: z.string().url(),
});

// Parte como string plano o como objeto
const partSchema = z.union([
  z.string().min(1).max(2000), // 👈 añadimos soporte para string plano
  textPartSchema,
  filePartSchema,
]);

export const postRequestBodySchema = z.object({
  id: z.string().uuid(),
  message: z.object({
    id: z.string().uuid(),
    role: z.literal('user'),
    parts: z.array(partSchema),
  }),
  selectedChatModel: z.enum(['chat-model', 'chat-model-reasoning', 'assistant-openai']), // 👈 añadimos 'assistant-openai'
  selectedVisibilityType: z.enum(['public', 'private']),
});

export type PostRequestBody = z.infer<typeof postRequestBodySchema>;