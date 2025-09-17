/* eslint-disable no-console */
// app/api/spa-chat/route.ts
import type { NextRequest } from 'next/server'
import OpenAI from 'openai'

export const runtime = 'nodejs'          // Node: listeners estables
export const dynamic = 'force-dynamic'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! })
const ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID!

type ChatMsg = { role: 'user' | 'assistant' | 'system'; content: string }
type Ctl = ReadableStreamDefaultController
const enc = new TextEncoder()

const LOG_FULL = process.env.LOG_FULL_EVENTS === '1'
const LOG_TOOL_ARGS = process.env.LOG_TOOL_ARGS === '1'
const DIAG_ALWAYS = process.env.CHAT_DIAGNOSTIC_MODE === '1'

function sse(controller: Ctl, event: string, data: any) {
  controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
}
function tid() { return Math.random().toString(36).slice(2) + '-' + Date.now().toString(36) }

function textFrom(ev: any): string | null {
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
const toolDeltaFrom = (ev: any) => {
  const id = ev?.id ?? ev?.tool_call_id ?? 'tc'
  const name = ev?.name ?? ev?.function?.name
  const delta =
    typeof ev?.delta === 'string' ? ev.delta :
    typeof ev?.args === 'string' ? ev.args :
    typeof ev?.arguments === 'string' ? ev.arguments :
    typeof ev?.arguments?.delta === 'string' ? ev.arguments.delta :
    typeof ev?.function?.arguments === 'string' ? ev.function.arguments : ''
  return delta ? { id, name, delta } : null
}
const toolFullFrom = (ev: any) => {
  const id = ev?.id ?? ev?.tool_call_id ?? 'tc'
  const name = ev?.name ?? ev?.function?.name
  const args =
    typeof ev?.args === 'string' ? ev.args :
    typeof ev?.arguments === 'string' ? ev.arguments :
    typeof ev?.function?.arguments === 'string' ? ev.function.arguments : ''
  return args ? { id, name, args } : null
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

export async function POST(req: NextRequest) {
  if (!process.env.OPENAI_API_KEY) return new Response('Falta OPENAI_API_KEY', { status: 500 })
  if (!ASSISTANT_ID) return new Response('Falta OPENAI_ASSISTANT_ID', { status: 500 })

  const url = new URL(req.url)
  const DIAG = url.searchParams.get('diag') === '1' || DIAG_ALWAYS
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
        console.log('[spa-chat]', entry)           // Logs en Vercel
        if (DIAG) sse(controller, 'debug', entry)  // y por SSE si quieres verlos en el cliente
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
      }
      const toolBuf: Record<string, { name?: string; args: string }> = {}

      async function attachListeners(runStream: any, threadId: string) {
        // Texto
        runStream.on?.('textDelta', (ev: any) => {
          const txt = textFrom(ev)
          if (LOG_FULL) console.log('[spa-chat:event textDelta]', { traceId, ev })
          if (txt) { stats.deltaCount++; stats.deltaChars += txt.length; sse(controller, 'delta', { value: txt }) }
          if (DIAG) sse(controller, 'debug', { traceId, type: 'textDelta', textLen: txt?.length ?? 0 })
        })
        runStream.on?.('messageDelta', (ev: any) => {
          const txt = textFrom(ev)
          if (LOG_FULL) console.log('[spa-chat:event messageDelta]', { traceId, ev })
          if (txt) { stats.deltaCount++; stats.deltaChars += txt.length; sse(controller, 'delta', { value: txt }) }
          if (DIAG) sse(controller, 'debug', { traceId, type: 'messageDelta', textLen: txt?.length ?? 0 })
        })

        // Tool delta
        runStream.on?.('toolCallDelta', (ev: any) => {
          const t = toolDeltaFrom(ev)
          if (LOG_FULL) console.log('[spa-chat:event toolCallDelta]', { traceId, ev })
          if (!t) { if (DIAG) sse(controller, 'debug', { traceId, type: 'toolCallDelta', note: 'no-delta' }); return }
          const b = (toolBuf[t.id] ||= { name: t.name, args: '' })
          if (t.name && !b.name) b.name = t.name
          b.args += t.delta
          stats.toolDeltaCount++; stats.toolDeltaBytes += t.delta.length
          sse(controller, 'tool_call.arguments.delta', { id: t.id, name: b.name, arguments: { delta: t.delta } })
        })

        // Tool full
        runStream.on?.('toolCallCompleted', (ev: any) => {
          const full = toolFullFrom(ev)
          if (LOG_FULL) console.log('[spa-chat:event toolCallCompleted]', { traceId, ev })
          if (full) {
            stats.toolCompletedCount++; stats.toolCompletedBytes += full.args.length
            if (LOG_TOOL_ARGS) console.log('[spa-chat:tool args]', { traceId, id: full.id, name: full.name, args: full.args })
            sse(controller, 'tool_call.completed', { id: full.id, name: full.name, arguments: full.args })
          } else {
            const id = ev?.id ?? ev?.tool_call_id ?? 'tc'
            const b = toolBuf[id]
            if (b?.args) {
              stats.toolCompletedCount++; stats.toolCompletedBytes += b.args.length
              if (LOG_TOOL_ARGS) console.log('[spa-chat:tool args (buffer)]', { traceId, id, name: b.name, args: b.args })
              sse(controller, 'tool_call.completed', { id, name: b.name, arguments: b.args })
            }
          }
        })

        // requires_action → emite completed + reanuda el run (stream si existe, fallback sin stream)
        runStream.on?.('requires_action', async (ev: any) => {
          const runId = ev?.data?.id ?? ev?.run_id ?? ev?.id
          const calls = ev?.data?.required_action?.submit_tool_outputs?.tool_calls
            ?? ev?.required_action?.submit_tool_outputs?.tool_calls
            ?? ev?.tool_calls
            ?? []

          if (DIAG) sse(controller, 'debug', { traceId, type: 'requires_action', toolCalls: calls?.length ?? 0 })

          const outputs: Array<{ tool_call_id: string; output: string }> = []
          for (const c of calls) {
            const id = c?.id ?? c?.tool_call_id ?? 'tc'
            const name = c?.function?.name ?? c?.name
            const args =
              typeof c?.function?.arguments === 'string' ? c.function.arguments :
              typeof c?.arguments === 'string' ? c.arguments : ''

            // manda al cliente el JSON COMPLETO para que tu SPA lo mergee
            if (args) {
              stats.toolCompletedCount++; stats.toolCompletedBytes += args.length
              if (LOG_TOOL_ARGS) console.log('[spa-chat:tool args (requires_action)]', { traceId, id, name, args })
              sse(controller, 'tool_call.completed', { id, name, arguments: args })
            } else {
              const b = toolBuf[id]
              if (b?.args) {
                stats.toolCompletedCount++; stats.toolCompletedBytes += b.args.length
                if (LOG_TOOL_ARGS) console.log('[spa-chat:tool args (buffer|requires_action)]', { traceId, id, name: b.name, args: b.args })
                sse(controller, 'tool_call.completed', { id, name: b.name, arguments: b.args })
              }
            }

            // responde dummy para reanudar
            outputs.push({ tool_call_id: id, output: JSON.stringify({ status: 'applied' }) })
          }

          if (outputs.length) {
            const runsAny = (openai.beta.threads.runs as any)

            if (typeof runsAny.submitToolOutputsStream === 'function') {
              // ✅ SDK nuevo con stream
              const resumed: any = await runsAny.submitToolOutputsStream(threadId, runId, { tool_outputs: outputs } as any)
              await attachListeners(resumed, threadId)
              try { for await (const _ of resumed as AsyncIterable<any>) { /* drain */ } } catch {/* ignore */}
            } else {
              // ♻️ SDK viejo: sin stream → submit + polling
              await openai.beta.threads.runs.submitToolOutputs(threadId, runId, { tool_outputs: outputs } as any)
              // Poll hasta que termine (o falle/expire)
              while (true) {
                const run = await openai.beta.threads.runs.retrieve(threadId, runId)
                const st = run.status as string
                if (['completed', 'cancelled', 'failed', 'expired'].includes(st)) break
                await sleep(800)
              }
            }
          }
        })

        // Errores
        runStream.on?.('error', (err: any) => {
          console.error('[assistants stream error]', { traceId, err })
          sse(controller, 'error', { traceId, message: String(err) })
        })
      }

      try {
        log('start', { assistantId: ASSISTANT_ID, messagesCount: messages.length, lastPreview: lastUser.slice(0, 160) })
        sse(controller, 'response.start', { traceId, message: lastUser })

        // 1) Thread + historial
        const thread = await openai.beta.threads.create()
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

        await attachListeners(runStream, thread.id)

        // drenar stream principal (algunos runtimes no emiten si no iteras)
        try { for await (const _ of runStream as AsyncIterable<any>) { /* drain */ } } catch (iterErr: any) {
          console.error('[spa-chat:iterate error]', { traceId, iterErr })
        }

        // cierre
        const statsEnd = { ...stats, endAt: Date.now() }
        console.log('[spa-chat]', { traceId, msg: 'run.end', durationMs: statsEnd.endAt - statsEnd.startAt, stats: statsEnd })
        if (DIAG) sse(controller, 'debug', { traceId, summary: statsEnd })
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
}
