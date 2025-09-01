// lib/ai/providers/openai-assistant.ts
import OpenAI from 'openai';

export type StreamSend = (event: string, data: any) => void;

function slog(event: string, meta: Record<string, any> = {}) {
  try { console.info(JSON.stringify({ tag: '[CV][server]', event, ...meta })); } catch {}
}

export async function runAssistantOnce(client: OpenAI, threadId: string, assistantId: string) {
  const run = await client.beta.threads.runs.createAndPoll(threadId, { assistant_id: assistantId });
  return run;
}

export async function handleRunStreamWithTool(client: OpenAI, params: {
  threadId: string;
  assistantId: string;
  itineraryParameters?: any; // si defines la función emit_itinerary
  send: StreamSend;
}) {
  const { threadId, assistantId, itineraryParameters, send } = params;

  // @ts-ignore — el tipo exacto del stream varía entre versiones del SDK
  const runStream: any = await client.beta.threads.runs.stream(threadId, {
    assistant_id: assistantId,
    tools: itineraryParameters ? [{
      type: 'function',
      function: { name: 'emit_itinerary', description: 'Itinerary', parameters: itineraryParameters }
    }] : undefined,
  });

  let chars = 0;
  let t0 = Date.now();
  let tFirst: number | null = null;

  runStream
    .on('runCreated', (ev: any) => {
      const runId = ev?.data?.id;
      slog('run.created', { threadId, runId });
    })
    .on('textDelta', (d: any) => {
      const v = d?.value || '';
      if (!v) return;
      chars += v.length;
      if (tFirst == null) {
        tFirst = Date.now();
        slog('stream.first_delta', { threadId, firstDeltaMs: tFirst - t0 });
      }
      if (chars % 600 < v.length) slog('stream.delta.tick', { threadId, deltaChars: chars });
      send('delta', { value: v });
    })
    .on('toolCallDelta', (ev: any) => {
      // sólo diagnóstico (no cambiamos protocolo)
      try {
        const name = ev?.toolCall?.function?.name;
        const args = ev?.toolCall?.function?.arguments ?? '';
        if (name) slog('tool.delta', { threadId, name, argsLen: String(args).length });
      } catch {}
    })
    .on('toolCallCompleted', (ev: any) => {
      try {
        if (ev?.toolCall?.function?.name === 'emit_itinerary') {
          const args = JSON.parse(ev.toolCall.function.arguments ?? '{}');
          if (args?.title && Array.isArray(args?.days)) send('itinerary', { payload: args });
          slog('tool.completed', { threadId, name: 'emit_itinerary', ok: !!(args?.days?.length) });
        }
      } catch (e) {
        slog('tool.completed.parse_error', { threadId, error: String((e as any)?.message || e) });
      }
    })
    .on('runFailed', (e: any) => {
      slog('stream.error', { threadId, error: 'run_failed' });
      send('error', { error: 'run_failed' });
    })
    .on('error', (e: any) => {
      slog('stream.error', { threadId, error: 'stream_error' });
      send('error', { error: 'stream_error' });
    })
    .on('runCompleted', () => {
      slog('stream.timing', {
        threadId,
        firstDeltaMs: tFirst == null ? null : (tFirst - t0),
        totalMs: Date.now() - t0,
      });
      send('done', { ok: true });
    });

  return runStream;
}
