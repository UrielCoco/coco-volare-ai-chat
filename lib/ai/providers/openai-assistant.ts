// lib/ai/providers/openai-assistant.ts
import OpenAI from "openai";

export type AssistantEvent =
  | { type: "message.delta"; text: string }
  | { type: "message.completed"; text: string }
  | { type: "run.requires_action" }
  | { type: "run.completed" }
  | { type: "run.failed"; error: string };

export interface RunAssistantParams {
  assistantId: string;
  input: string;
  userId?: string;
  attachments?: Array<{
    file_id: string;
    tools?: Array<{ type: "file_search" | "code_interpreter" }>;
  }>;
  metadata?: Record<string, string>;
  onEvent?: (e: AssistantEvent) => void;
}

export async function runAssistantWithStream({
  assistantId,
  input,
  userId,
  attachments,
  metadata,
  onEvent,
}: RunAssistantParams) {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const thread = await client.beta.threads.create({
    messages: [
      {
        role: "user",
        content: input || "Mensaje",
        ...(attachments ? { attachments } : {}),
        ...(userId || metadata
          ? { metadata: { ...(metadata || {}), ...(userId ? { userId } : {}) } }
          : {}),
      },
    ],
    ...(metadata ? { metadata } : {}),
  });

  // ⚠️ Algunas versiones del SDK cambian los tipos de callbacks.
  // Para máxima compatibilidad, tipamos el stream como `any`.
  const stream: any = await (client as any).beta.threads.runs.stream(thread.id, {
    assistant_id: assistantId,
  });

  let buffer = "";

  await new Promise<void>((resolve, reject) => {
    const emitDelta = (text: string) => text && onEvent?.({ type: "message.delta", text });

    // Firmas "textDelta" / "textCompleted" (presentes en 4.50+)
    if (typeof stream.on === "function") {
      try {
        stream.on("textDelta", (delta: any /* string | TextDelta */, _snap: any) => {
          const piece = typeof delta === "string" ? delta : String(delta?.value ?? "");
          buffer += piece;
          emitDelta(piece);
        });

        stream.on("textCompleted", (full: any) => {
          const text = typeof full === "string" ? full : String(full?.value ?? buffer);
          onEvent?.({ type: "message.completed", text });
        });

        stream.on("event", (e: any) => {
          if (e?.event === "thread.run.requires_action") onEvent?.({ type: "run.requires_action" });
          if (e?.event === "thread.run.completed") onEvent?.({ type: "run.completed" });
        });

        stream.on("end", () => resolve());
        stream.on("error", (err: any) => {
          onEvent?.({ type: "run.failed", error: String(err?.message || err) });
          reject(err);
        });
        return; // listeners armados
      } catch (e) {
        // cae al fallback
      }
    }

    // 🔙 Fallback por si no hay .on(): iteramos eventos crudos
    (async () => {
      try {
        for await (const ev of stream) {
          const t = ev?.event ?? ev?.type;

          // Variantes comunes de nombres según versión
          if (t === "response.output_text.delta" || t === "text.delta" || t === "textDelta") {
            const piece = ev?.data?.delta ?? ev?.delta ?? "";
            buffer += String(piece);
            emitDelta(String(piece));
          } else if (t === "response.output_text.done" || t === "text.completed" || t === "textCompleted") {
            const text = ev?.data?.text ?? ev?.text ?? buffer;
            onEvent?.({ type: "message.completed", text: String(text ?? buffer) });
          } else if (t === "thread.run.requires_action") {
            onEvent?.({ type: "run.requires_action" });
          } else if (t === "thread.run.completed" || t === "response.completed") {
            onEvent?.({ type: "run.completed" });
          }
        }
        resolve();
      } catch (err: any) {
        onEvent?.({ type: "run.failed", error: String(err?.message || err) });
        reject(err);
      }
    })();
  });
}

export async function submitToolOutputs(params: {
  threadId: string;
  runId: string;
  outputs: Array<{ toolCallId: string; output: string }>;
}) {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const tool_outputs = params.outputs.map((o) => ({
    tool_call_id: o.toolCallId,
    output: o.output,
  }));

  const runsApi: any = (client as any).beta.threads.runs;
  try {
    await runsApi.submitToolOutputs(params.runId, { thread_id: params.threadId, tool_outputs });
  } catch {
    await runsApi.submitToolOutputs(params.threadId, params.runId, { tool_outputs });
  }
}
