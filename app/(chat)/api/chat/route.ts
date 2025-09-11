// app/(chat)/api/chat/route.ts
import OpenAI from "openai";

export const runtime = "edge"; // quítalo si prefieres Node runtime

// --- CORS básico (ajústalo si quieres restringir) ---
const ALLOW_ORIGIN = process.env.NEXT_PUBLIC_FRONTEND_ORIGIN ?? "*";
const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": ALLOW_ORIGIN,
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Credentials": "true",
  Vary: "Origin",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

type UIMessage = { role: "user" | "assistant" | "system"; content: string };

// Arma un bloque SSE
function sseChunk(event: string, data: any) {
  return `event: ${event}\n` + `data: ${JSON.stringify(data)}\n\n`;
}

export async function POST(req: Request) {
  try {
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    // 1) Normaliza el input del cliente
    let msgs: UIMessage[] | undefined = body?.messages;
    if (!Array.isArray(msgs)) {
      // Acepta también formatos alternos
      const single: unknown =
        body?.message ?? body?.input ?? body?.prompt ?? body?.text ?? null;
      if (typeof single === "string" && single.trim()) {
        msgs = [{ role: "user", content: single.trim() }];
      }
    }

    if (!Array.isArray(msgs) || msgs.length === 0) {
      return new Response(
        JSON.stringify({
          error:
            "Bad Request: expected { messages: Array<{role, content}> } or a string field like 'message'/'input'/'prompt'.",
        }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // 2) Responses API usa "input_text" (no "text")
    const input = msgs.map((m) => ({
      role: m.role,
      content: [{ type: "input_text" as const, text: String(m.content ?? "") }],
    }));

    // 3) Define la tool (sin tipos del SDK para evitar broncas de TS)
    const tools = [
      {
        type: "function",
        function: {
          name: "upsert_itinerary",
          description:
            "Actualiza (merge) el itinerario de la UI con un objeto parcial. Nunca borres campos existentes.",
          parameters: {
            type: "object",
            additionalProperties: true,
            properties: {
              partial: {
                type: "object",
                description:
                  "Partial<Itinerary> con meta/summary/flights/days/transports/extras/labels",
                additionalProperties: true,
              },
            },
            required: ["partial"],
          },
        },
      },
    ] as any;

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

    // 4) Crea el stream de Responses API
    const stream = await openai.responses.stream({
      model: "gpt-4.1-mini", // cambia si prefieres otro
      input,
      tools,
      tool_choice: "auto",
      stream: true,
      system:
        "Eres Coco Volare Intelligence. Cuando el usuario comparta detalles de viaje, " +
        "SIEMPRE llama a upsert_itinerary con { partial: ... } (meta/summary/flights/days/etc). " +
        "Además responde con un texto breve y útil. Nunca borres datos existentes; solo envía parciales.",
    });

    const encoder = new TextEncoder();

    // 5) Reemite los eventos que tu front ya mapea
    const rs = new ReadableStream({
      async start(controller) {
        const send = (event: string, data: any) =>
          controller.enqueue(encoder.encode(sseChunk(event, data)));

        try {
          for await (const ev of stream as any) {
            const type = ev?.type as string;

            if (type === "response.created") {
              send("meta", { threadId: ev.response?.id });
              continue;
            }

            // Texto en vivo
            if (type === "response.output_text.delta" || type === "response.refusal.delta") {
              send("delta", { value: ev.delta }); // tu hook acepta { value }
              continue;
            }

            // Tool-call argumentos en streaming
            if (type === "response.function_call.arguments.delta") {
              send("tool_call.arguments.delta", {
                id: ev.item?.id,
                name: ev.item?.name,
                arguments: { delta: ev.delta },
              });
              continue;
            }

            // Tool-call completado (args cerrados)
            if (type === "response.function_call.completed") {
              send("tool_call.completed", {
                id: ev.item?.id,
                name: ev.item?.name,
                arguments: ev.item?.arguments, // string JSON
              });
              continue;
            }

            // Respuesta completada
            if (type === "response.completed") {
              const text = ev.response?.output_text ?? "";
              send("done", { text }); // por si no hubo deltas
              continue;
            }

            // Errores
            if (type === "response.error" || type === "error") {
              send("error", { message: ev.error?.message ?? String(ev) });
              continue;
            }

            // Si aparece algo más, lo ignoramos sin romper
            // console.log("unhandled", type, ev);
          }
        } catch (e: any) {
          send("error", { message: String(e?.message || e) });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(rs, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: String(err?.message || err) }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
}
