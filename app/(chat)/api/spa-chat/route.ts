/* eslint-disable no-console */
// app/(chat)/api/spa-chat/route.ts
// SSE compacto alineado a los eventos de OpenAI (run.*, message.*, tool_call.*, tool_result)

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import OpenAI from 'openai'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! })
const ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID!

type ChatMsg = { role: 'user' | 'assistant' | 'system'; content: string }
type Ctl = ReadableStreamDefaultController
const enc = (s: string) => new TextEncoder().encode(s)

function sse(ctrl: Ctl, event: string, data: any) {
  ctrl.enqueue(enc(`event: ${event}\n`))
  ctrl.enqueue(enc(`data: ${JSON.stringify(data)}\n\n`))
}

function errSSE(ctrl: Ctl, msg: string) {
  sse(ctrl, 'run.failed', { data: { status: 'failed', error: { message: msg } } })
}

function asUserMessage(messages: ChatMsg[] | undefined) {
  const txt = (messages || []).filter(m => m.role === 'user').at(-1)?.content || ''
  return {
    role: 'user' as const,
    content: txt,
  }
}

// -------- Handlers de eventos de OpenAI -> eventos SSE normalizados --------
function mapStreamHandlers(opts: {
  controller: Ctl
  threadId: string
  setRunId: (id: string | null) => void
}) {
  const { controller, threadId, setRunId } = opts

  // Buffer de partes por mensaje (para emitir message.completed con contenido consolidado)
  const msgParts: Record<
    string,
    Array<
      | { type: 'text'; content_type: 'text/plain'; text: string }
      | { type: 'data'; content_type: string; json?: any; json_delta?: string }
    >
  > = {}

  const ensureMsg = (id: string) => (msgParts[id] ||= [])

  return {
    runCreated: (ev: any) => {
      const id = ev?.data?.id ?? ev?.id ?? null
      if (id) setRunId(id)
      sse(controller, 'run.created', { data: { id, status: 'queued', thread_id: threadId } })
    },
    runQueued: (ev: any) => {
      const id = ev?.data?.id ?? ev?.id ?? null
      if (id) setRunId(id)
      sse(controller, 'run.started', { data: { id, status: 'in_progress', thread_id: threadId } })
    },
    runInProgress: (ev: any) => {
      const id = ev?.data?.id ?? ev?.id ?? null
      if (id) setRunId(id)
      // opcional: no emitas nada adicional aquí; run.started ya indica progreso
    },
    runCompleted: (ev: any) => {
      const id = ev?.data?.id ?? ev?.id ?? null
      sse(controller, 'run.completed', { data: { id, status: 'completed', thread_id: threadId } })
    },
    runFailed: (ev: any) => {
      const id = ev?.data?.id ?? ev?.id ?? null
      const message = ev?.data?.last_error?.message || ev?.data?.error || 'run_failed'
      sse(controller, 'run.failed', {
        data: { id, status: 'failed', thread_id: threadId, error: { message } },
      })
    },

    // Deltas de texto de mensajes
    textDelta: (ev: any) => {
      const id = ev?.data?.id ?? ev?.id ?? 'msg'
      const delta =
        ev?.data?.delta?.content?.[0]?.text?.value ??
        ev?.data?.delta?.[0]?.text?.value ??
        ev?.delta ?? ''
      if (!delta) return
      ensureMsg(id).push({ type: 'text', content_type: 'text/plain', text: delta })
      sse(controller, 'message.delta', {
        data: {
          id,
          role: 'assistant',
          content: [{ type: 'text', content_type: 'text/plain', text_delta: delta }],
        },
      })
    },

    // Deltas de "message" en algunos SDKs (equivalente)
    messageDelta: (ev: any) => {
      const id = ev?.data?.id ?? ev?.id ?? 'msg'
      const content = ev?.data?.delta?.content || ev?.data?.content
      // Soporta part de tipo texto
      const t = Array.isArray(content)
        ? content
            .map((c: any) => c?.text?.value || '')
            .filter(Boolean)
            .join('')
        : ''
      if (!t) return
      ensureMsg(id).push({ type: 'text', content_type: 'text/plain', text: t })
      sse(controller, 'message.delta', {
        data: {
          id,
          role: 'assistant',
          content: [{ type: 'text', content_type: 'text/plain', text_delta: t }],
        },
      })
    },

    // Tool calls (arguments en streaming)
    toolCallDelta: (ev: any) => {
      const id = ev?.data?.id ?? ev?.tool_call_id ?? 'tc'
      const name = ev?.data?.name || ev?.data?.function?.name || ev?.name
      const d =
        ev?.data?.delta?.function?.arguments ??
        ev?.data?.function?.arguments ??
        ev?.arguments_delta ??
        ''
      if (!d) return
      sse(controller, 'tool_call.arguments.delta', {
        data: { id, tool_name: name, arguments: { delta: d } },
      })
    },

    toolCallCompleted: (ev: any) => {
      const id = ev?.data?.id ?? ev?.tool_call_id ?? 'tc'
      const name = ev?.data?.name || ev?.data?.function?.name || ev?.name
      const args =
        typeof ev?.data?.function?.arguments === 'string'
          ? ev?.data?.function?.arguments
          : typeof ev?.data?.arguments === 'string'
          ? ev?.data?.arguments
          : ''
      sse(controller, 'tool_call.completed', { data: { id, tool_name: name, arguments: args } })
    },

    // Cuando OpenAI entrega un mensaje completo
    messageCompleted: (ev: any) => {
      const id = ev?.data?.id ?? ev?.id ?? 'msg'
      const content = ev?.data?.content ?? []
      // Integra todo lo que venga del SDK + lo acumulado de deltas
      const parts = ensureMsg(id)

      for (const c of content) {
        if (c?.type === 'output_text' && c?.text?.value) {
          parts.push({ type: 'text', content_type: 'text/plain', text: c.text.value })
        }
        if (c?.type === 'text' && c?.text?.value) {
          parts.push({ type: 'text', content_type: 'text/plain', text: c.text.value })
        }
      }

      sse(controller, 'message.completed', {
        data: {
          id,
          role: 'assistant',
          content: parts,
        },
      })
    },

    // Resultados de herramientas (cuando el SDK los emite)
    toolOutput: (ev: any) => {
      const id = ev?.data?.tool_call_id ?? ev?.tool_call_id ?? 'tc'
      const result = ev?.data?.output ?? ev?.output ?? null
      sse(controller, 'tool_result', { data: { tool_call_id: id, result } })
    },
  }
}

