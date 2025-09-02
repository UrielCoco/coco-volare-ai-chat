/* eslint-disable @typescript-eslint/no-explicit-any */
import OpenAI from 'openai';
import type { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID!;
if (!ASSISTANT_ID) {
  console.error('[CV][api] FALTA OPENAI_ASSISTANT_ID');
}

const enc = new TextEncoder();
const sse = (event: string, data?: any) =>
  enc.encode(`event: ${event}\n${data !== undefined ? `data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n` : ''}\n`);

// --- Extractores correctos para Assistants v2 ---
function extractDeltaText(e: any): string {
  // e.delta.content = [{ type: "output_text.delta" | "input_text.delta" | "tool_call.delta", text?: string, ...}, ...]
  const parts = e?.delta?.content;
  if (!Array.isArray(parts)) return '';
  let out = '';
  for (const p of parts) {
    if (typeof p?.text === 'string' && typeof p?.type === 'string' && p.type.endsWith('.delta')) {
      out += p.text;
    }
  }
  return out;
}

function extractCompletedText(e: any): string {
  // e.data.content = [{ type: "output_text" | "input_text" | ..., text?: string }, ...]
  const parts = e?.data?.content;
  if (!Array.isArray(parts)) return '';
  let out = '';
  for (const p of parts) {
    if (p?.type === 'output_text' && typeof p?.text === 'string') out += p.text;
  }
  return out;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const threadId: string | null = body?.threadId ?? null;
    const userText: string = body?.message?.parts?.[0]?.text ?? '';

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // 1) Crear/usar thread
    const thread =
      threadId
        ? { id: threadId }
        : await client.beta.threads.create({ metadata: { app: 'coco-volare' } });

    console.log('[CV][api] thread', { threadId: thread.id });

    // 2) Mensaje del usuario
    await client.beta.threads.messages.create(thread.id, {
      role: 'user',
      content: userText,
    });
    console.log('[CV][api] user.message.created', { len: userText?.length });

    // 3) Stream del run
    const stream: any = await client.beta.threads.runs.stream(thread.id, {
      assistant_id: ASSISTANT_ID,
      metadata: { ui: 'embed', source: 'web' },
    });

    let anyText = false;

    const rs = new ReadableStream({
      start(controller) {
        controller.enqueue(sse('meta', { threadId: thread.id }));

        const on = (event: string, cb: (payload: any) => void) => {
          stream.on?.(event, (e: any) => {
            try { cb(e); } catch (err) { console.error('[CV][api] on-handler error', event, err); }
          });
        };

        // Deltas (nombres viejos y nuevos por compat)
        on('message.delta', (e) => {
          const t = extractDeltaText(e);
          console.log('[CV][api] message.delta', { len: t.length });
          if (t) {
            anyText = true;
            controller.enqueue(sse('delta', { value: t }));
          }
        });
        on('messageDelta', (e) => {
          const t = extractDeltaText(e);
          console.log('[CV][api] messageDelta', { len: t.length });
          if (t) {
            anyText = true;
            controller.enqueue(sse('delta', { value: t }));
          }
        });

        // Final de cada mensaje del assistant
        on('message.completed', (e) => {
          const t = extractCompletedText(e);
          console.log('[CV][api] message.completed', { len: t.length });
          if (t) {
            anyText = true;
            controller.enqueue(sse('final', { text: t }));
          }
        });
        on('messageCompleted', (e) => {
          const t = extractCompletedText(e);
          console.log('[CV][api] messageCompleted', { len: t.length });
          if (t) {
            anyText = true;
            controller.enqueue(sse('final', { text: t }));
          }
        });

        // Paso a paso (solo logs para Vercel)
        on('run.step.created', (e) => console.log('[CV][api] step.created', e?.data?.id));
        on('run.step.in_progress', (e) => console.log('[CV][api] step.in_progress', e?.data?.id));
        on('run.step.completed', (e) => console.log('[CV][api] step.completed', e?.data?.id));
        on('run.step.failed', (e) => console.log('[CV][api] step.failed', e?.data?.id));

        on('run.completed', () => {
          console.log('[CV][api] run.completed', { anyText });
          controller.enqueue(sse('done', { anyText }));
          controller.close();
        });
        on('runCompleted', () => {
          console.log('[CV][api] runCompleted', { anyText });
          controller.enqueue(sse('done', { anyText }));
          controller.close();
        });

        on('run.failed', (e) => {
          console.error('[CV][api] run.failed', e?.data);
          controller.enqueue(sse('error', { message: 'run.failed' }));
          controller.close();
        });
        on('error', (e) => {
          console.error('[CV][api] stream.error', e);
          controller.enqueue(sse('error', { message: 'stream.error' }));
          controller.close();
        });

        stream.on?.('end', () => {
          console.log('[CV][api] stream.end');
          try { controller.enqueue(sse('done', { anyText })); } catch {}
          controller.close();
        });
      },
      cancel() {
        try { stream.abort?.(); } catch {}
      },
    });

    return new Response(rs, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (err: any) {
    console.error('[CV][api] fatal', err);
    return new Response(JSON.stringify({ error: 'internal_error', detail: String(err?.message ?? err) }), { status: 500 });
  }
}
