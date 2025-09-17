/* eslint-disable no-console */
// app/api/spa-chat/route.ts
import type { NextRequest } from 'next/server'
import OpenAI from 'openai'

export const runtime = 'nodejs'          // ✅ Node runtime (listeners estables)
export const dynamic = 'force-dynamic'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! })
const ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID!

type ChatMsg = { role: 'user' | 'assistant' | 'system'; content: string }
type Ctl = ReadableStreamDefaultController
const enc = new TextEncoder()

function sse(controller: Ctl, event: string, data: any) {
  controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
}
function tid() { return Math.random().toString(36).slice(2) + '-' + Date.now().toString(36) }

function extractText(ev: any): string | null {
  if (!ev) return null
  if (typeof ev.value === 'string') return ev.value
  if (typeof ev.delta === 'string') return ev.delta
  if (typeof ev.textDelta === 'string') return ev.textDelta
  if (typeof ev.content === 'string') return ev.content
  if (typeof ev.answer === 'string') return ev.answer
  if (typeof ev?.delta?.text === 'string') return ev.delta.text
  const arr = ev?.delta?.content
  if (Array.isArray(arr)) {
    for (const c of arr) {
      if (typeof c?.text === 'string') return c.text
      if (typeof c?.value === 'string') return c.value
      if (typeof c?.delta === 'string') return c.delta
    }
  }
  return null
}
function extractToolDelta(ev: any): { id: string; name?: string; delta: string } | null {
  const id = ev?.id ?? ev?.tool_call_id ?? 'tc'
  const name = ev?.name ?? ev?.function?.name
  const delta =
    typeof ev?.delta === 'string' ? ev.delta
    : typeof ev?.args === 'string' ? ev.args
    : typeof ev?.arguments === 'string' ? ev.arguments
    : typeof ev?.arguments?.delta === 'string' ? ev.arguments.delta
    : typeof ev?.function?.arguments === 'string' ? ev.function.arguments
    : ''
  if (!delta) return null
  return { id, name, delta }
}
function extractToolFull(ev: any): { id: string; name?: string; args: string } | null {
  const id = ev?.id ?? ev?.tool_call_id ?? 'tc'
  const name = ev?.name ?? ev?.function?.name
  const args =
    typeof ev?.args === 'string' ? ev.args
    : typeof ev?.arguments === 'string' ? ev.arguments
    : typeof ev?.function?.arguments === 'string' ? ev.function.arguments
    : ''
  if (!args) return null
  return { id, name, args }
}

