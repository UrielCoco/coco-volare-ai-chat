// lib/block-parser.ts
export type ParsedBlocks = {
  text: string;                        // mensaje sin los fences
  itineraries: any[];                  // payloads cv:itinerary (o json fallback)
  quotes: any[];                       // si usas cv:quote
  kommoOps: any[];                     // lista de ops si venían en cv:kommo
  fenceTypes: string[];                // para diag
};

const FENCE_RE = /```cv:(itinerary|quote|kommo)\s*([\s\S]*?)```/gi;
const JSON_FENCE_RE = /```json\s*([\s\S]*?)```/gi;

export function parseAssistantMessage(raw: string): ParsedBlocks {
  let text = raw || '';
  const itineraries:any[] = [];
  const quotes:any[] = [];
  const kommoOps:any[] = [];
  const fenceTypes:string[] = [];

  // 1) Fences cv:* (camino feliz)
  text = text.replace(FENCE_RE, (_m, kind: string, body: string) => {
    fenceTypes.push(kind);
    try {
      const obj = JSON.parse(body.trim());
      if (kind === 'itinerary') itineraries.push(obj);
      else if (kind === 'quote') quotes.push(obj);
      else if (kind === 'kommo') {
        if (Array.isArray(obj?.ops)) kommoOps.push(...obj.ops);
      }
    } catch {/* ignore */}
    return ''; // lo ocultamos del texto
  });

  // 2) Fallback: ```json ...``` con forma de itinerario
  //    (solo si no hubo cv:itinerary)
  if (itineraries.length === 0) {
    text = text.replace(JSON_FENCE_RE, (_m, body: string) => {
      try {
        const obj = JSON.parse(body.trim());
        const looksLikeIt =
          obj && typeof obj === 'object' &&
          (obj.cardType === 'itinerary' || (obj.tripTitle && obj.summary && Array.isArray(obj.days)));
        if (looksLikeIt) {
          itineraries.push(obj);
          fenceTypes.push('itinerary(fallback)');
          return '';
        }
      } catch {/* ignore */}
      return _m; // dejamos el code block si no parece itinerario
    });
  }

  return { text: text.trim(), itineraries, quotes, kommoOps, fenceTypes };
}
