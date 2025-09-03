// lib/block-parser.ts
export type Block =
  | { kind: "itinerary"; json: any; raw: string }
  | { kind: "quote"; json: any; raw: string }
  | { kind: "kommo"; json: { ops: Array<any> }; raw: string };

const RE = /```cv:(itinerary|quote|kommo)\s*([\s\S]*?)```/gi;

/**
 * Extrae bloques cv:* y regresa:
 * - clean: texto sin los bloques ocultos (cv:kommo). Itinerary/quote se conservan en 'blocks' para que el front los renderice como cards.
 * - blocks: arreglo con los bloques parseados (JSON).
 */
export function extractBlocks(text: string) {
  const blocks: Block[] = [];
  let clean = text ?? "";
  let m: RegExpExecArray | null;

  while ((m = RE.exec(text))) {
    const kind = m[1].toLowerCase();
    const raw = m[0];
    let json: any = null;
    try {
      json = JSON.parse(m[2].trim());
    } catch (e) {
      // JSON malformado: lo ignoramos como bloque pero no reventamos el render
      console.warn("[CV][block-parser] JSON inválido en", kind, e);
      continue;
    }
    if (kind === "itinerary") blocks.push({ kind: "itinerary", json, raw });
    if (kind === "quote") blocks.push({ kind: "quote", json, raw });
    if (kind === "kommo") blocks.push({ kind: "kommo", json, raw });
  }

  // Oculta SOLO los cv:kommo (nunca mostrar al cliente)
  clean = clean.replace(/```cv:kommo[\s\S]*?```/gi, "").trim();

  return { clean, blocks };
}
