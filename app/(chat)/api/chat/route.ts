import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! })
const ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID!

const POLL_MS = 200
const MAX_WAIT_MS = 120000
const ACTIVE_STATUSES = new Set(['queued','in_progress','requires_action','cancelling'])

type UiPart = { type: 'text'; text: string }
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const now = () => Date.now()

function log(obj: any) {
  try { console.log('[CV][server]', JSON.stringify(obj)) }
  catch { console.log('[CV][server]', obj) }
}

async function waitForNoActiveRun(threadId: string) {
  let waited = 0
  while (waited <= MAX_WAIT_MS) {
    try {
      const runs = await client.beta.threads.runs.list(threadId, { order: 'desc', limit: 1 })
      const last = runs.data[0]
      if (!last || !ACTIVE_STATUSES.has(last.status as any)) return
    } catch (e) {
      console.warn('[CV][server] runs.list failed, proceeding:', (e as any)?.message || e)
      return
    }
    await sleep(POLL_MS)
    waited += POLL_MS
  }
}

function askedForItinerary(prompt: string) {
  return /itinerar|itinerary|ruta|plan de viaje|propuesta/i.test(prompt || '')
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
   SSE (respuesta inmediata)
   ========================= */
async function handleStream(req: NextRequest) {
  const encoder = new TextEncoder()
  const t0 = now()

  const body = await req.json()
  const incoming = body?.message as { role: 'user' | 'assistant'; parts: UiPart[] } | undefined
  let threadId: string | undefined = body?.threadId
  const userText = incoming?.parts?.[0]?.text?.trim()
  if (!userText) return new Response('empty message', { status: 400 })

  const stream = new ReadableStream({
    start: async (controller) => {
      const send = (event: string, data: any) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      }

      try {
        log({ step: 'incoming', threadId, preview: userText.slice(0, 160) })

        if (!threadId) {
          const created = await client.beta.threads.create({ metadata: { channel: 'web-embed' } })
          threadId = created.id
          log({ step: 'thread.created', threadId })
        }
        send('meta', { threadId })

        // evita 400 “run activo”
        await waitForNoActiveRun(threadId!)

        // agrega mensaje del usuario
        await client.beta.threads.messages.create(threadId!, { role: 'user', content: userText })
        log({ step: 'message.appended' })

        const instructions = [
          'Responde de inmediato; evita "un momento" o similares.',
          'Si ya hay destino + fechas/duración + nº de personas, entrega SOLO un bloque:',
          '```cv:itinerary',
          '{ JSON válido según el esquema del sistema }',
          '```',
          'Si falta un dato crítico, haz UNA sola pregunta de avance.'
        ].join('\n')

        // ---- STREAM del run ----
        // @ts-ignore: tipado laxo para eventos del SDK
        const runStream: any = await client.beta.threads.runs.stream(threadId!, {
          assistant_id: ASSISTANT_ID,
          instructions,
          metadata: { channel: 'web-embed' },
        })

        let gotDelta = false

        runStream
          .on('runCreated', (event: any) => {
            log({ step: 'run.created', runId: event?.data?.id })
          })
          .on('textDelta', (delta: any) => {
            if (delta?.value) {
              gotDelta = true
              send('delta', { value: delta.value }) // tokens → UI inmediato
            }
          })
          .on('end', async () => {
            // Al terminar el stream: envía texto final para “rellenar” si no llegaron deltas
            try {
              const msgs = await client.beta.threads.messages.list(threadId!, { order: 'desc', limit: 12 })
              const finalText = extractAssistantText(msgs.data)
              send('final', { text: finalText })

              // Fallback: si el user pidió itinerario y NO hay bloque, forzar conversión a cv:itinerary
              const hasItin = /```(?:\s*)cv:itinerary/i.test(finalText)
              if (!hasItin && askedForItinerary(userText)) {
                await client.beta.threads.messages.create(threadId!, {
                  role: 'user',
                  content:
                    'Convierte tu propuesta anterior a un ÚNICO bloque ```cv:itinerary {…}``` ' +
                    'siguiendo exactamente el esquema del sistema. Sin texto antes o después.',
                })
                // Poll rápido (sin stream) para la conversión
                const run = await client.beta.threads.runs.create(threadId!, {
                  assistant_id: ASSISTANT_ID,
                  instructions: 'Output ONLY one code block: ```cv:itinerary { JSON }```',
                })
                let status = run.status
                const start = now()
                while (true) {
                  const poll = await client.beta.threads.runs.retrieve(run.id, { thread_id: threadId! })
                  status = poll.status
                  if (['completed','failed','expired','cancelled'].includes(status)) break
                  if (now() - start > MAX_WAIT_MS) { try { await client.beta.threads.runs.cancel(run.id, { thread_id: threadId! }) } catch {}; break }
                  await sleep(POLL_MS)
                }
                const msgs2 = await client.beta.threads.messages.list(threadId!, { order: 'desc', limit: 12 })
                const text2 = extractAssistantText(msgs2.data)
                send('final', { text: text2 })
                log({ step: 'retry_forced_itinerary', ok: /```(?:\s*)cv:itinerary/i.test(text2) })
              }
            } catch (e: any) {
              send('error', { message: String(e?.message || e) })
            } finally {
              send('done', { ms: now() - t0, gotDelta })
              controller.close()
            }
          })
          .on('error', (err: any) => {
            send('error', { message: String(err?.message || err) })
            controller.close()
          })

      } catch (err: any) {
        send('error', { message: String(err?.message || err) })
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}

/* ===== Fallback JSON sin streaming (por compatibilidad) ===== */
async function handleJson(req: NextRequest) {
  const t0 = now()
  try {
    const body = await req.json()
    const incoming = body?.message as { role: 'user' | 'assistant'; parts: UiPart[] } | undefined
    let threadId: string | undefined = body?.threadId
    const userText = incoming?.parts?.[0]?.text?.trim()
    if (!userText) return NextResponse.json({ error: 'empty message' }, { status: 400 })

    log({ step: 'incoming', threadId, preview: userText.slice(0, 160) })

    if (!threadId) {
      const created = await client.beta.threads.create({ metadata: { channel: 'web-embed' } })
      threadId = created.id
      log({ step: 'thread.created', threadId })
    }

    await waitForNoActiveRun(threadId!)
    await client.beta.threads.messages.create(threadId!, { role: 'user', content: userText })
    log({ step: 'message.appended' })

    const run = await client.beta.threads.runs.create(threadId!, {
      assistant_id: ASSISTANT_ID,
      instructions: [
        'Responde de inmediato; evita "un momento" o similares.',
        'Si ya hay destino + fechas/duración + nº de personas, entrega SOLO un bloque:',
        '```cv:itinerary',
        '{ JSON válido según el esquema del sistema }',
        '```',
        'Si falta un dato crítico, haz UNA sola pregunta de avance.'
      ].join('\n'),
      metadata: { channel: 'web-embed' },
    })
    log({ step: 'run.created', runId: run.id })

    let status = run.status
    const tStart = now()
    while (true) {
      const poll = await client.beta.threads.runs.retrieve(run.id, { thread_id: threadId! })
      if (status !== poll.status) {
        status = poll.status
        log({ step: 'run.status', status })
      }
      if (['completed','failed','expired','cancelled'].includes(status)) break
      if (now() - tStart > MAX_WAIT_MS) {
        try { await client.beta.threads.runs.cancel(run.id, { thread_id: threadId! }) } catch {}
        log({ step: 'run.timeout.cancelled' })
        break
      }
      await sleep(POLL_MS)
    }

    const msgs = await client.beta.threads.messages.list(threadId!, { order: 'desc', limit: 12 })
    const reply = extractAssistantText(msgs.data)
    const hasItin = /```(?:\s*)cv:itinerary/i.test(reply)

    log({ step: 'reply.ready', hasItineraryBlock: hasItin, size: reply.length, ms: now() - t0 })
    return NextResponse.json({ threadId, reply, runStatus: status })
  } catch (err: any) {
    console.error('[CV][server] exception', err)
    return NextResponse.json({ error: String(err?.message || err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  if (req.nextUrl.searchParams.get('stream') === '1') return handleStream(req)
  return handleJson(req)
}
