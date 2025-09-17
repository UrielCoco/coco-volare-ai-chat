/* eslint-disable no-console */
// /app/api/spa-chat/route.ts
import type { NextRequest } from 'next/server'
import OpenAI from 'openai'

export const runtime = 'edge'
export const dynamic = 'force-dynamic'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! })
const ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID!

const enc = new TextEncoder()

type Ctl = ReadableStreamDefaultController
type ChatMsg = { role: 'user' | 'assistant' | 'system'; content: string }

function mkTraceId() {
  return Math.random().toString(36).slice(2) + '-' + Date.now().toString(36)
}

function sse(controller: Ctl, event: string, data: any) {
  controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
}

function extractText(ev: any): string | null {
  if (!ev) return null
  if (typeof ev?.delta === 'string') return ev.delta             // textDelta (algunas lib)
  if (typeof ev?.textDelta === 'string') return ev.textDelta     // vercel ai sdk
  if (typeof ev?.value === 'string') return ev.value             // algunos emiten value
  if (typeof ev?.content === 'string') return ev.content
  if (typeof ev?.answer === 'string') return ev.answer
  if (typeof ev?.delta?.text === 'string') return ev.delta.text  // response.delta con delta.text
  const arr = ev?.delta?.content
  if (Array.isArray(arr)) {
    for (const c of arr) {
      if (typeof c?.text === 'string') return c.text
      if (typeof c?.value === 'string') return c.value
    }
  }
  return null
}

function extractToolArgsDelta(ev: any): string {
  if (!ev) return ''
  if (typeof ev?.delta === 'string') return ev.delta
  if (typeof ev?.args === 'string') return ev.args
  if (typeof ev?.arguments === 'string') return ev.arguments
  if (typeof ev?.arguments?.delta === 'string') return ev.arguments.delta
  if (typeof ev?.function?.arguments === 'string') return ev.function.arguments
  return ''
}

function extractToolArgsFull(ev: any): string {
  if (!ev) return ''
  if (typeof ev?.args === 'string') return ev.args
  if (typeof ev?.arguments === 'string') return ev.arguments
  if (typeof ev?.function?.arguments === 'string') return ev.function.arguments
  return ''
}

