// app/(chat)/api/chat/route.ts
import { NextRequest } from "next/server";
import {
  runAssistantWithStream,
  type AssistantEvent,
} from "@/lib/ai/providers/openai-assistant";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const rawMsg = body?.message;
  const userId = body?.userId as string | undefined;
  const assistantId = (body?.assistantId as string | undefined) ?? process.env.OPENAI_ASSISTANT_ID;
  const attachments = body?.attachments as
    | Array<{ file_id: string; tools?: Array<{ type: "file_search" | "code_interpreter" }> }>
    | undefined;
  const metadata = body?.metadata as Record<string, string> | undefined;

  if (!process.env.OPENAI_API_KEY) {
    return jsonErr(500, "Missing OPENAI_API_KEY");
  }
  if (!assistantId) {
    return jsonErr(500, "Missing OPENAI_ASSISTANT_ID");
  }

  // Normaliza/valida el mensaje
  let text = "";
  if (typeof rawMsg === "string") text = rawMsg.trim();
  else if (rawMsg && typeof rawMsg.text === "string") text = rawMsg.text.trim();

  // Si NO hay texto y tampoco adjuntos -> 400
  if ((!text || text.length === 0) && (!attachments || attachments.length === 0)) {
    return jsonErr(400, "Message content must be non-empty.");
  }

  // Si vienen SOLO adjuntos, OpenAI exige content no vacío: ponemos placeholder corto
  if ((!text || text.length === 0) && attachments && attachments.length > 0) {
    text = "Adjuntos enviados";
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start: async (controller) => {
      const send = (data: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      const handleEvent = (e: AssistantEvent) => {
        switch (e.type) {
          case "message.delta":
            send({ type: "delta", text: e.text });
            break;
          case "message.completed":
            send({ type: "done", text: e.text });
            break;
          case "run.requires_action":
            send({ type: "requires_action" });
            break;
          case "run.failed":
            send({ type: "error", error: e.error });
            break;
          case "run.completed":
            // opcional
            break;
        }
      };

      try {
        await runAssistantWithStream({
          assistantId,
          input: text,
          userId,
          attachments,
          metadata,
          onEvent: handleEvent,
        });
      } catch (err: any) {
        send({ type: "error", error: String(err) });
      } finally {
        // Cierra SIEMPRE con JSON (no "[DONE]")
        send({ type: "eof" });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

function jsonErr(status: number, error: string) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
