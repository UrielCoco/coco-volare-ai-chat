export type UIMessageText = { value: string };

export type UIMessagePart =
  | { type: 'text'; text: UIMessageText }
  | { type: 'tool-call'; name: string; args?: any }
  | { type: 'attachment'; url?: string; mimeType?: string };

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: UIMessagePart[];
  createdAt?: string;
};
