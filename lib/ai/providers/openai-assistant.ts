// lib/ai/providers/openai-assistant.ts
import OpenAI from "openai";

// Evento que mandamos de regreso al route
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
  onEvent?: (e: AssistantEvent) => void; // <-- parámetro tipado correctamente
}

/**
 * Ejecuta el Assistant con streaming de texto.
 * Sin prompts locales: todo vive en el Assistant.
 */
export async function runAssistantWithStream({
  assistantId,
  input,
  userId,
  attachments,
  metadata,
  onEvent,
}: RunAssistantParams) {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  // 1) Thread con mensaje del usuario
  const thread = await client.beta.threads.create({
    messages: [
      {
        role: "user",
        content: input,
        ...(attachments ? { attachments: attachments as any } : {}),
        ...(userId || metadata
          ? { metadata: { ...(metadata || {}), ...(userId ? { userId } : {}) } }
          : {}),
      },
    ],
    ...(metadata ? { metadata } : {}),
  });

  // 2) Run + stream
  const stream = await client.beta.threads.runs.stream(thread.id, {
    assistant_id: assistantId,
  });

  let full = "";

  stream.on("textDelta", (delta: any) => {
    const chunk = delta?.value ?? "";
    if (chunk) {
      full += chunk;
      onEvent?.({ type: "message.delta", text: chunk });
    }
  });

  // Algunas versiones no emiten messageDone; cerramos en "end"
  return new Promise<void>((resolve, reject) => {
    stream.on("event", (ev: any) => {
      if (ev?.type === "thread.run.requires_action") {
        onEvent?.({ type: "run.requires_action" });
      }
    });
    stream.on("end", () => {
      onEvent?.({ type: "message.completed", text: full });
      onEvent?.({ type: "run.completed" });
      resolve();
    });
    stream.on("error", (err: any) => {
      onEvent?.({ type: "run.failed", error: String(err) });
      reject(err);
    });
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

  // Algunas versiones del SDK piden (runId, {thread_id, tool_outputs})
  // otras usan (threadId, runId, {tool_outputs}).
  // Usamos 'as any' para evitar conflicto de overloads en TS.
  const runsApi: any = (client as any).beta.threads.runs;

  try {
    // Firma 1: (runId, { thread_id, tool_outputs })
    await runsApi.submitToolOutputs(params.runId, {
      thread_id: params.threadId,
      tool_outputs,
    });
  } catch (_e: any) {
    // Firma 2: (threadId, runId, { tool_outputs })
    await runsApi.submitToolOutputs(params.threadId, params.runId, {
      tool_outputs,
    });
  }
}


