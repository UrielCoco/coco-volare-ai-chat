// lib/diag/fences.ts
import crypto from "crypto";

export type Fence = {
  type: string;        // p.ej. "itinerary"
  raw: string;         // bloque dentro del fence
  json?: any;          // si es JSON válido
  hash: string;        // md5 del raw normalizado
  validJson: boolean;
};

const fenceRegex = /```([a-zA-Z0-9_-]*)(?:\s+[\w-]+)?\s*\n([\s\S]*?)\n```/g;

export function extractFences(text: string): Fence[] {
  const out: Fence[] = [];
  let m: RegExpExecArray | null;
  while ((m = fenceRegex.exec(text)) !== null) {
    const lang = (m[1] || "").trim().toLowerCase();
    const body = (m[2] || "").trim();
    const hash = crypto.createHash("md5").update(body).digest("hex").slice(0, 8);
    let json: any = undefined;
    let validJson = false;
    if (lang === "json" || lang === "itinerary") {
      try {
        json = JSON.parse(body);
        validJson = true;
      } catch (_) {}
    }
    // soporta fences estilo ```itinerary {json}
    if (!validJson && lang === "itinerary") {
      try {
        json = JSON.parse(body);
        validJson = true;
      } catch (_) {}
    }
    out.push({ type: lang || "code", raw: body, json, hash, validJson });
  }
  return out;
}

export function pickBestItinerary(fences: Fence[]) {
  const itins = fences.filter(f => f.type.includes("itinerary") && f.validJson);
  if (itins.length === 0) return null;
  // de-dup por hash y quedarnos con el más largo
  const byHash = new Map<string, Fence>();
  for (const f of itins) {
    const prev = byHash.get(f.hash);
    if (!prev || f.raw.length > prev.raw.length) byHash.set(f.hash, f);
  }
  // escoge el de mayor tamaño (o más days)
  let best: Fence | null = null;
  for (const f of byHash.values()) {
    if (!best) { best = f; continue; }
    const lenA = (f.json?.days?.length ?? 0);
    const lenB = (best.json?.days?.length ?? 0);
    if (lenA > lenB) best = f;
    else if (lenA === lenB && f.raw.length > best.raw.length) best = f;
  }
  return best;
}
