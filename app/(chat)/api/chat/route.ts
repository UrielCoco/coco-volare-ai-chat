import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// --- OpenAI client ---
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! })

// Assistant configuration (set this in your env)
const ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID!

// Tuning
const POLL_MS = 300        // faster polling for snappier replies
const MAX_WAIT_MS = 120000 // 2 minutes hard cap

type UiPart = { type: 'text'; text: string }

// Small helpers
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const now = () => Date.now()

// Some statuses mean the run is still "active" and you should not add new messages
const ACTIVE_STATUSES = new Set([
  'queued',
  'in_progress',
  'requires_action',
  'cancelling',
])

async function waitForNoActiveRun(threadId: string) {
  let waited = 0
  while (waited <= MAX_WAIT_MS) {
    try {
      const runs = await client.beta.threads.runs.list(threadId, { order: 'desc', limit: 1 })
      const last = runs.data[0]
      if (!last || !ACTIVE_STATUSES.has(last.status as any)) return
    } catch (e) {
      // If list fails, break out to avoid blocking
      console.warn('[CV][server] runs.list failed, proceeding:', (e as any)?.message || e)
      return
    }
    await sleep(POLL_MS)
    waited += POLL_MS
  }
}

function log(obj: any) {
  try {
    console.log('[CV][server]', JSON.stringify(obj))
  } catch {
    console.log('[CV][server]', obj)
  }
}

export async function POST(req: NextRequest) {
  const t0 = now()
  try {
    const body = await req.json()
    const incoming = body?.message as { role: 'user' | 'assistant'; parts: UiPart[] } | undefined
    let threadId: string | undefined = body?.threadId

    const text = incoming?.parts?.[0]?.text?.trim()
    if (!text) {
      return NextResponse.json({ error: 'empty message' }, { status: 400 })
    }

    log({ step: 'incoming', threadId, preview: text.slice(0, 160) })

    // 1) Thread reuse/create
    if (!threadId) {
      const created = await client.beta.threads.create({ metadata: { channel: 'web-embed' } })
      threadId = created.id
      log({ step: 'thread.created', threadId })
    }

    // 2) Ensure no active run is in progress to avoid 400 error
    await waitForNoActiveRun(threadId!)

    // 3) Append user message
    await client.beta.threads.messages.create(threadId!, {
      role: 'user',
      content: text,
    })
    log({ step: 'message.appended' })

    // 4) Launch run
    const run = await client.beta.threads.runs.create(threadId!, {
      assistant_id: ASSISTANT_ID,
      instructions:
        [
          'Responde de inmediato; evita frases como "un momento" o "te preparo algo y te aviso".',
          'Si ya hay destino + fechas/duración + nº de personas, entrega el itinerario en un bloque:',
          '```cv:itinerary',
          '{ JSON válido según el esquema del sistema }',
          '```',
          'Si falta un dato crítico, haz UNA pregunta de avance.',
        ].join('\n'),
      metadata: { channel: 'web-embed' },
    })
    log({ step: 'run.created', runId: run.id })

    // 5) Poll until finished (fast polling)
    let status = run.status
    const tStart = now()
    while (true) {
      const poll = await client.beta.threads.runs.retrieve(run.id, { thread_id: threadId! })
      if (status !== poll.status) {
        status = poll.status
        log({ step: 'run.status', status })
      }
      if (
        status === 'completed' ||
        status === 'failed' ||
        status === 'expired' ||
        status === 'cancelled'
      ) break
      if (now() - tStart > MAX_WAIT_MS) {
        try { await client.beta.threads.runs.cancel(run.id, { thread_id: threadId! }) } catch {}
        log({ step: 'run.timeout.cancelled' })
        break
      }
      await sleep(POLL_MS)
    }

    // 6) Grab latest assistant message text
    const msgs = await client.beta.threads.messages.list(threadId!, { order: 'desc', limit: 10 })
    const firstAssistant = msgs.data.find((m) => m.role === 'assistant')
    const reply =
      firstAssistant?.content
        ?.filter((c: any) => c?.type === 'text' && c?.text?.value)
        .map((c: any) => c.text.value as string)
        .join('\n') ?? ''

    log({ step: 'reply.ready', ms: now() - t0, size: reply.length })

    return NextResponse.json({ threadId, reply, runStatus: status })
  } catch (err: any) {
    console.error('[CV][server] exception', err)
    return NextResponse.json({ error: String(err?.message || err) }, { status: 500 })
  }
}
