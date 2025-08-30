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

/** Extrae el primer objeto JSON balanceando llaves desde un índice dado */
function extractFirstJsonObject(s: string, startIdx: number): any | null {
  const i0 = s.indexOf('{', startIdx);
  if (i0 < 0) return null;
  let depth = 0;
  for (let i = i0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        const raw = s.slice(i0, i + 1);
        try { return JSON.parse(raw); } catch { return null; }
      }
    }
  }
  return null;
}

function extractItineraryBlock(raw: string) {
  // Busca el marcador cv:itinerary y luego intenta extraer el primer JSON balanceado
  const mark = raw.search(/```[\s]*cv:itinerary/i);
  if (mark < 0) return null;

  // 1) Intenta el camino simple con regex de fence completo
  const fence = /```(?:\s*)cv:itinerary\s*([\s\S]*?)```/i.exec(raw);
  if (fence?.[1]) {
    const body = fence[1].trim();
    try {
      const j = JSON.parse(body);
      return j;
    } catch {
      // si no parsea, prueba hasta el último }
      const lastBrace = body.lastIndexOf('}');
      if (lastBrace > 0) {
        try { return JSON.parse(body.slice(0, lastBrace + 1)); } catch {}
      }
    }
  }

  // 2) Si el fence no está bien cerrado, balancea llaves desde el primer "{"
  const j2 = extractFirstJsonObject(raw, mark);
  return j2;
}

export function PreviewMessage({ message }: { message: AnyMessage }) {
  const text = extractTextFromParts(message?.parts) ?? '';
  const isUser = message.role === 'user';

  // Evita "burbujas negras" de placeholder vacío
  if (!isUser && (!text || !text.trim())) {
    return null;
  }

  // Si es del assistant y viene un bloque cv:itinerary válido → tarjeta
  if (!isUser) {
    const itin = extractItineraryBlock(text);
    if (itin && typeof itin === 'object' && Array.isArray((itin as any).days)) {
      return (
        <div className={`w-full max-w-4xl mx-auto flex justify-start`}>
          <div className="w-full">
            <ItineraryCard data={itin as any} />
          </div>
        </div>
      );
    }
  }

  // Burbuja normal (negra asistente / dorada usuario)
  const align = isUser ? 'justify-end' : 'justify-start';
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
