import { openai } from '@ai-sdk/openai';
import { customProvider, wrapLanguageModel } from 'ai';

// Usa gpt-3.5-turbo como fallback (hasta que tengas acceso a GPT-4)
const fallbackModel = 'gpt-3.5-turbo';

export const myProvider = customProvider({
  languageModels: {
    'chat-model': openai(fallbackModel),
    'chat-model-reasoning': wrapLanguageModel({
      model: openai(fallbackModel),
    }),
    'title-model': openai(fallbackModel),
    'artifact-model': openai(fallbackModel),
  },
});