/* eslint-disable no-console */
// app/(chat)/api/spa-chat/route.ts
// SSE alineado a OpenAI con DIAGNÓSTICO EXTREMO y soporte de:
// - Deltas de tools char-by-char (function.arguments) y arguments_delta
// - run.requires_action con JSON final de tool_calls
// - Mapea a: run.*, message.*, tool_call.arguments.delta, tool_call.completed, tool_result, done
// - Logs detallados con traceId

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import OpenAI from 'openai'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! })
const ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID!

const LOG_EVENTS = (process.env.SPA_CHAT_LOG_EVENTS ?? '1') === '1'
const LOG_FULL = (process.env.SPA_CHAT_LOG_FULL ?? '0') === '1'
const LOG_TOOL_ARGS = (process.env.SPA_CHAT_LOG_TOOL_ARGS ?? '1') === '1'
const DIAG_ALWAYS = (process.env.SPA_CHAT_DIAG_ALWAYS ?? '0') === '1'
const IGNORE_WS_DELTAS = (process.env.SPA_CHAT_IGNORE_WS_DELTAS ?? '1') === '1'

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
const lastUserMsg = (messages: ChatMsg[] | undefined) =>
  ({ role: 'user' as const, content: (messages || []).filter(m => m.role === 'user').at(-1)?.content || '' })

function extractTextDelta(e: any): string {
  const a = e?.data?.delta?.content?.[0]?.text?.value
  const b = e?.data?.delta?.[0]?.text?.value
  const c = e?.delta
  const d = Array.isArray(e?.data?.content)
    ? e?.data?.content.map((x: any) => x?.text?.value || '').filter(Boolean).join('')
    : ''
  return a || b || c || d || ''
}

// ----------------- Acumulador de tool calls -----------------
type ToolAcc = {
  id: string
  name?: string | null
  buf: string
}
const newToolAcc = (id: string, name?: string | null): ToolAcc => ({ id, name: name ?? null, buf: '' })

function maybeClosedJson(s: string): boolean {
  // Heurística mínima: JSON aparentemente balanceado (empieza con { y termina con } y llaves balanceadas)
  if (!s) return false
  const trimmed = s.trim()
  if (!(trimmed.startsWith('{') && trimmed.endsWith('}'))) return false
  let bal = 0
  for (const ch of trimmed) {
    if (ch === '{') bal++
    if (ch === '}') bal--
    if (bal < 0) return false
  }
  return bal === 0
}

