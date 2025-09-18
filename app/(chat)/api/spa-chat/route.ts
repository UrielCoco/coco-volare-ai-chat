/* eslint-disable no-console */
// app/api/spa-chat/route.ts
import type { NextRequest } from 'next/server'
import OpenAI from 'openai'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! })
const ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID!

type ChatMsg = { role: 'user' | 'assistant' | 'system'; content: string }
type Ctl = ReadableStreamDefaultController
const enc = new TextEncoder()

const LOG_FULL = process.env.LOG_FULL_EVENTS === '1'
const LOG_TOOL_ARGS = process.env.LOG_TOOL_ARGS === '1'
const DIAG_ALWAYS = process.env.CHAT_DIAGNOSTIC_MODE === '1'
const IGNORE_WS_DELTAS = (process.env.IGNORE_WS_DELTAS ?? '1') !== '0'

const onlyWs = (s?: string) => !s || /^\s+$/.test(s)
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const tid = () => Math.random().toString(36).slice(2) + '-' + Date.now().toString(36)

function sse(ctrl: Ctl, event: string, data: any) {
  ctrl.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
}

/* ---------- Helpers de compatibilidad con firmas viejas/nuevas del SDK ---------- */
const runsApi = () => (openai.beta.threads.runs as any)

async function runsListNewest(threadId: string) {
  const api = runsApi()
  try { return await api.list(threadId, { order: 'desc', limit: 1 }) } catch {}
  try { return await api.list({ thread_id: threadId, order: 'desc', limit: 1 }) } catch {}
  // fallback neutral
  return { data: [] }
}
async function runRetrieve(threadId: string, runId: string) {
  const api = runsApi()
  try { return await api.retrieve(threadId, runId) } catch {}
  try { return await api.retrieve(threadId, { run_id: runId }) } catch {}
  try { return await api.retrieve({ thread_id: threadId, run_id: runId }) } catch {}
  // último intento
  return await (openai.beta.threads.runs as any).retrieve(threadId as any, runId as any)
}
async function submitToolOutputsCompat(threadId: string, runId: string, tool_outputs: any[]) {
  const api = runsApi()
  if (typeof api.submitToolOutputsStream === 'function') {
    const resumed = await api.submitToolOutputsStream(threadId, runId, { tool_outputs } as any)
    return { resumed, streaming: true }
  }
  await api.submitToolOutputs(threadId, runId, { tool_outputs } as any)
  return { resumed: null, streaming: false }
}
/* ------------------------------------------------------------------------------- */

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
  const maybeTool =
    ev?.type?.includes('tool') || ev?.name || ev?.function?.name || ev?.tool_call_id || ev?.id ||
    ev?.arguments || ev?.args || ev?.function?.arguments
  if (!maybeTool) return null
  const id = ev?.id ?? ev?.tool_call_id ?? 'tc'
  const name = ev?.name ?? ev?.function?.name
  const delta =
    typeof ev?.delta === 'string' ? ev.delta :
    typeof ev?.args === 'string' ? ev.args :
    typeof ev?.arguments === 'string' ? ev.arguments :
    typeof ev?.arguments?.delta === 'string' ? ev.arguments.delta :
    typeof ev?.function?.arguments === 'string' ? ev.function.arguments : ''
  return delta !== '' ? { id, name, delta } : null
}
const toolFullFrom = (ev: any) => {
  const id = ev?.id ?? ev?.tool_call_id ?? 'tc'
  const name = ev?.name ?? ev?.function?.name
  const args =
    typeof ev?.args === 'string' ? ev.args :
    typeof ev?.arguments === 'string' ? ev.arguments :
    typeof ev?.function?.arguments === 'string' ? ev.function.arguments : ''
  return args !== '' ? { id, name, args } : null
}

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

  let threadId: string | undefined
  let lastRunId: string | undefined

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
      }
      const toolBuf: Record<string, { name?: string; args: string }> = {}

      async function attach(runStream: any) {
        // Guarda el runId en todos los momentos posibles
        const capture = (ev: any, label: string) => {
          const id = ev?.data?.id ?? ev?.id
          if (id) lastRunId = id
          if (DIAG) sse(controller, 'debug', { traceId, type: label, runId: id })
        }
        runStream.on?.('runCreated', (ev: any) => capture(ev, 'runCreated'))
        runStream.on?.('runQueued', (ev: any) => capture(ev, 'runQueued'))
        runStream.on?.('runInProgress', (ev: any) => capture(ev, 'runInProgress'))

        runStream.on?.('textDelta', (ev: any) => {
          const txt = textFrom(ev)
          if (LOG_FULL) console.log('[spa-chat:event textDelta]', { traceId, ev })
          if (txt && !(IGNORE_WS_DELTAS && onlyWs(txt))) {
            stats.deltaCount++; stats.deltaChars += txt.length
            sse(controller, 'delta', { value: txt })
          }
        })
        runStream.on?.('messageDelta', (ev: any) => {
          const txt = textFrom(ev)
          if (LOG_FULL) console.log('[spa-chat:event messageDelta]', { traceId, ev })
          if (txt && !(IGNORE_WS_DELTAS && onlyWs(txt))) {
            stats.deltaCount++; stats.deltaChars += txt.length
            sse(controller, 'delta', { value: txt })
          }
        })

        runStream.on?.('toolCallDelta', (ev: any) => {
          if (LOG_FULL) console.log('[spa-chat:event toolCallDelta]', { traceId, ev })
          const t = toolDeltaFrom(ev)
          if (!t) return
          if (IGNORE_WS_DELTAS && onlyWs(t.delta)) return
          const b = (toolBuf[t.id] ||= { name: t.name, args: '' })
          if (t.name && !b.name) b.name = t.name
          b.args += t.delta
          stats.toolDeltaCount++; stats.toolDeltaBytes += t.delta.length
          sse(controller, 'tool_call.arguments.delta', { id: t.id, name: b.name, arguments: { delta: t.delta } })
        })

        runStream.on?.('toolCallCompleted', (ev: any) => {
          if (LOG_FULL) console.log('[spa-chat:event toolCallCompleted]', { traceId, ev })
          const full = toolFullFrom(ev)
          if (full) {
            stats.toolCompletedCount++; stats.toolCompletedBytes += full.args.length
            if (LOG_TOOL_ARGS) console.log('[spa-chat:tool args]', { traceId, id: full.id, name: full.name, args: full.args })
            sse(controller, 'tool_call.completed', { id: full.id, name: full.name, arguments: full.args })
          } else {
            const id = ev?.id ?? ev?.tool_call_id ?? 'tc'
            const b = toolBuf[id]
            if (b?.args && !(IGNORE_WS_DELTAS && onlyWs(b.args))) {
              stats.toolCompletedCount++; stats.toolCompletedBytes += b.args.length
              if (LOG_TOOL_ARGS) console.log('[spa-chat:tool args (buffer)]', { traceId, id, name: b.name, args: b.args })
              sse(controller, 'tool_call.completed', { id, name: b.name, arguments: b.args })
            }
          }
        })

        runStream.on?.('requires_action', async (ev: any) => {
          const runId = ev?.data?.id ?? ev?.run_id ?? ev?.id ?? lastRunId
          const calls =
            ev?.data?.required_action?.submit_tool_outputs?.tool_calls
            ?? ev?.required_action?.submit_tool_outputs?.tool_calls
            ?? ev?.tool_calls
            ?? []

          const outputs: Array<{ tool_call_id: string; output: string }> = []
          for (const c of calls) {
            const id = c?.id ?? c?.tool_call_id ?? 'tc'
            const name = c?.function?.name ?? c?.name
            const args =
              typeof c?.function?.arguments === 'string' ? c.function.arguments :
              typeof c?.arguments === 'string' ? c.arguments : ''
            const bufArgs = toolBuf[id]?.args
            const finalArgs = args || bufArgs || ''

            if (finalArgs && !(IGNORE_WS_DELTAS && onlyWs(finalArgs))) {
              stats.toolCompletedCount++; stats.toolCompletedBytes += finalArgs.length
              if (LOG_TOOL_ARGS) console.log('[spa-chat:tool args (requires_action)]', { traceId, id, name, args: finalArgs })
              sse(controller, 'tool_call.completed', { id, name, arguments: finalArgs })
            }
            outputs.push({ tool_call_id: id, output: JSON.stringify({ status: 'applied' }) })
          }

          if (outputs.length && runId && threadId) {
            const { resumed, streaming } = await submitToolOutputsCompat(threadId, runId, outputs)
            if (streaming && resumed) {
              await attach(resumed)
              try { for await (const _ of resumed as AsyncIterable<any>) { /* drain */ } } catch {}
            } else {
              // polling hasta terminar
              let tries = 0
              while (tries++ < 60) {
                const run = await runRetrieve(threadId, runId)
                if (['completed','cancelled','failed','expired'].includes(run.status as string)) break
                await sleep(900)
              }
            }
          } else {
            console.log('[spa-chat]', { traceId, msg: 'requires_action.skip', haveThread: !!threadId, haveRun: !!runId, outputs: outputs.length })
          }
        })

        runStream.on?.('error', (err: any) => {
          console.error('[assistants stream error]', { traceId, err })
          sse(controller, 'error', { traceId, message: String(err) })
        })
      }

      try {
        console.log('[spa-chat]', { traceId, msg: 'start', assistantId: ASSISTANT_ID, messagesCount: messages.length, lastPreview: lastUser.slice(0,160) })
        sse(controller, 'response.start', { traceId, message: lastUser })

        // Thread + historial
        const thread = await openai.beta.threads.create()
        threadId = thread.id
        console.log('[spa-chat]', { traceId, msg: 'thread.created', threadId })
        for (const m of messages) {
          await openai.beta.threads.messages.create(thread.id, { role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })
        }
        console.log('[spa-chat]', { traceId, msg: 'messages.loaded', count: messages.length })

        // Run (stream)
        const runStream: any = await openai.beta.threads.runs.stream(thread.id, {
          assistant_id: ASSISTANT_ID,
          stream: true,
          tool_choice: 'auto',
        })
        console.log('[spa-chat]', { traceId, msg: 'run.started' })
        await attach(runStream)

        // Drenar (necesario para que fluya en algunos runtimes)
        try { for await (const _ of runStream as AsyncIterable<any>) { /* drain */ } } catch (iterErr: any) {
          console.error('[spa-chat:iterate error]', { traceId, iterErr })
        }

        /* ---------------------- RESCATE FINAL ULTRA-ROBUSTO ---------------------- */
        try {
          const observed = { threadId, lastRunId }
          console.log('[spa-chat]', { traceId, msg: 'rescue.inspect', observed })

          // 1) Asegura threadId
          const tId = threadId
          if (!tId) {
            console.log('[spa-chat]', { traceId, msg: 'rescue.skip', reason: 'no-threadId' })
          } else {
            // 2) Asegura runId
            let rId = lastRunId
            if (!rId) {
              const list = await runsListNewest(tId)
              rId = list?.data?.[0]?.id
              console.log('[spa-chat]', { traceId, msg: 'rescue.list', foundRunId: rId })
            }

            if (tId && rId) {
              const run = await runRetrieve(tId, rId)
              console.log('[spa-chat]', { traceId, msg: 'rescue.run', status: run.status, runId: rId })

              if (run.status === 'requires_action') {
                const calls = (run.required_action as any)?.submit_tool_outputs?.tool_calls ?? []
                for (const c of calls) {
                  const id = c?.id ?? c?.tool_call_id ?? 'tc'
                  const name = c?.function?.name ?? c?.name
                  const args = typeof c?.function?.arguments === 'string' ? c.function.arguments : ''
                  if (args && !(IGNORE_WS_DELTAS && onlyWs(args))) {
                    stats.toolCompletedCount++; stats.toolCompletedBytes += args.length
                    if (LOG_TOOL_ARGS) console.log('[spa-chat:tool args (rescue.run)]', { traceId, id, name, args })
                    sse(controller, 'tool_call.completed', { id, name, arguments: args })
                  }
                }
              }
            } else {
              console.log('[spa-chat]', { traceId, msg: 'rescue.skip', reason: 'missing-ids', threadId: tId, runId: rId })
            }
          }
        } catch (rescueErr) {
          console.error('[spa-chat:rescue error]', { traceId, rescueErr })
        }
        /* ------------------------------------------------------------------------ */

        stats.endAt = Date.now()
        console.log('[spa-chat]', { traceId, msg: 'run.end', durationMs: stats.endAt - stats.startAt, stats })
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
}
