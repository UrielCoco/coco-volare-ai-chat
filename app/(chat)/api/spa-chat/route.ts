import OpenAI from "openai";

export const runtime = "edge"; // quítalo si prefieres Node

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
    let body: any = {};
    try { body = await req.json(); } catch {}

    // 1) Normaliza entrada
    let msgs: UIMessage[] | undefined = body?.messages;
    if (!Array.isArray(msgs)) {
      const single = body?.message ?? body?.input ?? body?.prompt ?? body?.text ?? null;
      if (typeof single === "string" && single.trim()) {
        msgs = [{ role: "user", content: single.trim() }];
      }
    }
    if (!Array.isArray(msgs) || msgs.length === 0) {
      return new Response(
        JSON.stringify({
          error:
            "Bad Request: envía { messages: Array<{role, content}> } o un string en 'message'/'input'/'prompt'.",
        }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // 2) Instructions (fijas + cualquier mensaje 'system')
    const fixedInstructions =
      "Eres Coco Volare Intelligence. Responde siempre en español, breve y claro. " +
      "Cuando el usuario comparta detalles de viaje, llama a la función upsert_itinerary con { partial: ... } " +
      "usando claves meta, summary, flights, days, transports, extras y labels. " +
      "No borres datos existentes; sólo mergea. Después de emitir la tool, da una confirmación corta tipo: 'Listo, actualicé el itinerario de la derecha.'";

    const systemNotes = msgs
      .filter((m) => m.role === "system" && String(m.content ?? "").trim())
      .map((m) => m.content.trim())
      .join("\n");

    const instructions = systemNotes
      ? `${fixedInstructions}\n\nNotas del sistema:\n${systemNotes}`
      : fixedInstructions;

    // 3) input → usa input_text/output_text según el rol
    type PartType = "input_text" | "output_text";
    const input = msgs
      .filter((m) => m.role !== "system" && String(m.content ?? "").trim().length > 0)
      .map((m) => {
        const text = String(m.content).trim();
        const type: PartType = m.role === "assistant" ? "output_text" : "input_text";
        return { role: m.role, content: [{ type, text }] };
      });

    // 4) Tools (formato NUEVO)
    const tools = [
      {
        type: "function",
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
    ] as any;

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

    // 5) Stream con Responses API
    const stream = await (openai.responses as any).stream({
      model: "gpt-4.1-mini",
      input,
      instructions,
      tools,
      tool_choice: "auto",
      stream: true,
      max_output_tokens: 1200,
    });

    const encoder = new TextEncoder();

    // Banderas para fallback
    let hasText = false;
    let hasTool = false;

    const rs = new ReadableStream({
      async start(controller) {
        const send = (event: string, data: any) =>
          controller.enqueue(encoder.encode(sseChunk(event, data)));

        try {
          for await (const ev of stream as any) {
            const type = ev?.type as string;

            // --- Texto token a token
            if (type === "response.output_text.delta") {
              hasText = true;
              send("delta", { value: ev.delta });
              continue;
            }
            if (type === "response.refusal.delta") {
              hasText = true;
              send("delta", { value: ev.delta });
              continue;
            }

            // --- Tool (args delta y completed)
            if (type === "response.function_call.arguments.delta") {
              hasTool = true;
              send("tool_call.arguments.delta", {
                id: ev.item?.id,
                name: ev.item?.name,
                arguments: { delta: ev.delta },
              });
              continue;
            }
            if (type === "response.function_call.completed") {
              hasTool = true;
              send("tool_call.completed", {
                id: ev.item?.id,
                name: ev.item?.name,
                arguments: ev.item?.arguments, // JSON string
              });
              continue;
            }

            // --- Meta/created/done/error + debug
            if (type === "response.created") {
              send("meta", { threadId: ev.response?.id });
              continue;
            }
            if (type === "response.completed") {
              // Puede no haber texto si sólo hubo tool; 'output_text' puede venir vacío
              const text = ev.response?.output_text ?? "";
              // No forzamos hasText=true aquí; dejamos que flags decidan fallback
              send("done", { text });
              continue;
            }
            if (type === "response.error" || type === "error") {
              send("error", { message: ev.error?.message ?? String(ev) });
              continue;
            }

            // --- Cubre otros tipos (multi-item, added/done, etc.) para depurar
            send("debug", { type, ev });
          }
        } catch (e: any) {
          send("error", { message: String(e?.message || e) });
        } finally {
          // Fallback: si no hubo ni texto ni tool, hacemos una respuesta corta no-stream
          if (!hasText && !hasTool) {
            try {
              const short = await (openai.responses as any).create({
                model: "gpt-4.1-mini",
                input: [
                  {
                    role: "user",
                    content: [
                      {
                        type: "input_text",
                        text:
                          "Genera una confirmación breve en español (1 línea) diciendo que leíste la solicitud y que empezarás a armar el itinerario. No uses viñetas.",
                      },
                    ],
                  },
                ],
                instructions,
                max_output_tokens: 60,
              });
              const txt = short?.output_text ?? "Listo, comencé a procesar tu solicitud.";
              send("delta", { value: txt });
              send("done", { text: txt });
            } catch {
              send("delta", { value: "Listo, comencé a procesar tu solicitud." });
              send("done", { text: "Listo, comencé a procesar tu solicitud." });
            }
          }
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
