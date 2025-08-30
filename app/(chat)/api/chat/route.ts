import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'

/**
 * Coco Volare · Chat Stream (LIGHT)
 * - Conversación fluida con Assistants
 * - SSE real con keepalive + watchdog
 * - SIN forzar itinerario (solo si el usuario lo pide o ya hay contexto)
 * - Logs útiles para Vercel (latencias, tamaños, estados)
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! })
const ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID!

// Tiempos
const POLL_MS = 250                  // polling runs (fallback JSON)
const MAX_WAIT_MS = 120_000          // tope duro de una respuesta
const IDLE_FALLBACK_MS = 25_000      // si no llegan tokens, se cierra con dignidad
const PING_MS = 12_000               // SSE keepalive: evita timeouts intermedios

const ACTIVE = new Set(['queued','in_progress','requires_action','cancelling'])

type UiPart = { type: 'text'; text: string }

const now = () => Date.now()
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const rid = () => `cv_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`

function jlog(event: string, meta: any = {}) {
  try { console.log(JSON.stringify({ tag: '[CV][server]', event, ...meta })) } catch { console.log('[CV][server]', event, meta) }
}

async function waitForNoActiveRun(threadId: string) {
  let waited = 0
  while (waited <= MAX_WAIT_MS) {
    try {
      const runs = await client.beta.threads.runs.list(threadId, { order: 'desc', limit: 1 })
      const last = runs.data[0]
      if (!last || !ACTIVE.has(last.status as any)) return
    } catch (e) {
      jlog('runs.list.error', { message: (e as any)?.message || String(e) })
      return
    }
    await sleep(POLL_MS)
    waited += POLL_MS
  }
}

function askedForItinerary(s: string) {
  return /\b(itinerar(?:io|y)|itinerary|cv:itinerary|dame\s+.*itinerario|itinerario\s+detallado)\b/i.test(s || '')
}
function isConfirmation(s: string) {
  return /\b(s[ií]|va|ok|okay|de acuerdo|perfecto|claro|hazlo|adelante|proced[e|e]|arm[a|e]lo|haz el itinerario)\b/i.test(s || '')
}

function extractAssistantText(messages: any[]) {
  const firstAssistant = messages.find((m: any) => m.role === 'assistant')
  const reply =
    firstAssistant?.content
      ?.filter((c: any) => c?.type === 'text' && c?.text?.value)
      .map((c: any) => c.text.value as string)
      .join('\n') ?? ''
  return reply
}

/* =========================
   SSE (recomendado)
   ========================= */
