// lib/streamChat.ts
// Cliente SSE robusto: soporta event:delta y event:final, deduplica,
// y permite extraer JSON embebido al final del texto del assistant.

export type StreamBlocks = Array<{ type: string; json: any }>;

export type FinalPayload = {
  text: string;
  blocks?: StreamBlocks;
};

export type StreamHandlers = {
  onStartDraft?: () => void;
  onTextDelta?: (chunk: string) => void;
  onFinal?: (args: {
    text: string;
    blocks: StreamBlocks;
    extractedJson: any | null;
  }) => void;
  onError?: (err: unknown) => void;
  onDone?: () => void;
};

export type StreamParams = {
  endpoint: string; // p.ej. "/api/chat?threadId=..."
  body: any;        // { message, threadId }
  handlers: StreamHandlers;
};

function safeJsonParse<T = any>(s: string): T | null {
  try { return JSON.parse(s); } catch { return null; }
}

/**
 * Extrae JSON si viene embebido al final del texto del assistant.
 * Soporta:
 *  - ```json ... ```
 *  - ``` ... ```
 *  - Texto seguido de { ... } o [ ... ]
 */
export function extractTrailingJson(raw: string): { text: string; json: any | null } {
  if (!raw) return { text: '', json: null };

  // 1) Codefence ```json ... ```
  const fenceStart = raw.lastIndexOf('```');
  if (fenceStart !== -1) {
    const fence = raw.slice(fenceStart).trim();
    if (fence.startsWith('```')) {
      const inner = fence.replace(/^```json|^```/i, '').replace(/```$/, '').trim();
      const parsed = safeJsonParse(inner);
      if (parsed && fenceStart > 0) {
        return { text: raw.slice(0, fenceStart).trimEnd(), json: parsed };
      }
    }
  }

  // 2) Objeto/array al final (busca última { o [ y prueba parseo)
  const lastBrace = Math.max(raw.lastIndexOf('{'), raw.lastIndexOf('['));
  if (lastBrace !== -1) {
    const maybeJson = raw.slice(lastBrace).trim();
    const parsed = safeJsonParse(maybeJson);
    if (parsed && lastBrace > 0) {
      const before = raw.slice(0, lastBrace).trimEnd();
      // Heurística extra: evita “cortar” si el texto es casi vacío
      if (before.length >= 3) return { text: before, json: parsed };
    }
  }

  return { text: raw, json: null };
}

/** Parser muy simple de eventos SSE */
function forEachSSEChunk(
  buf: string,
  cb: (evt: string, data: string) => void
): string {
  let rest = buf;
  let idx: number;
  while ((idx = rest.indexOf('\n\n')) !== -1) {
    const chunk = rest.slice(0, idx);
    rest = rest.slice(idx + 2);

    let event = 'message';
    let data = '';
    for (const line of chunk.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      if (line.startsWith('data:'))  data += line.slice(5);
    }
    if (data) cb(event, data);
  }
  return rest; // lo que quede incompleto
}

/** Stream principal */
export async function streamChat({ endpoint, body, handlers }: StreamParams) {
  const { onStartDraft, onTextDelta, onFinal, onError, onDone } = handlers;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.body) {
    onError?.(new Error('No response body'));
    onDone?.();
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();

  let buf = '';
  let hasFinal = false;
  let draftStarted = false;
  let lastDelta = ''; // para deduplicar chunks idénticos consecutivos
  let collectedText = ''; // si solo llegan deltas

  const ensureDraft = () => {
    if (!draftStarted) { onStartDraft?.(); draftStarted = true; }
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buf += decoder.decode(value, { stream: true });

      buf = forEachSSEChunk(buf, (event, data) => {
        if (event === 'hb' || event === 'meta') return;

        if (event === 'error') {
          onError?.(safeJsonParse(data) ?? data);
          return;
        }

        if (event === 'delta') {
          const payload = safeJsonParse<{ text?: string }>(data);
          const chunk = payload?.text ?? '';
          if (chunk && chunk !== lastDelta) {
            lastDelta = chunk;
            ensureDraft();
            collectedText += chunk;
            onTextDelta?.(chunk);
          }
          return;
        }

        if (event === 'final') {
          const payload = safeJsonParse<FinalPayload>(data) ?? { text: '' };
          const text = payload.text ?? '';
          const blocks = payload.blocks ?? [];
          const { text: cleaned, json } = extractTrailingJson(text);
          hasFinal = true;
          onFinal?.({ text: cleaned, blocks, extractedJson: json });
          return;
        }

        // fallback “message”
        const payload = safeJsonParse<{ text?: string }>(data);
        if (payload?.text) {
          const { text: cleaned, json } = extractTrailingJson(payload.text);
          hasFinal = true;
          onFinal?.({ text: cleaned, blocks: [], extractedJson: json });
        }
      });
    }

    // Si no hubo final pero sí deltas, entregamos lo acumulado
    if (!hasFinal && collectedText) {
      const { text: cleaned, json } = extractTrailingJson(collectedText);
      onFinal?.({ text: cleaned, blocks: [], extractedJson: json });
    }
  } catch (e) {
    onError?.(e);
  } finally {
    onDone?.();
  }
}
