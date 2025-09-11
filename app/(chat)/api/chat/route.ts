// app/api/chat/route.ts
import OpenAI from "openai";

export const runtime = "edge"; // quita esto si quieres Node runtime

// --- CORS mínimo ---
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

function sseChunk(event: string, data: any) {
  return `event: ${event}\n` + `data: ${JSON.stringify(data)}\n\n`;
}

export async function POST(req: Request) {
  try {
    const { messages } = (await req.json()) as { messages: UIMessage[] };

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

    // Mapea tus mensajes al formato de Responses API
    const input = messages.map((m) => ({
      role: m.role,
      content: [{ type: "text", text: m.content }],
    }));

    // Tool que tu assistant debe poder llamar
    const tools: OpenAI.Responses.ResponseCreateParams.Tool[] = [
      {
        type: "function",
        function: {
          name: "upsert_itinerary",
          description:
            "Actualiza (merge) el itinerario de la UI con un objeto parcial. No borres campos existentes.",
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
    ];

    // Crear stream con Responses API
    const stream = await client.responses.stream({
      model: "gpt-4.1-mini", // ajusta al modelo que uses
      input,
      tools,
      tool_choice: "auto",
      stream: true,
      system:
        "Eres Coco Volare Intelligence. Cuando recibas datos de viaje, llama a la función upsert_itinerary con { partial: ... }. Responde además con un texto breve y útil. Nunca borres datos existentes.",
    });

    const encoder = new TextEncoder();

    const rs = new ReadableStream({
      async start(controller) {
        const send = (event: string, data: any) => {
          controller.enqueue(encoder.encode(sseChunk(event, data)));
        };

        try {
          // Meta
          stream.on("response.created", (e) => {
            send("meta", { threadId: e.response.id });
          });

          // Texto en vivo (delta)
          stream.on("response.output_text.delta", (e) => {
            send("delta", { value: e.delta });
          });
          // (opcional) rechazos — también como texto
          stream.on("response.refusal.delta", (e) => {
            send("delta", { value: e.delta });
          });

          // Tool-call args en streaming
          stream.on("response.function_call.arguments.delta", (e) => {
            send("tool_call.arguments.delta", {
              id: e.item.id,
              name: e.item.name,
              arguments: { delta: e.delta }, // tu hook ya lo mapea
            });
          });

          // Tool-call completo (args cerrados)
          stream.on("response.function_call.completed", (e) => {
            send("tool_call.completed", {
              id: e.item.id,
              name: e.item.name,
              arguments: e.item.arguments, // string JSON
            });
          });

          // Respuesta completada
          stream.on("response.completed", (e) => {
            // texto final concatenado por si no llegaron deltas
            const text = e.response.output_text;
            send("done", { text });
          });

          // Errores
          stream.on("error", (err) => {
            send("error", { message: String(err) });
          });

          // Cerrar cuando termine
          stream.on("end", () => controller.close());

          await stream.finalize();
        } catch (e: any) {
          send("error", { error: String(e?.message || e) });
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