// ----------------- Mapeo de eventos -----------------
function makeEventMapper(opts: {
  controller: Ctl
  traceId: string
  threadId: string
  setRunId: (id: string | null) => void
}) {
  const { controller, traceId, threadId, setRunId } = opts

  // toolCallId -> acumulador
  const toolAcc = new Map<string, ToolAcc>()
  let lastToolId: string | null = null

  function log(label: string, payload: any) {
    if (LOG_EVENTS) console.log('[spa-chat:event]', { traceId, label, preview: trunc(payload, 1200) })
  }

  function emitToolDelta(id: string, name: string | null | undefined, delta: string) {
    if (LOG_TOOL_ARGS) console.log('[spa-chat:toolCallDelta]', { traceId, id, name, delta: trunc(delta, 600) })
    sse(controller, 'tool_call.arguments.delta', {
      data: { id, tool_name: name ?? null, arguments: { delta } },
    })
  }

  function emitToolCompleted(id: string, name: string | null | undefined, args: string) {
    if (LOG_TOOL_ARGS) console.log('[spa-chat:toolCallCompleted]', { traceId, id, name, argsPreview: trunc(args, 1200) })
    sse(controller, 'tool_call.completed', {
      data: { id, tool_name: name ?? null, arguments: args },
    })
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

    // ---- Mensajes de texto ----
    if (type === 'thread.message.delta') {
      const id = e?.data?.id ?? e?.id ?? 'msg'
      const txt = extractTextDelta(e)
      if (txt && !(IGNORE_WS_DELTAS && onlyWs(txt))) {
        if (LOG_FULL) console.log('[spa-chat:textDelta]', { traceId, len: txt.length, sample: txt.slice(0, 160) })
        sse(controller, 'message.delta', {
          data: { id, role: 'assistant', content: [{ type: 'text', content_type: 'text/plain', text_delta: txt }] },
        })
        sse(controller, 'delta', { value: txt }) // shim
      }
      return
    }
    if (type === 'thread.message.completed') {
      const id = e?.data?.id ?? e?.id ?? 'msg'
      sse(controller, 'message.completed', { data: { id, role: 'assistant', content: e?.data?.content ?? [] } })
      return
    }

    // ---- Deltas de tool calls (variantes) ----
    if (type === 'thread.run.step.delta') {
      const d = e?.data?.delta?.step_details
      // Caso A: formato con id + def de tool (apertura)
      const tc0 = d?.tool_calls?.[0]
      if (tc0?.id && tc0?.type === 'function' && tc0?.function?.name) {
        const id = tc0.id
        lastToolId = id
        if (!toolAcc.has(id)) toolAcc.set(id, newToolAcc(id, tc0.function.name))
      }

      // Caso B: argumentos fragmentados en 'arguments' (no *_delta)
      const fragA = tc0?.function?.arguments
      if (typeof fragA === 'string' && fragA.length) {
        const id = tc0?.id || lastToolId || 'tc'
        const acc = toolAcc.get(id) ?? newToolAcc(id, tc0?.function?.name)
        toolAcc.set(id, acc)
        acc.name = acc.name || tc0?.function?.name || null
        acc.buf += fragA
        emitToolDelta(id, acc.name, fragA)
        // si parece JSON cerrado, disparamos completed tentativo (por si no llega requires_action)
        if (maybeClosedJson(acc.buf)) {
          emitToolCompleted(id, acc.name, acc.buf)
        }
        return
      }

      // Caso C: arguments_delta explícito
      const fragDelta =
        d?.tool_calls?.[0]?.function?.arguments_delta ??
        d?.function?.arguments_delta ??
        null
      if (typeof fragDelta === 'string' && fragDelta.length) {
        const id = d?.tool_calls?.[0]?.id || lastToolId || 'tc'
        const name = d?.tool_calls?.[0]?.function?.name || null
        const acc = toolAcc.get(id) ?? newToolAcc(id, name)
        toolAcc.set(id, acc)
        if (name) acc.name = name
        acc.buf += fragDelta
        emitToolDelta(id, acc.name, fragDelta)
        if (maybeClosedJson(acc.buf)) emitToolCompleted(id, acc.name, acc.buf)
        return
      }

      // Caso D: resultado de herramienta
      const toolOut = d?.output ?? d?.tool_output ?? null
      if (toolOut != null) {
        const id = d?.id || lastToolId || 'tc'
        sse(controller, 'tool_result', { data: { tool_call_id: id, result: toolOut } })
        return
      }
      return
    }

    // ---- Señal con JSON completo de las tools ----
    if (type === 'thread.run.requires_action') {
      const calls = e?.data?.required_action?.submit_tool_outputs?.tool_calls || []
      for (const call of calls) {
        const id = call?.id || lastToolId || 'tc'
        const name = call?.function?.name || toolAcc.get(id)?.name || null
        const args = call?.function?.arguments || ''
        // Actualiza buffer y emite completed definitivo
        if (!toolAcc.has(id)) toolAcc.set(id, newToolAcc(id, name))
        const acc = toolAcc.get(id)!
        acc.name = acc.name || name
        acc.buf = args // pisa con JSON final del SDK
        emitToolCompleted(id, acc.name, args)
      }
      return
    }

    // ---- Otros formatos de response.* (por compatibilidad) ----
    if (type?.startsWith('response.')) {
      if (type === 'response.output_text.delta') {
        const val = e?.data?.delta ?? ''
        if (val && !(IGNORE_WS_DELTAS && onlyWs(val))) {
          sse(controller, 'message.delta', {
            data: { id: e?.data?.id ?? 'msg', role: 'assistant', content: [{ type: 'text', content_type: 'text/plain', text_delta: val }] },
          })
          sse(controller, 'delta', { value: val })
        }
      } else if (type === 'response.completed') {
        sse(controller, 'message.completed', {
          data: { id: e?.data?.id ?? 'msg', role: 'assistant', content: e?.data?.output_text ? [{ type: 'text', content_type: 'text/plain', text: e?.data?.output_text }] : [] },
        })
      }
      return
    }

    // Debug por si aparece un tipo nuevo
    sse(controller, 'debug', { event: type, raw: e })
  }
}

// ----------------- Handler principal -----------------
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

  const raw = await req.text().catch(() => '')
  const body = raw ? safeJson(raw) : {}
  const messages = (body?.messages ?? []) as ChatMsg[]
  const lastUser = lastUserMsg(messages)

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

        // @ts-ignore - el SDK expone iterable + emitter
        const emitter: any = await openai.beta.threads.runs.createAndStream(thread.id, {
          assistant_id: ASSISTANT_ID,
        })

        let runId: string | null = null
        const setRunId = (id: string | null) => (runId = id)

        const handle = makeEventMapper({ controller, traceId, threadId: thread.id, setRunId })

        emitter.on?.('event', (ev: any) => {
          if (LOG_EVENTS) console.log('[spa-chat:on.event]', { traceId, type: ev?.event })
          handle(ev)
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

        console.log('[spa-chat:stream.end]', { traceId, threadId: thread.id, runId })
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
