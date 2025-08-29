// lib/block-parser.ts
export type Block =
  | { kind: 'itinerary'; json: any; raw: string }
  | { kind: 'quote'; json: any; raw: string }
  | { kind: 'kommo'; json: { ops: Array<any> }; raw: string };

const RE = /```cv:(itinerary|quote|kommo)\s*([\s\S]*?)```/gi;

export function extractBlocks(text: string) {
  const blocks: Block[] = [];
  let clean = text;
  let m: RegExpExecArray | null;
  while ((m = RE.exec(text))) {
    const kind = m[1].toLowerCase();
    const raw = m[0];
    let json: any = null;
    try { json = JSON.parse(m[2].trim()); } catch { json = null; }
    if (json) {
      if (kind === 'itinerary') blocks.push({ kind: 'itinerary', json, raw });
      if (kind === 'quote') blocks.push({ kind: 'quote', json, raw });
      if (kind === 'kommo') blocks.push({ kind: 'kommo', json, raw });
    }
  }
  // Remueve SOLO cv:kommo (oculto). Deja itinerary/quote visibles para el UI.
  clean = clean.replace(/```cv:kommo[\s\S]*?```/gi, '').trim();
  return { clean, blocks };
}