export async function POST(req: NextRequest) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return new Response('Falta OPENAI_API_KEY', { status: 500 })
    }
    if (!ASSISTANT_ID) {
      return new Response('Falta OPENAI_ASSISTANT_ID', { status: 500 })
    }

    const url = new URL(req.url)
    const DIAG = url.searchParams.get('diag') === '1' || process.env.CHAT_DIAGNOSTIC_MODE === '1'
    const LOG_FULL = process.env.LOG_FULL_EVENTS === '1'
    const traceId = mkTraceId()

    const body = await req.json().catch(() => ({} as { messages?: ChatMsg[] }))
    const messages = (body?.messages ?? []) as ChatMsg[]
    const lastUser = messages.filter(m => m.role === 'user').at(-1)?.content ?? ''

    const headers = new Headers({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'x-trace-id': traceId,
    })

    const stream = new ReadableStream({
      start: async (controller) => {
        // logger con correlación (aparece en Vercel logs)
        const clog = (msg: string, extra?: any) => {
          const entry = { traceId, msg, ...(extra || {}) }
          console.log('[spa-chat]', entry)
          if (DIAG) sse(controller, 'debug', entry)
        }

        // métricas
        const stats = {
          deltaCount: 0,
          deltaChars: 0,
          toolDeltaCount: 0,
          toolDeltaBytes: 0,
          toolCompletedCount: 0,
          toolCompletedBytes: 0,
          startAt: Date.now(),
          endAt: 0,
          assistantId: ASSISTANT_ID,
        }

        try {
          clog('start', {
            assistantId: ASSISTANT_ID,
            messagesCount: messages.length,
            lastPreview: lastUser.slice(0, 160),
          })
          sse(controller, 'response.start', { traceId, message: lastUser })

          // 1) Crea thread (si luego quieres contexto persistente, guarda thread.id en cookie/kv)
          const thread = await openai.beta.threads.create()
          clog('thread.created', { threadId: thread.id })

          // 2) Sube historial (user o assistant). Los 'system' no aplican en threads
          for (const m of messages) {
            const role = m.role === 'assistant' ? 'assistant' : 'user'
            await openai.beta.threads.messages.create(thread.id, { role, content: m.content })
          }
          clog('messages.loaded', { count: messages.length })

          // 3) Run con streaming
          const runStream: any = await openai.beta.threads.runs.stream(thread.id, {
            assistant_id: ASSISTANT_ID,
            stream: true,
            tool_choice: 'auto',
          })
          clog('run.started')

          // buffers por tool id para acumular args
          const toolBuf: Record<string, { name?: string; args: string }> = {}

          const onAnyEvent = (ev: any) => {
            const t = ev?.type ?? 'unknown'

            // Log a consola (Vercel): compacto + opcional raw completo
            if (LOG_FULL) {
              console.log('[spa-chat:event]', { traceId, type: t, raw: ev })
            } else {
              // resumen “saludable” para no saturar logs
              const txt = extractText(ev)
              const d = extractToolArgsDelta(ev)
              const full = extractToolArgsFull(ev)
              console.log('[spa-chat:event]', {
                traceId,
                type: t,
                textLen: txt ? txt.length : 0,
                toolDeltaLen: d ? d.length : 0,
                toolFullLen: full ? full.length : 0,
                name: ev?.name ?? ev?.function?.name,
                id: ev?.id ?? ev?.tool_call_id,
              })
            }

            // debug por SSE (si DIAG)
            if (DIAG) sse(controller, 'debug', { traceId, type: t, raw: ev })

            // Texto incremental → event: delta
            const txt = extractText(ev)
            if (txt) {
              stats.deltaCount++
              stats.deltaChars += txt.length
              sse(controller, 'delta', { value: txt })
            }

            // Tool args (delta y completed) → events de tu front
            const isToolish = t.includes('tool') || t.includes('function') || ev?.id || ev?.function || ev?.name
            if (isToolish) {
              const id = ev?.id ?? ev?.tool_call_id ?? 'tc'
              const name = ev?.name ?? ev?.function?.name
              const d = extractToolArgsDelta(ev)
              if (d) {
                const b = (toolBuf[id] ||= { name, args: '' })
                if (name && !b.name) b.name = name
                b.args += d
                stats.toolDeltaCount++
                stats.toolDeltaBytes += d.length
                sse(controller, 'tool_call.arguments.delta', { id, name: b.name, arguments: { delta: d } })
              }
              const full = extractToolArgsFull(ev)
              if (full) {
                stats.toolCompletedCount++
                stats.toolCompletedBytes += full.length
                sse(controller, 'tool_call.completed', { id, name, arguments: full })
              }
            }
          }

          if (typeof runStream?.on === 'function') {
            // SDK con EventEmitter
            runStream.on('event', onAnyEvent)
            runStream.on('end', () => {
              stats.endAt = Date.now()
              clog('run.end', { durationMs: stats.endAt - stats.startAt })
              sse(controller, 'debug', { traceId, summary: stats })
              sse(controller, 'done', { text: '' })
              controller.close()
            })
            runStream.on('error', (err: any) => {
              stats.endAt = Date.now()
              console.error('[assistants stream error]', { traceId, err })
              sse(controller, 'error', { traceId, message: String(err) })
              try { controller.close() } catch {}
            })
          } else {
            // Fallback: AsyncIterable
            for await (const ev of runStream as AsyncIterable<any>) {
              onAnyEvent(ev)
            }
            stats.endAt = Date.now()
            clog('run.end', { durationMs: stats.endAt - stats.startAt })
            sse(controller, 'debug', { traceId, summary: stats })
            sse(controller, 'done', { text: '' })
            controller.close()
          }
        } catch (err: any) {
          console.error('[spa-chat:route error]', { traceId, err })
          sse(controller, 'error', { traceId, message: String(err) })
          try { controller.close() } catch {}
        }
      },
    })

    return new Response(stream, { status: 200, headers })
  } catch (e: any) {
    return new Response(`Bad Request: ${e?.message || e}`, { status: 400 })
  }
}
