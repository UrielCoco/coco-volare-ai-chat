// app/(chat)/api/chat/route.ts
import { NextRequest } from "next/server";
import {
  runAssistantWithStream,
  type AssistantEvent,
} from "@/lib/ai/providers/openai-assistant";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const { message, userId, assistantId, attachments, metadata } =
    await req.json();

  if (!process.env.OPENAI_API_KEY) {
    return new Response("Missing OPENAI_API_KEY", { status: 500 });
  }
  const finalAssistantId =
    assistantId ?? process.env.OPENAI_ASSISTANT_ID ?? "";
  if (!finalAssistantId) {
    return new Response("Missing OPENAI_ASSISTANT_ID", { status: 500 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start: async (controller) => {
      const send = (data: unknown) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
        );
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
          assistantId: finalAssistantId,
          input: String(message ?? ""),
          userId,
          attachments,
          metadata,
          onEvent: handleEvent, // <- ya tipado, sin 'any' implícito
        });
      } catch (err: any) {
        send({ type: "error", error: String(err) });
      } finally {
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
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
