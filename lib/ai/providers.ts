import { openai } from '@ai-sdk/openai';
import { customProvider, wrapLanguageModel } from 'ai';

export const myProvider = customProvider({
  languageModels: {
    'chat-model': openai('gpt-4'),
    'chat-model-reasoning': wrapLanguageModel({
      model: openai('gpt-4'),
    }),
    'title-model': openai('gpt-4'),
    'artifact-model': openai('gpt-4'),
  },
});
