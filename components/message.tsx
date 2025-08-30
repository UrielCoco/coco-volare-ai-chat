'use client';

import React from 'react';
import ItineraryCard from './ItineraryCard';

// Acepta tu ChatMessage, pero sin exigir el shape exacto de parts.
// Así evitamos incompatibilidades con UIMessagePart / UITextPart, etc.
type AnyMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  parts?: any[];
};

function extractTextFromParts(parts?: any[]): string {
  if (!Array.isArray(parts)) return '';
  // Busca un part tipo texto en estructuras comunes
  for (const p of parts) {
    // casos típicos: { type:'text', text: '...' }
    if (p?.type === 'text' && typeof p?.text === 'string') return p.text;
    // algunos kits: { type:'outputText', text:'...' }
    if ((p?.type === 'outputText' || p?.type === 'uiText') && typeof p?.text === 'string') return p.text;
    // OpenAI SDK (a veces): { type:'output_text', content:{ text: '...' } }
    if (p?.type === 'output_text' && typeof p?.content?.text === 'string') return p.content.text;
    // fallback: primera string que encontremos
    if (typeof p === 'string') return p;
  }
  return '';
}

function extractItineraryBlock(raw: string) {
  // Captura ```cv:itinerary ... ``` tolerante a espacios/formatos
  const re = /```(?:\s*)cv:itinerary\s*([\s\S]*?)```/i;
  const m = re.exec(raw);
  if (!m) return null;
  const body = m[1]?.trim() ?? '';
  // Intenta parsear; si viene sin cerrar, corta hasta el último }
  try { return JSON.parse(body); } catch {}
  const lastBrace = body.lastIndexOf('}');
  if (lastBrace > 0) {
    try { return JSON.parse(body.slice(0, lastBrace + 1)); } catch {}
  }
  return null;
}

export function PreviewMessage({ message }: { message: AnyMessage }) {
  const text = extractTextFromParts(message?.parts) ?? '';

  if (message.role === 'assistant') {
    const itin = extractItineraryBlock(text);
    if (itin) {
      return (
        <div className="w-full max-w-4xl mx-auto">
          <ItineraryCard data={itin} />
        </div>
      );
    }
  }

  // Burbuja por defecto (negra asistente / dorada usuario)
  const isUser = message.role === 'user';
  return (
    <div className={`w-full max-w-4xl mx-auto ${isUser ? 'text-black' : 'text-white'}`}>
      <div
        className={`inline-block rounded-2xl px-4 py-3 shadow
          ${isUser ? 'bg-[#bba36d] text-black' : 'bg-[#111111] text-white'}`}
      >
        <div className="prose prose-invert max-w-none whitespace-pre-wrap">
          {text}
        </div>
      </div>
    </div>
  );
}
