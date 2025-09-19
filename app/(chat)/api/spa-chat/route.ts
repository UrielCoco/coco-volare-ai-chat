// app/(chat)/api/spa-chat/route.ts
import { NextRequest, NextResponse } from 'next/server';

type Role = 'user' | 'assistant' | 'system';
export type ChatMessage = { role: Role; content: string };

type SendSpaChatRequest = {
  messages: ChatMessage[];
};

type AssistantEvent =
  | { event: 'assistant'; payload: { content: string } }
  | { event: 'itinerary'; payload: { partial: Record<string, unknown> } };

type SpaChatResponse = {
  ok: true;
  events: AssistantEvent[];
  usage?: unknown;
};

type SpaChatError = { ok: false; error: string };

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
// Modelo ligero y económico; puedes cambiar a gpt-4o, gpt-4.1-mini, etc.
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const API_KEY = process.env.OPENAI_API_KEY!;

if (!API_KEY) {
  // Lanzamos al boot para que sea visible en Vercel
  console.error('[spa-chat] Falta OPENAI_API_KEY');
}

const SYSTEM_PROMPT = `Eres el "Assistant" de un generador de itinerarios.
Reglas IMPORTANTES:
- Nunca escribas texto "directamente"; en su lugar, llama a la herramienta "assistant_say" para decirle algo al usuario.
- Cuando necesites actualizar el itinerario, llama a "upsert_itinerary" con un JSON *parcial* (diff) del esquema del itinerario.
- Haz múltiples pasos si lo ves útil: por ejemplo, primero saluda (assistant_say), luego envía upserts de meta/summary/days/transports/etc, después otro assistant_say de cierre, etc.
- El itinerario tiene esta estructura base:
{
  "meta": { "tripTitle": string },
  "summary": { ...libre... },
  "flights": [],
  "days": [],
  "transports": [],
  "extras": [],
  "lights": {}
}
- Tu misión: armar un itinerario de lujo/boutique, ritmo moderado, sin mariscos, con experiencias privadas; incluir siempre en Capadocia: paseo en globo al amanecer, hamam tradicional, y recomendación de cena rooftop en Estambul con vista. Si faltan datos, asume y decláralo en el itinerario (usa assistant_say para explicarlo al usuario).
- No devuelvas texto crudo. SOLO usa tools.
`;

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'assistant_say',
      description:
        'Envía un mensaje visible al usuario. Usar para conversar de forma fluida.',
      parameters: {
        type: 'object',
        properties: {
          content: {
            type: 'string',
            description: 'Mensaje breve y claro para el usuario',
          },
        },
        required: ['content'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'upsert_itinerary',
      description:
        'Aplica un diff parcial del itinerario. Solo envía claves que deseas modificar.',
      parameters: {
        type: 'object',
        properties: {
          partial: {
            type: 'object',
            description:
              'Objeto JSON parcial con los cambios a aplicar en el itinerario.',
            additionalProperties: true,
          },
        },
        required: ['partial'],
        additionalProperties: false,
      },
    },
  },
];

type ToolCall = {
  id: string;
  type: 'function';
  function: { name: 'assistant_say' | 'upsert_itinerary'; arguments: string };
};

// Utilidad: POST a OpenAI Chat
async function chatOnce(messages: { role: Role; content: string }[], toolResults?: any[]) {
  const body: any = {
    model: MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ],
    tools: TOOLS,
    tool_choice: 'auto',
    temperature: 0.3,
  };

  if (toolResults?.length) {
    body.tool_choice = 'auto';
    body.parallel_tool_calls = true;
  }

  const res = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`OpenAI error ${res.status}: ${txt}`);
  }

  const json = await res.json();
  return json;
}

export async function POST(req: NextRequest) {
  const started = Date.now();
  try {
    const body = (await req.json()) as SendSpaChatRequest;
    const { messages } = body;

    // Validación mínima
    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json(
        { ok: false, error: 'messages[] requerido' } as SpaChatError,
        { status: 400 },
      );
    }

    console.log('[spa-chat] >>> IN', JSON.stringify(messages, null, 2));

    let events: AssistantEvent[] = [];
    // Conversación incremental: iteramos tool-calls hasta terminar
    // Límite de pasos para evitar loops
    const MAX_STEPS = 8;

    // Mensajes que enviaremos progresivamente a OpenAI,
    // incluyendo tool-calls "resueltas"
    const runningMessages: ChatMessage[] = [...messages];

    for (let step = 0; step < MAX_STEPS; step++) {
      const out = await chatOnce(runningMessages);

      const choice = out.choices?.[0];
      const finish = choice?.finish_reason as string | undefined;
      const contentText: string | undefined = choice?.message?.content ?? undefined;
      const toolCalls: ToolCall[] | undefined = choice?.message?.tool_calls;

      // Log útil en Vercel
      console.log('[spa-chat] step', step, {
        finish_reason: finish,
        tool_calls_count: toolCalls?.length ?? 0,
        content_preview: contentText?.slice(0, 80),
      });

      if (toolCalls?.length) {
        // Procesamos tool-calls
        for (const tc of toolCalls) {
          const name = tc.function.name;
          const argsRaw = tc.function.arguments || '{}';

          try {
            const args = JSON.parse(argsRaw);

            if (name === 'assistant_say') {
              const txt: string = String(args.content ?? '').trim();
              if (txt) {
                events.push({ event: 'assistant', payload: { content: txt } });
                // añadimos "respuesta de la herramienta" al historial
                runningMessages.push({
                  role: 'tool',
                  content: JSON.stringify({ ok: true, echo: 'assistant_say', content: txt }),
                } as any);
              } else {
                runningMessages.push({
                  role: 'tool',
                  content: JSON.stringify({ ok: false, error: 'assistant_say sin content' }),
                } as any);
              }
            }

            if (name === 'upsert_itinerary') {
              const partial = args.partial ?? {};
              events.push({ event: 'itinerary', payload: { partial } });
              runningMessages.push({
                role: 'tool',
                content: JSON.stringify({ ok: true, echo: 'upsert_itinerary', applied: true }),
              } as any);
            }
          } catch (e: any) {
            console.error('[spa-chat] tool args parse error', e);
            runningMessages.push({
              role: 'tool',
              content: JSON.stringify({ ok: false, error: 'invalid_tool_arguments' }),
            } as any);
          }
        }

        // Después de tool-calls, seguimos iterando
        continue;
      }

      // Si el modelo intentó hablar directo, lo movemos a herramienta assistant_say
      if (contentText && contentText.trim()) {
        events.push({ event: 'assistant', payload: { content: contentText.trim() } });
      }

      // Si OpenAI indica que ya terminó, cortamos
      if (finish && finish !== 'tool_calls') break;
      // Si no hubo tool calls y no hay texto, también terminamos
      if (!toolCalls?.length && !contentText) break;

      // Prevención de loop infinito
      if (step === MAX_STEPS - 1) {
        events.push({
          event: 'assistant',
          payload: {
            content:
              'He llegado al límite de pasos internos. Si deseas que continúe, escribe “continúa”.',
          },
        });
      }
    }

    console.log('[spa-chat] <<< OUT events', JSON.stringify(events, null, 2), 'took', Date.now() - started, 'ms');

    const payload: SpaChatResponse = { ok: true, events };
    return NextResponse.json(payload);
  } catch (err: any) {
    console.error('[spa-chat] ERROR', err?.message || err);
    const payload: SpaChatError = { ok: false, error: err?.message || 'unknown_error' };
    return NextResponse.json(payload, { status: 500 });
  }
}
