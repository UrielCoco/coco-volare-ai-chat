// lib/ai/providers.ts
// Provider simple que acepta cualquier modelo OpenAI por id (gpt-4o, gpt-4o-mini, gpt-4.1, etc.)

import { openai } from "@ai-sdk/openai";

export const myProvider = {
  languageModel: (modelId: string) => {
    // Pasamos el id tal cual al provider de OpenAI.
    // Si el id no existe en tu cuenta, fallará en runtime (no aquí).
    return openai(modelId as any);
  },
};