async function handleStream(req: NextRequest) {
  const traceId = req.headers.get('x-trace-id') || rid()
  const encoder = new TextEncoder()
  const t0 = now()

  const body = await req.json().catch(() => ({}))
  const incoming = body?.message as { role: 'user' | 'assistant'; parts: UiPart[] } | undefined
  let threadId: string | undefined = body?.threadId
  const userText = incoming?.parts?.[0]?.text?.trim() || ''

  if (!userText) {
    jlog('skip.empty', { traceId })
    return new Response('', { status: 204 })
  }

  const stream = new ReadableStream({
    start: async (controller) => {
      const send = (event: string, data: any) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      }
      const ping = () => controller.enqueue(encoder.encode(`: ping\n\n`))

      try {
        jlog('recv', { traceId, preview: userText.slice(0, 140) })

        // Asegura thread
        if (!threadId) {
          const t = await client.beta.threads.create({ metadata: { channel: 'web-embed' } })
          threadId = t.id
        }
        send('meta', { threadId })
        jlog('thread.ready', { traceId, threadId })

        // Evita 400 "Can't add messages ... while a run is active"
        await waitForNoActiveRun(threadId!)

        // Agrega mensaje de usuario
        await client.beta.threads.messages.create(threadId!, { role: 'user', content: userText })
        jlog('message.appended', { traceId })

        // Decide si "sugerir" (no forzar) instructions de itinerario
        const forceItin = askedForItinerary(userText) || isConfirmation(userText)
        const instructions = forceItin
          ? [
              'Si el usuario pide el itinerario explícitamente y ya hay datos suficientes, responde EXCLUSIVAMENTE con:',
              '```cv:itinerary',
              '{ JSON válido y completo según el esquema del sistema }',
              '```',
              'Si aún faltan datos, pregunta puntualmente y conversa normal.',
            ].join('\n')
          : undefined

        // Stream de OpenAI Assistants
        // @ts-ignore: sdk stream emitter sin tipado detallado
        const runStream: any = await client.beta.threads.runs.stream(threadId!, {
          assistant_id: ASSISTANT_ID,
          instructions,
          metadata: { channel: 'web-embed' },
        })

        let lastTokenAt = now()
        let firstDeltaMs: number | null = null

        const watchdog = setInterval(() => {
          if (now() - lastTokenAt > IDLE_FALLBACK_MS) {
            jlog('idle.fallback', { traceId, idle_ms: now() - lastTokenAt })
            clearInterval(watchdog)
            keepAlive?.()
            controller.close()
          } else {
            ping()
          }
        }, PING_MS)

        const keepAlive = () => clearInterval(watchdog)

        runStream
          .on('textDelta', (delta: any) => {
            if (firstDeltaMs == null) {
              firstDeltaMs = now() - t0
              jlog('first.delta', { traceId, ms: firstDeltaMs })
            }
            lastTokenAt = now()
            send('delta', { value: delta.value })
          })
          .on('messageCompleted', () => {
            // no-op; el cierre se hace en 'end'
          })
          .on('runStepCreated', (e: any) => jlog('run.step.created', { traceId, type: e?.type }))
          .on('error', (err: any) => {
            jlog('stream.error', { traceId, err: String(err?.message || err) })
            send('error', { message: String(err?.message || err) })
          })
          .on('end', async () => {
            keepAlive()
            try {
              const msgs = await client.beta.threads.messages.list(threadId!, { order: 'desc', limit: 12 })
              const finalText = extractAssistantText(msgs.data)
              const hasItin = /```(?:\s*)cv:itinerary/i.test(finalText)
              jlog('stream.end.snapshot', {
                traceId,
                hasItinerary: hasItin,
                size: finalText.length,
                preview: finalText.slice(0, 160),
              })
              send('final', { text: finalText })
            } catch (e: any) {
              send('error', { message: String(e?.message || e) })
            } finally {
              send('done', {
                ms: now() - t0,
                first_delta_ms: firstDeltaMs,
                idleFallback: false,
              })
              controller.close()
            }
          })
      } catch (e: any) {
        jlog('exception', { traceId, err: String(e?.message || e) })
        send('error', { message: String(e?.message || e) })
        send('done', { ms: now() - t0, first_delta_ms: null, idleFallback: false })
        controller.close()
      }
    },
    cancel() {
      jlog('client.cancel')
    },
  })

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}

/* =========================
   JSON (fallback no-stream)
   ========================= */
async function handleJson(req: NextRequest) {
  const t0 = now()
  const body = await req.json().catch(() => ({}))
  const incoming = body?.message as { role: 'user' | 'assistant'; parts: UiPart[] } | undefined
  let threadId: string | undefined = body?.threadId
  const userText = incoming?.parts?.[0]?.text?.trim() || ''

  if (!userText) return NextResponse.json({ ok: true, skipped: 'empty' }, { status: 200 })

  try {
    if (!threadId) {
      const t = await client.beta.threads.create({ metadata: { channel: 'web-embed' } })
      threadId = t.id
    }

    await waitForNoActiveRun(threadId!)
    await client.beta.threads.messages.create(threadId!, { role: 'user', content: userText })

    const forceItin = askedForItinerary(userText) || isConfirmation(userText)
    const instructions = forceItin
      ? [
          'Si el usuario pide el itinerario y ya hay datos suficientes, responde EXCLUSIVAMENTE con el bloque:',
          '```cv:itinerary',
          '{ JSON válido y completo según el esquema del sistema }',
          '```',
          'Si aún faltan datos, pregunta puntualmente.',
        ].join('\n')
      : undefined

    const run = await client.beta.threads.runs.create(threadId!, {
      assistant_id: ASSISTANT_ID,
      instructions,
      metadata: { channel: 'web-embed' },
    })

    let status = run.status
    const tStart = now()
    while (true) {
      const poll = await client.beta.threads.runs.retrieve(run.id, { thread_id: threadId! })
      if (status !== poll.status) {
        status = poll.status
        jlog('run.status', { status })
      }
      if (['completed','failed','expired','cancelled'].includes(status)) break
      if (now() - tStart > MAX_WAIT_MS) {
        try { await client.beta.threads.runs.cancel(run.id, { thread_id: threadId! }) } catch {}
        jlog('run.timeout.cancelled')
        break
      }
      await sleep(POLL_MS)
    }

    const msgs = await client.beta.threads.messages.list(threadId!, { order: 'desc', limit: 12 })
    const reply = extractAssistantText(msgs.data)
    const hasItin = /```(?:\s*)cv:itinerary/i.test(reply)
    jlog('reply.ready', {
      ms: now() - t0,
      hasItinerary: hasItin,
      size: reply.length,
      preview: reply.slice(0, 160),
    })
    return NextResponse.json({ threadId, reply, runStatus: status })
  } catch (err: any) {
    jlog('exception', { err: String(err?.message || err) })
    return NextResponse.json({ error: String(err?.message || err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  if (req.nextUrl.searchParams.get('stream') === '1') return handleStream(req)
  return handleJson(req)
}
