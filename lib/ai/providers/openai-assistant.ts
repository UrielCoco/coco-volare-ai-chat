// lib/ai/providers/openai-assistant.ts
import OpenAI from 'openai';

export type StreamSend = (event: string, data: any) => void;

export async function handleRunStreamWithTool(client: OpenAI, params: {
  threadId: string;
  assistantId: string;
  onDelta: (text: string) => void;
  onToolItinerary: (json: any) => void;
  onError: (kind: string, detail?: unknown) => void;
  onComplete: (full: string) => void;
}) {
  const stream = await client.beta.threads.runs.stream(params.threadId, {
    assistant_id: params.assistantId,
  });

  let full = "";
  let runId: string | undefined;

  for await (const { event, data } of stream) {
    switch (event) {
      case "thread.run.created": {
        const run = data as any;
        runId = run?.id;
        break;
      }
      case "thread.message.delta": {
        const md = data as any;
        const parts = md.delta?.content ?? [];
        for (const p of parts) {
          if (p.type === "text_delta" || p.type === "output_text_delta") {
            const chunk = p.text?.value ?? p.value ?? "";
            if (!chunk) continue;
            full += chunk;
            params.onDelta(chunk);
          }
        }
        break;
      }
      case "thread.run.step.completed": {
        const step = data as any;
        const details = step?.step_details;
        if (details?.type === "tool_calls" && Array.isArray(details.tool_calls)) {
          for (const tc of details.tool_calls) {
            if (tc?.type === "function" && tc.function?.name === "emit_itinerary") {
              try {
                const args = JSON.parse(tc.function.arguments ?? "{}");
                if (args?.title && Array.isArray(args?.days)) {
                  params.onToolItinerary(args);
                }
              } catch {}
            }
          }
        }
        break;
      }
      case "thread.run.completed": {
        params.onComplete(full);
        break;
      }
      case "thread.run.failed": {
        params.onError("run_failed", data);
        break;
      }
      case "error": {
        params.onError("stream_error", data);
        break;
      }
    }
  }

  return { runId };
}
