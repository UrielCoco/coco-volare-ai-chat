/* eslint-disable no-console */
// app/(chat)/api/spa-chat/route.ts
// SSE alineado a eventos estilo OpenAI + LOGS detallados para Vercel

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import OpenAI from 'openai'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ---------- Config ----------
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! })
const ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID!

// Verbosidad controlable por ENV
const LOG_FULL = (process.env.SPA_CHAT_LOG_FULL ?? '0') === '1'           // log de payloads completos
const LOG_EVENTS = (process.env.SPA_CHAT_LOG_EVENTS ?? '1') === '1'       // log de eventos OpenAI
const LOG_TOOL_ARGS = (process.env.SPA_CHAT_LOG_TOOL_ARGS ?? '0') === '1' // log de args de tools
const DIAG_ALWAYS = (process.env.SPA_CHAT_DIAG_ALWAYS ?? '0') === '1'     // enviar eventos 'debug' SSE
const IGNORE_WS_DELTAS = (process.env.SPA_CHAT_IGNORE_WS_DELTAS ?? '1') === '1'

// ---------- Tipos ----------
type ChatMsg = { role: 'user' | 'assistant' | 'system'; content: string }
type Ctl = ReadableStreamDefaultController
const enc = new TextEncoder()

// ---------- Helpers ----------

function sse(ctrl: Ctl, event: string, data: any) {
  ctrl.enqueue(enc.encode(`event: ${event}\n`))
  ctrl.enqueue(enc.encode(`data: ${JSON.stringify(data)}\n\n`))
}

function tid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

function onlyWs(s: string) {
  return !s.replace(/\s+/g, '')
}

function trunc(obj: any, max = 1200) {
  let s: string
  try {
    s = typeof obj === 'string' ? obj : JSON.stringify(obj)
  } catch {
    s = String(obj)
  }
  return s.length > max ? s.slice(0, max) + '…[truncated]' : s
}

function safeJsonParse(str: string) {
  try { return JSON.parse(str) } catch { return null }
}

function textFromOpenAIEvent(ev: any): string {
  // distintos SDKs emiten variantes; cubrimos las comunes
  const a = ev?.data?.delta?.content?.[0]?.text?.value
  const b = ev?.data?.delta?.[0]?.text?.value
  const c = ev?.delta
  const d = Array.isArray(ev?.data?.content)
    ? ev?.data?.content?.map((x: any) => x?.text?.value || '').filter(Boolean).join('')
    : ''
  return a || b || c || d || ''
}

function asUserMessage(messages: ChatMsg[] | undefined) {
  const txt = (messages || []).filter(m => m.role === 'user').at(-1)?.content || ''
  return { role: 'user' as const, content: txt }
}