// --------------------------- Handler principal ---------------------------
export async function POST(req: NextRequest) {
  if (!process.env.OPENAI_API_KEY) {
    return new Response('Falta OPENAI_API_KEY', { status: 500 })
  }
  if (!ASSISTANT_ID) {
    return new Response('Falta OPENAI_ASSISTANT_ID', { status: 500 })
  }

  let body: { messages?: ChatMsg[] } = {}
  try {
    body = (await req.json()) as any
  } catch {
    // ignore
  }
  const userMsg = asUserMessage(body.messages)

  // Crea thread con el último mensaje del usuario
  const thread = await openai.beta.threads.create({
    messages: [{ role: 'user', content: userMsg.content }],
  })

  // Respuesta SSE
  const headers = new Headers({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })

  const stream = new ReadableStream({
    start: async (controller) => {
      // Notifica thread creado (opcional)
      sse(controller, 'thread.created', { data: { id: thread.id } })

      let runId: string | null = null
      const setRunId = (id: string | null) => (runId = id)

      try {
        // Inicia run en streaming y mapea eventos → SSE normalizados
        const emitter: any = await openai.beta.threads.runs.stream(thread.id, {
          assistant_id: ASSISTANT_ID,
        })

        const h = mapStreamHandlers({ controller, threadId: thread.id, setRunId })

        emitter.on?.('runCreated', h.runCreated)
        emitter.on?.('runQueued', h.runQueued)
        emitter.on?.('runInProgress', h.runInProgress)
        emitter.on?.('runCompleted', h.runCompleted)
        emitter.on?.('runFailed', h.runFailed)

        emitter.on?.('textDelta', h.textDelta)
        emitter.on?.('messageDelta', h.messageDelta)
        emitter.on?.('messageCompleted', h.messageCompleted)

        emitter.on?.('toolCallDelta', h.toolCallDelta)
        emitter.on?.('toolCallCompleted', h.toolCallCompleted)
        emitter.on?.('toolOutput', h.toolOutput)

        emitter.on?.('error', (e: any) => {
          errSSE(controller, e?.message || 'stream_error')
          controller.close()
        })
        emitter.on?.('end', () => {
          if (runId) {
            sse(controller, 'run.completed', { data: { id: runId, status: 'completed', thread_id: thread.id } })
          }
          sse(controller, 'done', {})
          controller.close()
        })

        // Drena el async iterable (algunas versiones lo requieren)
        try {
          for await (const _ of emitter as AsyncIterable<any>) {
            /* drain */
          }
        } catch {
          // ignore
        }
      } catch (e: any) {
        errSSE(controller, e?.message || 'run_create_error')
        sse(controller, 'done', {})
        controller.close()
      }
    },
  })

  return new NextResponse(stream as any, { status: 200, headers })
}

// Opcional: preflight si tu front llama vía POST
export async function OPTIONS() {
  return new Response(null, { status: 204 })
}
