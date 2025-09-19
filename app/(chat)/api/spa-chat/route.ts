/* eslint-disable no-console */
// app/(chat)/api/spa-chat/route.ts
// SSE alineado a OpenAI con DIAGNÓSTICO EXTREMO:
// - Consume createAndStream como AsyncIterable y también via .on('event')
// - Mapea eventos genéricos e.event → run.*, message.*, tool_call.*, tool_result
// - Shim 'delta' para compat con SPA actual
// - Trae traceId y logs exhaustivos

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import OpenAI from 'openai'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ------------ Config de entorno / flags de log ------------
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! })
const ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID!

const LOG_FULL = (process.env.SPA_CHAT_LOG_FULL ?? '0') === '1'
const LOG_EVENTS = (process.env.SPA_CHAT_LOG_EVENTS ?? '1') === '1'
const LOG_TOOL_ARGS = (process.env.SPA_CHAT_LOG_TOOL_ARGS ?? '0') === '1'
const DIAG_ALWAYS = (process.env.SPA_CHAT_DIAG_ALWAYS ?? '0') === '1'
const IGNORE_WS_DELTAS = (process.env.SPA_CHAT_IGNORE_WS_DELTAS ?? '1') === '1'

// ------------ Tipos / helpers ------------
type ChatMsg = { role: 'user' | 'assistant' | 'system'; content: string }
type Ctl = ReadableStreamDefaultController
const enc = new TextEncoder()

const trunc = (v: any, n = 1000) => {
  let s = ''
  try { s = typeof v === 'string' ? v : JSON.stringify(v) } catch { s = String(v) }
  return s.length > n ? s.slice(0, n) + '…[truncated]' : s
}
const onlyWs = (s: string) => !s.replace(/\s+/g, '')
const tid = () => Math.random().toString(36).slice(2) + Date.now().toString(36)
const sse = (c: Ctl, event: string, data: any) => {
  c.enqueue(enc.encode(`event: ${event}\n`))
  c.enqueue(enc.encode(`data: ${JSON.stringify(data)}\n\n`))
}
const safeJson = (t: string) => { try { return JSON.parse(t) } catch { return null } }
const asUserMessage = (messages: ChatMsg[] | undefined) =>
  ({ role: 'user' as const, content: (messages || []).filter(m => m.role === 'user').at(-1)?.content || '' })

// Extrae texto de varias formas de evento
function extractTextDelta(e: any): string {
  const a = e?.data?.delta?.content?.[0]?.text?.value
  const b = e?.data?.delta?.[0]?.text?.value
  const c = e?.delta
  const d = Array.isArray(e?.data?.content)
    ? e?.data?.content.map((x: any) => x?.text?.value || '').filter(Boolean).join('')
    : ''
  return a || b || c || d || ''
}

