// lib/ai/providers.ts
// Provider simple: acepta cualquier modelo de OpenAI por id (gpt-4o, gpt-4o-mini, gpt-4.1, etc.)
import { openai } from "@ai-sdk/openai";

export const myProvider = {
  languageModel: (modelId: string) => {
    return openai(modelId as any); // si el id no existe, fallará en runtime (lo capturamos en route)
  },
};