export async function POST(req: NextRequest) {
  try {
    if (!process.env.OPENAI_API_KEY) return new Response('Falta OPENAI_API_KEY', { status: 500 })
    if (!ASSISTANT_ID) return new Response('Falta OPENAI_ASSISTANT_ID', { status: 500 })

    const url = new URL(req.url)
    const DIAG = url.searchParams.get('diag') === '1' || process.env.CHAT_DIAGNOSTIC_MODE === '1'
    const LOG_FULL = process.env.LOG_FULL_EVENTS === '1'
    const traceId = tid()

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
        const log = (msg: string, extra?: any) => {
          const entry = { traceId, msg, ...(extra || {}) }
          console.log('[spa-chat]', entry)
          if (DIAG) sse(controller, 'debug', entry)
        }

        const stats = {
          startAt: Date.now(),
          endAt: 0,
          deltaCount: 0,
          deltaChars: 0,
          toolDeltaCount: 0,
          toolDeltaBytes: 0,
          toolCompletedCount: 0,
          toolCompletedBytes: 0,
          hadAnyEvent: false,
          hadCompleted: false,
          lastRunId: '' as string | undefined,
          threadId: '' as string | undefined,
        }

        try {
          log('start', { assistantId: ASSISTANT_ID, messagesCount: messages.length, lastPreview: lastUser.slice(0, 160) })
          sse(controller, 'response.start', { traceId, message: lastUser })

          // 1) Thread y mensajes
          const thread = await openai.beta.threads.create()
          stats.threadId = thread.id
          log('thread.created', { threadId: thread.id })

          for (const m of messages) {
            await openai.beta.threads.messages.create(thread.id, {
              role: m.role === 'assistant' ? 'assistant' : 'user',
              content: m.content,
            })
          }
          log('messages.loaded', { count: messages.length })

          // 2) Run + streaming
          const runStream: any = await openai.beta.threads.runs.stream(thread.id, {
            assistant_id: ASSISTANT_ID,
            stream: true,
            tool_choice: 'auto',
          })
          log('run.started')

          const toolBuf: Record<string, { name?: string; args: string }> = {}

          // Listeners explícitos
          runStream.on?.('textDelta', (ev: any) => {
            stats.hadAnyEvent = true
            const txt = extractText(ev)
            if (LOG_FULL) console.log('[spa-chat:event textDelta]', { traceId, ev })
            if (txt) {
              stats.deltaCount++; stats.deltaChars += txt.length
              sse(controller, 'delta', { value: txt })
            }
            if (DIAG) sse(controller, 'debug', { traceId, type: 'textDelta', textLen: txt?.length ?? 0 })
          })
          runStream.on?.('messageDelta', (ev: any) => {
            stats.hadAnyEvent = true
            const txt = extractText(ev)
            if (LOG_FULL) console.log('[spa-chat:event messageDelta]', { traceId, ev })
            if (txt) {
              stats.deltaCount++; stats.deltaChars += txt.length
              sse(controller, 'delta', { value: txt })
            }
            if (DIAG) sse(controller, 'debug', { traceId, type: 'messageDelta', textLen: txt?.length ?? 0 })
          })
          runStream.on?.('toolCallDelta', (ev: any) => {
            stats.hadAnyEvent = true
            if (LOG_FULL) console.log('[spa-chat:event toolCallDelta]', { traceId, ev })
            const t = extractToolDelta(ev)
            if (!t) {
              if (DIAG) sse(controller, 'debug', { traceId, type: 'toolCallDelta', note: 'no-delta' })
              return
            }
            const b = (toolBuf[t.id] ||= { name: t.name, args: '' })
            if (t.name && !b.name) b.name = t.name
            b.args += t.delta
            stats.toolDeltaCount++; stats.toolDeltaBytes += t.delta.length
            sse(controller, 'tool_call.arguments.delta', { id: t.id, name: b.name, arguments: { delta: t.delta } })
          })
          runStream.on?.('toolCallCompleted', (ev: any) => {
            stats.hadAnyEvent = true
            if (LOG_FULL) console.log('[spa-chat:event toolCallCompleted]', { traceId, ev })
            const full = extractToolFull(ev)
            if (full) {
              stats.toolCompletedCount++; stats.toolCompletedBytes += full.args.length
              stats.hadCompleted = true
              sse(controller, 'tool_call.completed', { id: full.id, name: full.name, arguments: full.args })
            } else {
              // usa buffer si el SDK no trae args completos aquí
              const id = ev?.id ?? ev?.tool_call_id ?? 'tc'
              const b = toolBuf[id]
              if (b?.args) {
                stats.toolCompletedCount++; stats.toolCompletedBytes += b.args.length
                stats.hadCompleted = true
                sse(controller, 'tool_call.completed', { id, name: b.name, arguments: b.args })
              } else if (DIAG) {
                sse(controller, 'debug', { traceId, type: 'toolCallCompleted', note: 'no-full-args' })
              }
            }
          })
          // info extra
          const infoEvents = ['messageCreated','messageCompleted','runStepCreated','runStepDelta','runStepCompleted','runCreated','runQueued','runInProgress']
          for (const evName of infoEvents) {
            runStream.on?.(evName, (ev: any) => {
              stats.hadAnyEvent = true
              if (DIAG) sse(controller, 'debug', { traceId, type: evName })
            })
          }
          runStream.on?.('end', () => {
            // handled abajo por for-await también
          })
          runStream.on?.('error', (err: any) => {
            console.error('[assistants stream error]', { traceId, err })
            sse(controller, 'error', { traceId, message: String(err) })
          })

          // ✅ CONSUME el stream (for-await asegura que realmente fluya)
          try {
            for await (const ev of runStream as AsyncIterable<any>) {
              stats.hadAnyEvent = true
              // opcional: podríamos duplicar manejo aquí, pero ya lo hicimos con listeners
              // lo dejamos como tick para “drain” del stream
            }
          } catch (iterErr: any) {
            console.error('[spa-chat:iterate error]', { traceId, iterErr })
          }

          // —— Rescate: si no hubo toolCallCompleted, intentamos sacar los tool_calls del último mensaje
          if (!stats.hadCompleted && stats.threadId) {
            try {
              const page = await openai.beta.threads.messages.list(stats.threadId, { order: 'desc', limit: 1 })
              const last = page.data?.[0]
              const toolCalls = (last?.content as any[])?.flatMap((c) => (c?.type === 'tool_call' ? [c] : [])) ?? []
              if (toolCalls.length) {
                for (const tc of toolCalls) {
                  const name = tc?.name ?? tc?.function?.name
                  const args =
                    typeof tc?.args === 'string' ? tc.args
                    : typeof tc?.arguments === 'string' ? tc.arguments
                    : typeof tc?.function?.arguments === 'string' ? tc.function.arguments
                    : ''
                  if (args) {
                    stats.toolCompletedCount++; stats.toolCompletedBytes += args.length
                    sse(controller, 'tool_call.completed', { id: tc?.id ?? 'tc', name, arguments: args })
                  }
                }
              }
            } catch (rescueErr) {
              if (DIAG) sse(controller, 'debug', { traceId, type: 'rescue.failed' })
            }
          }

          stats.endAt = Date.now()
          log('run.end', { durationMs: stats.endAt - stats.startAt })
          if (DIAG) sse(controller, 'debug', { traceId, summary: stats })
          sse(controller, 'done', { text: '' })
          controller.close()
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