// ------------ Mapeo de eventos genéricos OpenAI → SSE propios ------------
function makeEventMapper(opts: {
  controller: Ctl
  traceId: string
  threadId: string
  setRunId: (id: string | null) => void
}) {
  const { controller, traceId, threadId, setRunId } = opts

  function log(label: string, payload: any) {
    if (LOG_EVENTS) console.log('[spa-chat:event]', { traceId, label, preview: trunc(payload, 1200) })
  }

  return function handle(e: any) {
    const type = e?.event as string
    if (!type) return

    log(type, e)

    // ---- RUN lifecycle ----
    if (type === 'thread.run.created') {
      const id = e?.data?.id ?? null
      if (id) setRunId(id)
      sse(controller, 'run.created', { data: { id, status: 'queued', thread_id: threadId } })
      return
    }
    if (type === 'thread.run.queued' || type === 'thread.run.in_progress') {
      const id = e?.data?.id ?? null
      if (id) setRunId(id)
      sse(controller, 'run.started', { data: { id, status: 'in_progress', thread_id: threadId } })
      return
    }
    if (type === 'thread.run.completed') {
      const id = e?.data?.id ?? null
      sse(controller, 'run.completed', { data: { id, status: 'completed', thread_id: threadId } })
      return
    }
    if (type === 'thread.run.failed' || type === 'error') {
      const id = e?.data?.id ?? null
      const message = e?.data?.last_error?.message || e?.data?.message || 'run_failed'
      sse(controller, 'run.failed', { data: { id, status: 'failed', thread_id: threadId, error: { message } } })
      return
    }

    // ---- MESSAGE deltas / completed ----
    if (type === 'thread.message.delta') {
      const id = e?.data?.id ?? e?.id ?? 'msg'
      const txt = extractTextDelta(e)
      if (txt && !(IGNORE_WS_DELTAS && onlyWs(txt))) {
        if (LOG_FULL) console.log('[spa-chat:textDelta]', { traceId, len: txt.length, sample: txt.slice(0, 160) })
        sse(controller, 'message.delta', {
          data: {
            id, role: 'assistant',
            content: [{ type: 'text', content_type: 'text/plain', text_delta: txt }],
          },
        })
        // Shim para tu SPA actual
        sse(controller, 'delta', { value: txt })
      }
      return
    }
    if (type === 'thread.message.completed') {
      // Entrega el contenido tal cual (puede traer parts variados)
      const id = e?.data?.id ?? e?.id ?? 'msg'
      sse(controller, 'message.completed', {
        data: { id, role: 'assistant', content: e?.data?.content ?? [] },
      })
      return
    }

    // ---- TOOL calls (distintos SDKs las emiten bajo run.step.delta/created) ----
    // Buscamos deltas de argumentos de funciones
    if (type === 'thread.run.step.delta' || type === 'thread.run.step.created' || type === 'thread.run.step.completed') {
      // En algunos SDKs, la info viene en e.data.step_details o e.data.delta
      const step = e?.data?.step_details || e?.data?.delta || e?.data
      // 1) Delta de argumentos (function call)
      const fDelta =
        step?.tool_calls?.[0]?.function?.arguments_delta ||
        step?.function?.arguments_delta ||
        step?.function?.arguments ||
        step?.tool_calls?.[0]?.function?.arguments ||
        null

      const toolName =
        step?.tool_calls?.[0]?.function?.name ||
        step?.function?.name ||
        step?.name ||
        null

      const toolCallId =
        step?.tool_calls?.[0]?.id ||
        step?.id ||
        e?.data?.id ||
        'tc'

      if (typeof fDelta === 'string' && fDelta.length) {
        if (LOG_TOOL_ARGS) console.log('[spa-chat:toolCallDelta]', { traceId, toolCallId, toolName, deltaPreview: trunc(fDelta, 600) })
        sse(controller, 'tool_call.arguments.delta', {
          data: { id: toolCallId, tool_name: toolName, arguments: { delta: fDelta } },
        })
        return
      }

      // 2) Tool call "cerrado" (argumentos completos)
      const fArgs =
        step?.tool_calls?.[0]?.function?.arguments ||
        step?.function?.arguments ||
        null

      if (typeof fArgs === 'string' && fArgs.length) {
        if (LOG_TOOL_ARGS) console.log('[spa-chat:toolCallCompleted]', { traceId, toolCallId, toolName, argsPreview: trunc(fArgs, 1200) })
        sse(controller, 'tool_call.completed', { data: { id: toolCallId, tool_name: toolName, arguments: fArgs } })
        return
      }

      // 3) Resultados de tool (cuando existan)
      const tOut =
        step?.tool_output ??
        step?.output ??
        null

      if (tOut != null) {
        if (LOG_TOOL_ARGS) console.log('[spa-chat:toolResult]', { traceId, tool_call_id: toolCallId, resultPreview: trunc(tOut, 1200) })
        sse(controller, 'tool_result', { data: { tool_call_id: toolCallId, result: tOut } })
        return
      }
      return
    }

    // ---- Otros eventos de respuesta (por compat futura) ----
    if (type?.startsWith('response.')) {
      // Algunos SDKs emiten response.output_text.delta / response.completed
      if (type === 'response.output_text.delta') {
        const val = e?.data?.delta ?? ''
        if (val && !(IGNORE_WS_DELTAS && onlyWs(val))) {
          sse(controller, 'message.delta', {
            data: {
              id: e?.data?.id ?? 'msg',
              role: 'assistant',
              content: [{ type: 'text', content_type: 'text/plain', text_delta: val }],
            },
          })
          sse(controller, 'delta', { value: val })
        }
      } else if (type === 'response.completed') {
        sse(controller, 'message.completed', {
          data: {
            id: e?.data?.id ?? 'msg',
            role: 'assistant',
            content: e?.data?.output_text
              ? [{ type: 'text', content_type: 'text/plain', text: e?.data?.output_text }]
              : [],
          },
        })
      }
      return
    }

    // Si llega algo desconocido, lo mandamos como debug SSE para inspección
    sse(controller, 'debug', { event: type, raw: e })
  }
}

