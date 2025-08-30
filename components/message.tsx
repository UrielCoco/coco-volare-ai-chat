'use client';

import React from 'react';
import ItineraryCard from './ItineraryCard';

type AnyMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  parts?: any[];
};

function extractTextFromParts(parts?: any[]): string {
  if (!Array.isArray(parts)) return '';
  for (const p of parts) {
    if (p?.type === 'text' && typeof p?.text === 'string') return p.text;
    if ((p?.type === 'outputText' || p?.type === 'uiText') && typeof p?.text === 'string') return p.text;
    if (p?.type === 'output_text' && typeof p?.content?.text === 'string') return p.content.text;
    if (typeof p === 'string') return p;
  }
  return '';
}

function extractItineraryBlock(raw: string) {
  const re = /```(?:\s*)cv:itinerary\s*([\s\S]*?)```/i;
  const m = re.exec(raw);
  if (!m) return null;
  const body = m[1]?.trim() ?? '';
  try { return JSON.parse(body); } catch {}
  const lastBrace = body.lastIndexOf('}');
  if (lastBrace > 0) {
    try { return JSON.parse(body.slice(0, lastBrace + 1)); } catch {}
  }
  return null;
}

export function PreviewMessage({ message }: { message: AnyMessage }) {
  const text = extractTextFromParts(message?.parts) ?? '';
  const isUser = message.role === 'user';
  const align = isUser ? 'justify-end' : 'justify-start';

  // Si es del assistant y viene el bloque, pinta tarjeta
  if (!isUser) {
    const itin = extractItineraryBlock(text);
    if (itin) {
      return (
        <div className={`w-full max-w-4xl mx-auto flex ${align}`}>
          <div className="w-full">
            <ItineraryCard data={itin} />
          </div>
        </div>
      );
    }
  }

  // Burbuja normal
  return (
    <div className={`w-full max-w-4xl mx-auto flex ${align}`}>
      <div
        className={`inline-block rounded-2xl px-4 py-3 shadow
          ${isUser ? 'bg-[#bba36d] text-black' : 'bg-[#111111] text-white'}`}
      >
        <div className={`prose ${isUser ? '' : 'prose-invert'} max-w-none whitespace-pre-wrap`}>
          {text}
        </div>
      </div>
    </div>
  );
}
