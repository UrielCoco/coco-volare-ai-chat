// lib/ai/providers/openai-assistant.ts
import OpenAI from 'openai';

export type StreamSend = (event: string, data: any) => void;

export async function runAssistantOnce(client: OpenAI, threadId: string, assistantId: string) {
  // Útil para llamadas “no streaming”
  const run = await client.beta.threads.runs.createAndPoll(threadId, {
    assistant_id: assistantId,
  });
  return run;
}

export async function handleRunStreamWithTool(client: OpenAI, params: {
  threadId: string;
  assistantId: string;
  send: StreamSend;
  itineraryParameters?: any;
}) {
  const { threadId, assistantId, send, itineraryParameters } = params;

  // @ts-ignore - el tipo exacto del stream varía según versión del SDK
  const runStream: any = await client.beta.threads.runs.stream(threadId, {
    assistant_id: assistantId,
    tools: itineraryParameters ? [{
      type: 'function',
      function: { name: 'emit_itinerary', description: 'Itinerary', parameters: itineraryParameters }
    }] : undefined,
  });

  runStream
    .on('textDelta', (d: any) => send('delta', { value: d?.value || '' }))
    .on('toolCallCompleted', (ev: any) => {
      try {
        if (ev?.toolCall?.function?.name === 'emit_itinerary') {
          const args = JSON.parse(ev.toolCall.function.arguments ?? '{}');
          if (args?.title && Array.isArray(args?.days)) send('itinerary', { payload: args });
        }
      } catch {}
    });

  // Devuelve el stream para que el caller encadene otros handlers si quiere
  return runStream;
}