// ---------- Handler principal ----------
export async function POST(req: NextRequest) {
  const traceId = tid()
  const url = new URL(req.url)
  const DIAG = url.searchParams.get('diag') === '1' || DIAG_ALWAYS

  if (!process.env.OPENAI_API_KEY) {
    console.error('[spa-chat]', { traceId, error: 'Falta OPENAI_API_KEY' })
    return new Response('Falta OPENAI_API_KEY', { status: 500 })
  }
  if (!ASSISTANT_ID) {
    console.error('[spa-chat]', { traceId, error: 'Falta OPENAI_ASSISTANT_ID' })
    return new Response('Falta OPENAI_ASSISTANT_ID', { status: 500 })
  }

  // Captura RAW para depuración
  const raw = await req.text().catch(() => '')
  const body = raw ? safeJsonParse(raw) : {}
  const messages = (body?.messages ?? []) as ChatMsg[]
  const lastUser = asUserMessage(messages)

  console.log('[spa-chat:req]', {
    traceId,
    method: req.method,
    path: url.pathname,
    query: Object.fromEntries(url.searchParams),
    hasBody: !!raw,
    bodyPreview: trunc(raw, 1200),
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

        let lastRunId: string | null = null
        const toolBuf: Record<string, { name?: string; args: string }> = {}

        const attach = async (runStream: any) => {
          const capture = (ev: any, label: string) => {
            const id = ev?.data?.id ?? ev?.id
            if (id) lastRunId = id
            if (LOG_EVENTS) console.log('[spa-chat:event]', { traceId, label, id, preview: trunc(ev, 900) })
            debug(label, { id, ev })
          }

          runStream.on?.('runCreated', (ev: any) => {
            capture(ev, 'runCreated')
            sse(controller, 'run.created', { data: { id: ev?.data?.id ?? ev?.id, status: 'queued', thread_id: thread.id } })
          })

          runStream.on?.('runQueued', (ev: any) => {
            capture(ev, 'runQueued')
            sse(controller, 'run.started', { data: { id: ev?.data?.id ?? ev?.id, status: 'in_progress', thread_id: thread.id } })
          })

          runStream.on?.('runInProgress', (ev: any) => capture(ev, 'runInProgress'))

          // TEXT DELTAS
          runStream.on?.('textDelta', (ev: any) => {
            const txt = textFromOpenAIEvent(ev)
            if (!txt) return
            if (IGNORE_WS_DELTAS && onlyWs(txt)) return
            stats.deltaCount++; stats.deltaChars += txt.length
            if (LOG_FULL) console.log('[spa-chat:event textDelta]', { traceId, len: txt.length, sample: txt.slice(0, 120) })
            sse(controller, 'message.delta', {
              data: {
                id: ev?.data?.id ?? ev?.id ?? 'msg',
                role: 'assistant',
                content: [{ type: 'text', content_type: 'text/plain', text_delta: txt }],
              },
            })
            // Shim de compatibilidad para SPA actual
            sse(controller, 'delta', { value: txt })
          })

          // MESSAGE DELTAS (algunos SDKs)
          runStream.on?.('messageDelta', (ev: any) => {
            const txt = textFromOpenAIEvent(ev)
            if (!txt) return
            if (IGNORE_WS_DELTAS && onlyWs(txt)) return
            stats.deltaCount++; stats.deltaChars += txt.length
            if (LOG_FULL) console.log('[spa-chat:event messageDelta]', { traceId, len: txt.length, sample: txt.slice(0, 120) })
            sse(controller, 'message.delta', {
              data: {
                id: ev?.data?.id ?? ev?.id ?? 'msg',
                role: 'assistant',
                content: [{ type: 'text', content_type: 'text/plain', text_delta: txt }],
              },
            })
            // Shim de compatibilidad para SPA actual
            sse(controller, 'delta', { value: txt })
          })

          // TOOL CALL ARGUMENTS (DELTA)
          runStream.on?.('toolCallDelta', (ev: any) => {
            const id = ev?.data?.id ?? ev?.tool_call_id ?? 'tc'
            const name = ev?.data?.name || ev?.data?.function?.name || ev?.name
            const delta =
              ev?.data?.delta?.function?.arguments ??
              ev?.data?.function?.arguments ??
              ev?.arguments_delta ??
              ''
            if (!delta) return
            if (IGNORE_WS_DELTAS && onlyWs(delta)) return
            const b = (toolBuf[id] ||= { name, args: '' })
            if (name && !b.name) b.name = name
            b.args += delta
            stats.toolDeltaCount++; stats.toolDeltaBytes += delta.length
            if (LOG_TOOL_ARGS) console.log('[spa-chat:event toolCallDelta]', { traceId, id, name, deltaPreview: trunc(delta, 300) })
            sse(controller, 'tool_call.arguments.delta', { data: { id, tool_name: b.name, arguments: { delta } } })
          })

          // TOOL CALL COMPLETED
          runStream.on?.('toolCallCompleted', (ev: any) => {
            const id = ev?.data?.id ?? ev?.tool_call_id ?? 'tc'
            const name = ev?.data?.name || ev?.data?.function?.name || ev?.name
            const args =
              typeof ev?.data?.function?.arguments === 'string'
                ? ev?.data?.function?.arguments
                : typeof ev?.data?.arguments === 'string'
                ? ev?.data?.arguments
                : (toolBuf[id]?.args || '')
            stats.toolCompletedCount++; stats.toolCompletedBytes += args.length
            if (LOG_TOOL_ARGS) console.log('[spa-chat:event toolCallCompleted]', { traceId, id, name, argsPreview: trunc(args, 600) })
            sse(controller, 'tool_call.completed', { data: { id, tool_name: name, arguments: args } })
          })

          // TOOL OUTPUT (cuando el SDK lo emite)
          runStream.on?.('toolOutput', (ev: any) => {
            const id = ev?.data?.tool_call_id ?? ev?.tool_call_id ?? 'tc'
            const result = ev?.data?.output ?? ev?.output ?? null
            if (LOG_TOOL_ARGS) console.log('[spa-chat:event toolOutput]', { traceId, tool_call_id: id, resultPreview: trunc(result, 600) })
            sse(controller, 'tool_result', { data: { tool_call_id: id, result } })
          })

          // MENSAJE COMPLETO
          runStream.on?.('messageCompleted', (ev: any) => {
            const id = ev?.data?.id ?? ev?.id ?? 'msg'
            if (LOG_FULL) console.log('[spa-chat:event messageCompleted]', { traceId, id, contentPreview: trunc(ev?.data?.content, 900) })
            // Nota: aquí dejamos pasar tal cual el contenido que entrega OpenAI
            sse(controller, 'message.completed', {
              data: {
                id,
                role: 'assistant',
                content: ev?.data?.content ?? [],
              },
            })
          })

          // RUN COMPLETED / FAILED
          runStream.on?.('runCompleted', (ev: any) => {
            capture(ev, 'runCompleted')
            sse(controller, 'run.completed', { data: { id: ev?.data?.id ?? ev?.id, status: 'completed', thread_id: thread.id } })
          })
          runStream.on?.('runFailed', (ev: any) => {
            capture(ev, 'runFailed')
            const id = ev?.data?.id ?? ev?.id
            const message = ev?.data?.last_error?.message || ev?.data?.error || 'run_failed'
            sse(controller, 'run.failed', { data: { id, status: 'failed', thread_id: thread.id, error: { message } } })
          })

          runStream.on?.('end', () => {
            console.log('[spa-chat:stream.end]', {
              traceId,
              threadId: thread.id,
              runId: lastRunId,
              stats,
              tookMs: Date.now() - stats.startedAt,
            })
            sse(controller, 'done', {})
            controller.close()
          })

          runStream.on?.('error', (err: any) => {
            console.error('[spa-chat:stream.error]', { traceId, err: trunc(err, 800) })
            sse(controller, 'run.failed', { data: { id: lastRunId, status: 'failed', thread_id: thread.id, error: { message: String(err?.message || err || 'stream_error') } } })
            sse(controller, 'done', {})
            controller.close()
          })
        }

        console.log('[spa-chat:run.start]', { traceId, threadId: thread.id, assistantId: ASSISTANT_ID })
        // Stream principal
        // @ts-ignore: las firmas varían entre releases
        const runStream: any = await openai.beta.threads.runs.stream(thread.id, {
          assistant_id: ASSISTANT_ID,
        })

        await attach(runStream)

        // Algunas implementaciones exponen AsyncIterable:
        try {
          for await (const _ of runStream as AsyncIterable<any>) { /* drain */ }
        } catch {
          // ignore
        }
      } catch (err: any) {
        console.error('[spa-chat:exception]', { traceId, err: trunc(err, 1000) })
        sse(controller, 'run.failed', { data: { status: 'failed', error: { message: String(err?.message || err || 'internal_error') } } })
        sse(controller, 'done', {})
        controller.close()
      }
    },
  })

  console.log('[spa-chat:resp.ready]', { traceId })
  return new NextResponse(stream as any, { status: 200, headers })
}

// Opción preflight
export async function OPTIONS() {
  return new Response(null, { status: 204 })
}