// ------------ Handler principal ------------
export async function POST(req: NextRequest) {
  const traceId = tid()
  const url = new URL(req.url)
  const DIAG = url.searchParams.get('diag') === '1' || DIAG_ALWAYS

  if (!process.env.OPENAI_API_KEY) {
    console.error('[spa-chat:error]', { traceId, msg: 'Falta OPENAI_API_KEY' })
    return new Response('Falta OPENAI_API_KEY', { status: 500 })
  }
  if (!ASSISTANT_ID) {
    console.error('[spa-chat:error]', { traceId, msg: 'Falta OPENAI_ASSISTANT_ID' })
    return new Response('Falta OPENAI_ASSISTANT_ID', { status: 500 })
  }

  // Body RAW para diagnóstico
  const raw = await req.text().catch(() => '')
  const body = raw ? safeJson(raw) : {}
  const messages = (body?.messages ?? []) as ChatMsg[]
  const lastUser = asUserMessage(messages)

  console.log('[spa-chat:req]', {
    traceId,
    method: req.method,
    path: url.pathname,
    query: Object.fromEntries(url.searchParams),
    hasBody: !!raw,
    bodyPreview: trunc(raw, 2000),
  })

  const headers = new Headers({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })

  const stats = {
    startedAt: Date.now(),
    deltaCount: 0,
    deltaChars: 0,
    toolDeltaCount: 0,
    toolDeltaBytes: 0,
    toolCompletedCount: 0,
    toolCompletedBytes: 0,
  }

  const stream = new ReadableStream({
    start: async (controller) => {
      const debug = (label: string, data: any) => {
        if (DIAG) sse(controller, 'debug', { traceId, label, data })
      }

      try {
        console.log('[spa-chat:thread.create]', { traceId })
        const thread = await openai.beta.threads.create({
          messages: [{ role: 'user', content: lastUser.content }],
        })
        console.log('[spa-chat:thread.created]', { traceId, threadId: thread.id })
        sse(controller, 'thread.created', { data: { id: thread.id } })
        debug('thread.created', { id: thread.id })

        console.log('[spa-chat:run.start]', { traceId, threadId: thread.id, assistantId: ASSISTANT_ID })

        // createAndStream devuelve AsyncIterable + EventEmitter
        // @ts-ignore diferencias de tipos según versión del SDK
        const emitter: any = await openai.beta.threads.runs.createAndStream(thread.id, {
          assistant_id: ASSISTANT_ID,
        })

        let runId: string | null = null
        const setRunId = (id: string | null) => (runId = id)

        const handle = makeEventMapper({ controller, traceId, threadId: thread.id, setRunId })

        // 1) Suscripción genérica a eventos (por si el SDK emite .on('event', e))
        emitter.on?.('event', (e: any) => {
          if (LOG_EVENTS) console.log('[spa-chat:on.event]', { traceId, type: e?.event })
          handle(e)
        })

        emitter.on?.('end', () => {
          console.log('[spa-chat:on.end]', { traceId, threadId: thread.id, runId })
          sse(controller, 'done', {})
          controller.close()
        })

        emitter.on?.('error', (err: any) => {
          console.error('[spa-chat:on.error]', { traceId, err: trunc(err, 1200) })
          sse(controller, 'run.failed', { data: { id: runId, status: 'failed', thread_id: thread.id, error: { message: String(err?.message || err || 'stream_error') } } })
          sse(controller, 'done', {})
          controller.close()
        })

        // 2) Consumo del AsyncIterable (algunas versiones sólo emiten así)
        try {
          for await (const ev of emitter as AsyncIterable<any>) {
            if (LOG_EVENTS) console.log('[spa-chat:iter.event]', { traceId, type: ev?.event })
            handle(ev)
          }
        } catch (iterErr: any) {
          console.error('[spa-chat:iter.error]', { traceId, err: trunc(iterErr, 1200) })
          sse(controller, 'run.failed', { data: { id: runId, status: 'failed', thread_id: thread.id, error: { message: String(iterErr?.message || iterErr || 'iter_error') } } })
          sse(controller, 'done', {})
          controller.close()
          return
        }

        // Cierre por si el SDK no dispara 'end'
        console.log('[spa-chat:stream.end]', {
          traceId,
          threadId: thread.id,
          runId,
          stats,
          tookMs: Date.now() - stats.startedAt,
        })
        sse(controller, 'done', {})
        controller.close()
      } catch (err: any) {
        console.error('[spa-chat:exception]', { traceId, err: trunc(err, 1500) })
        sse(controller, 'run.failed', { data: { status: 'failed', error: { message: String(err?.message || err || 'internal_error') } } })
        sse(controller, 'done', {})
        controller.close()
      }
    },
  })

  console.log('[spa-chat:resp.ready]', { traceId })
  return new NextResponse(stream as any, { status: 200, headers })
}

export async function OPTIONS() {
  return new Response(null, { status: 204 })
}
