/* eslint-disable @typescript-eslint/no-explicit-any */
import OpenAI from 'openai';
import type { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID!;
if (!ASSISTANT_ID) {
  // Esto aparecerá en los logs de Vercel de inmediato
  console.error('[CV][api] FALTA OPENAI_ASSISTANT_ID en las env vars');
}

function sse(event: string, data?: any) {
  const enc = new TextEncoder();
  const json = typeof data === 'string' ? data : JSON.stringify(data ?? {});
  return enc.encode(`event: ${event}\n${data !== undefined ? `data: ${json}\n` : ''}\n`);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const threadId: string | null = body?.threadId ?? null;
    const userText: string = body?.message?.parts?.[0]?.text ?? '';

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // 1) Crear/recuperar thread
    const thread =
      threadId
        ? { id: threadId }
        : await client.beta.threads.create({ metadata: { app: 'coco-volare' } });

    console.log('[CV][api] thread', { threadId: thread.id });

    // 2) Añadir mensaje de usuario
    await client.beta.threads.messages.create(thread.id, {
      role: 'user',
      content: userText,
    });
    console.log('[CV][api] user.message.created', { len: userText?.length });

    // 3) Lanzar run en streaming
    const stream: any = await client.beta.threads.runs.stream(thread.id, {
      assistant_id: ASSISTANT_ID,
      // metadata opcional para diagnóstico
      metadata: { ui: 'embed', source: 'web' },
    });

    const rs = new ReadableStream({
      start(controller) {
        // meta inicial (para guardar el thread_id en el cliente)
        controller.enqueue(sse('meta', { threadId: thread.id }));

        // Utilidad para loggear y reenviar con nombre homogéneo
        const on = (event: string, cb: (payload: any) => void) => {
          stream.on?.(event, (e: any) => {
            try {
              cb(e);
            } catch (err) {
              console.error('[CV][api] on-handler error', event, err);
            }
          });
        };

        // Eventos de mensaje (dos variantes para compatibilidad tipada)
        on('message.delta', (e) => {
          const val = e?.delta?.content?.[0]?.text?.value ?? '';
          if (val) {
            controller.enqueue(sse('delta', { value: val }));
          }
          console.log('[CV][api] message.delta', { len: val.length });
        });
        on('messageDelta', (e) => {
          const val = e?.delta?.content?.[0]?.text?.value ?? '';
          if (val) {
            controller.enqueue(sse('delta', { value: val }));
          }
          console.log('[CV][api] messageDelta', { len: val.length });
        });

        on('message.completed', (e) => {
          const text = e?.data?.content?.[0]?.text?.value ?? '';
          controller.enqueue(sse('final', { text }));
          console.log('[CV][api] message.completed', { len: text.length });
        });
        on('messageCompleted', (e) => {
          const text = e?.data?.content?.[0]?.text?.value ?? '';
          controller.enqueue(sse('final', { text }));
          console.log('[CV][api] messageCompleted', { len: text.length });
        });

        // Estado del run/steps (útil para depurar en Vercel)
        on('run.step.created', (e) => console.log('[CV][api] step.created', e?.data?.id));
        on('run.step.in_progress', (e) => console.log('[CV][api] step.in_progress', e?.data?.id));
        on('run.step.completed', (e) => console.log('[CV][api] step.completed', e?.data?.id));
        on('run.step.failed', (e) => console.log('[CV][api] step.failed', e?.data?.id));

        on('run.completed', () => {
          console.log('[CV][api] run.completed');
          controller.enqueue(sse('done'));
          controller.close();
        });
        on('runCompleted', () => {
          console.log('[CV][api] runCompleted');
          controller.enqueue(sse('done'));
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

        // Iniciar el stream
        stream.on?.('end', () => {
          console.log('[CV][api] stream.end');
          try {
            controller.enqueue(sse('done'));
          } catch {}
          controller.close();
        });
      },
      cancel() {
        try {
          stream.abort?.();
        } catch {}
      },
    });

    return new Response(rs, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no', // nginx/proxy
      },
    });
  } catch (err: any) {
    console.error('[CV][api] fatal', err);
    return new Response(
      JSON.stringify({ error: 'internal_error', detail: String(err?.message ?? err) }),
      { status: 500 },
    );
  }
}
