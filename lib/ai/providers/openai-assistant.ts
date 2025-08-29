// lib/ai/providers/openai-assistant.ts
import OpenAI from "openai";

/** Eventos que regresamos al route (SSE) */
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

/** Extrae texto desde el shape de delta (message delta de Assistants) */
function extractDeltaText(ev: any): string {
  try {
    const content = ev?.delta?.content ?? [];
    let acc = "";
    for (const c of content) {
      if (typeof c?.text?.value === "string") acc += c.text.value;
      else if (typeof c?.value === "string") acc += c.value;
    }
    return acc;
  } catch {
    return "";
  }
}

/** Aplana un mensaje completado a texto plano */
function extractCompletedText(ev: any): string {
  try {
    const content = ev?.message?.content ?? [];
    let acc = "";
    for (const c of content) {
      if (typeof c?.text?.value === "string") acc += c.text.value;
      else if (typeof c?.value === "string") acc += c.value;
    }
    return acc;
  } catch {
    return "";
  }
}

/**
 * Ejecuta Assistant con streaming.
 * Sin prompts locales: TODO vive en el Assistant.
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

  // 1) Thread con el mensaje del usuario (content nunca vacío)
  const thread = await client.beta.threads.create({
    messages: [
      {
        role: "user",
        content: input || "Mensaje",
        ...(attachments ? { attachments: attachments as any } : {}),
        ...(userId || metadata
          ? { metadata: { ...(metadata || {}), ...(userId ? { userId } : {}) } }
          : {}),
      },
    ],
    ...(metadata ? { metadata } : {}),
  });

  // 2) Run con stream
  const stream: any = await client.beta.threads.runs.stream(thread.id, {
    assistant_id: assistantId,
  });

  let full = "";

  // Algunas versiones emiten textDelta (string simple)
  stream.on("textDelta", (delta: any) => {
    const chunk = delta?.value ?? "";
    if (chunk) {
      full += chunk;
      onEvent?.({ type: "message.delta", text: chunk });
    }
  });

  // Manejo universal por evento tipado como string
  stream.on("event", (ev: any) => {
    const t = ev?.type;

    // Deltas del mensaje
    if (t === "thread.message.delta") {
      const piece = extractDeltaText(ev);
      if (piece) {
        full += piece;
        onEvent?.({ type: "message.delta", text: piece });
      }
      return;
    }

    // Mensaje completado
    if (t === "thread.message.completed") {
      const finalText = extractCompletedText(ev) || full;
      onEvent?.({ type: "message.completed", text: finalText });
      return;
    }

    // Run requiere acción (tool-calls)
    if (t === "thread.run.requires_action") {
      onEvent?.({ type: "run.requires_action" });
      return;
    }
  });

  // Fin / error
  return new Promise<void>((resolve, reject) => {
    stream.on("end", () => {
      if (full) onEvent?.({ type: "message.completed", text: full });
      onEvent?.({ type: "run.completed" });
      resolve();
    });
    stream.on("error", (err: any) => {
      onEvent?.({ type: "run.failed", error: String(err) });
      reject(err);
    });
  });
}

/** submitToolOutputs compatible con distintas firmas del SDK */
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
    // Firma 1: (runId, { thread_id, tool_outputs })
    await runsApi.submitToolOutputs(params.runId, {
      thread_id: params.threadId,
      tool_outputs,
    });
  } catch {
    // Firma 2: (threadId, runId, { tool_outputs })
    await runsApi.submitToolOutputs(params.threadId, params.runId, {
      tool_outputs,
    });
  }
}
