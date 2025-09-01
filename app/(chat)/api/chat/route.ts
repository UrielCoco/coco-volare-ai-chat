// app/(chat)/api/chat/route.ts
import { NextRequest } from 'next/server';
import OpenAI from 'openai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const client = new OpenAI({
  apiKey: process.env.OPENAI_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY!,
});
const ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID!;

type UiMessage = {
  role: 'user' | 'assistant';
  parts: Array<{ type: 'text'; text: string }>;
};

function asText(msg?: UiMessage) {
  if (!msg?.parts?.length) return '';
  return msg.parts.map((p) => (p.type === 'text' ? p.text : '')).join('');
}

function sse(event: string, data: any) {
  return `event: ${event}\n` + `data: ${JSON.stringify(data)}\n\n`;
}

// ---------- Logs server ----------
function slog(event: string, meta: Record<string, any> = {}) {
  try {
    console.info(JSON.stringify({ tag: '[CV][server]', event, ...meta }));
  } catch {}
}

// ---------- Helpers OpenAI ----------
function flattenAssistantTextFromMessage(message: any): string {
  const out: string[] = [];
  if (!message?.content) return '';
  for (const c of message.content) {
    if (c.type === 'text' && c.text?.value) out.push(c.text.value);
  }
  return out.join('\n');
}

function extractDeltaTextFromEvent(e: any): string {
  try {
    const content = e?.data?.delta?.content;
    if (Array.isArray(content)) {
      const parts: string[] = [];
      for (const item of content) {
        if (item?.type === 'text' && item?.text?.value) parts.push(item.text.value);
        if (item?.type === 'output_text' && item?.text?.value) parts.push(item.text.value);
        if (item?.type === 'output_text_delta' && (item as any)?.value) parts.push((item as any).value);
      }
      return parts.join('');
    }
  } catch {}
  return '';
}

// ---------- Detección de disparador “te lo preparo / un momento” ----------
const WAIT_PATTERNS = [
  // ES
  /dame un momento/i,
  /un momento/i,
  /perm[ií]teme/i,
  /en breve/i,
  /lo preparo/i,
  /te preparo/i,
  /voy a preparar/i,
  /estoy preparando/i,
  /ahora mismo/i,
  // EN
  /give me a moment/i,
  /one moment/i,
  /hold on/i,
  /let me/i,
  /just a moment/i,
  /i('|’)ll prepare/i,
  /i will prepare/i,
  /i('|’)m preparing/i,
  /working on it/i,
  // IT
  /un attimo/i,
  /lascia(mi)? che/i,
  /preparo/i,
  /sto preparando/i,
  // PT
  /um momento/i,
  /deixa eu/i,
  /vou preparar/i,
  /estou preparando/i,
  // FR
  /un instant/i,
  /laisse(-|\s)?moi/i,
  /je vais pr[eé]parer/i,
  /je pr[eé]pare/i,
  // DE
  /einen moment/i,
  /lass mich/i,
  /ich werde vorbereiten/i,
  /ich bereite vor/i,
];
function hasWaitPhrase(text: string) {
  const t = text || '';
  return WAIT_PATTERNS.some((rx) => rx.test(t));
}
function hasVisibleBlock(text: string) {
  return /```cv:(itinerary|quote)\b/.test(text || '');
}

// ---------- Extrae ops de bloques ```cv:kommo ...``` en texto ----------
function extractKommoOps(text: string): Array<any> {
  const ops: any[] = [];
  if (!text) return ops;
  const rxFence = /```\s*cv:kommo\s*([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  while ((m = rxFence.exec(text))) {
    try {
      const json = JSON.parse((m[1] || '').trim());
      if (json && Array.isArray(json.ops)) ops.push(...json.ops);
    } catch {
      // ignorar bloque malformado
    }
  }
  return ops;
}

// ---------- Utilidades heurísticas (Opción B) ----------
function includesAny(s: string, needles: RegExp[] | string[]) {
  const txt = s || '';
  return needles.some((n) => (n instanceof RegExp ? n.test(txt) : txt.toLowerCase().includes(n.toLowerCase())));
}

function isLikelyClarifyingQuestion(text: string) {
  const rx = [
    /\?/, // cualquier pregunta
    /fecha|fechas|cu[aá]ntas|personas|preferencias|presupuesto|presup|d[eé]nde|desde|hasta/i,
    /dates?|how many|people|preferences?|budget|where|from.*to/i,
  ];
  return includesAny(text, rx);
}

function detectUserLang(s: string): 'en' | 'es' | 'pt' | 'it' | 'fr' | 'de' | 'other' {
  const t = (s || '').toLowerCase();
  const score = (arr: RegExp[]) => arr.reduce((acc, r) => (r.test(t) ? acc + 1 : acc), 0);
  const en = score([/\bthe\b/, /\band\b/, /\bplease\b/, /\bi want\b/]);
  const es = score([/\bque\b/, /\bpara\b/, /\bviaje\b/, /¿|¡/]);
  const pt = score([/\bque\b/, /\bpara\b/, /\bviagem\b/]);
  const it = score([/\bper\b/, /\bviaggio\b/]);
  const fr = score([/\bpour\b/, /\bvoyage\b/]);
  const de = score([/\bund\b/, /\breise\b/]);
  const max = Math.max(en, es, pt, it, fr, de);
  if (max === 0) return 'other';
  if (max === en) return 'en';
  if (max === es) return 'es';
  if (max === pt) return 'pt';
  if (max === it) return 'it';
  if (max === fr) return 'fr';
  return 'de';
}

type RepromptDecision = { ok: boolean; reason?: string; langHint?: string };

function decideAutoReprompt(opts: {
  fullText: string;
  userText: string;
  messageCountInRun: number;
  alreadyRepromptedInThisRequest: boolean;
}): RepromptDecision {
  const text = opts.fullText || '';
  const len = text.length;

  // Reglas endurecidas (B):
  if (!text) return { ok: false, reason: 'empty' };
  if (hasVisibleBlock(text)) return { ok: false, reason: 'has-visible-block' };
  if (!hasWaitPhrase(text)) return { ok: false, reason: 'no-wait-phrase' };
  if (len > 180) return { ok: false, reason: 'too-long' };
  if (isLikelyClarifyingQuestion(text)) return { ok: false, reason: 'clarifying-question' };
  if (opts.messageCountInRun > 1) return { ok: false, reason: 'multi-msg-run' };
  if (opts.alreadyRepromptedInThisRequest) return { ok: false, reason: 'already-reprompted' };

  const userLang = detectUserLang(opts.userText);
  const hint =
    userLang === 'en'
      ? ' Please continue in English.'
      : userLang === 'es'
      ? ' Por favor continúa en español.'
      : undefined;

  return { ok: true, reason: 'wait-no-block', langHint: hint };
}

/**
 * Ejecuta UN run con createAndStream y resuelve cuando termina.
 * Emite los mismos eventos que ya consume la UI.
 * Devuelve el texto completo recibido en ese run y metadatos (D).
 *
 * Opción A: ya NO emite 'done' aquí (solo al final del pipeline).
 */
async function runOnceWithStream(
  tid: string,
  send: (event: string, data: any) => void,
): Promise<{
  fullText: string;
  sawText: boolean;
  messagesMeta: Array<{
    id?: string;
    hadFence: boolean;
    fenceTypes: string[];
    textLen: number;
    order: number;
  }>;
  messagesCount: number;
}> {
  const saw = { text: false, deltaChars: 0, fenceSeenInDelta: false };
  const fenceStartRx = /```cv:(itinerary|quote)\b/i;
  const allFencesRx = /```cv:(itinerary|quote)\s*([\s\S]*?)```/g;

  const t0 = Date.now();
  let tFirstDelta: number | null = null;

  function emitDiag(phase: 'delta' | 'final', extra: Record<string, any> = {}) {
    try {
      send('diag', { phase, threadId: tid, ...extra });
    } catch {}
    slog(phase === 'delta' ? 'diag.fence.delta' : 'diag.fence.final', { threadId: tid, ...extra });
  }

  let fullText = '';
  let runId: string | null = null;

  // D: tracking de mensajes por run
  const msgMeta: Array<{
    id?: string;
    hadFence: boolean;
    fenceTypes: string[];
    textLen: number;
    order: number;
  }> = [];
  let messageOrder = 0;

  const stream: any = await client.beta.threads.runs.createAndStream(tid, {
    assistant_id: ASSISTANT_ID,
  });

  stream.on('event', (e: any) => {
    const type = e?.event as string;

    // ---- creación de run
    if (type === 'thread.run.created') {
      runId = e?.data?.id ?? null;
      slog('run.created', { runId, threadId: tid });
      return;
    }

    // ---- message created / in_progress (D)
    if (type === 'thread.message.created') {
      const m = e?.data;
      msgMeta.push({ id: m?.id, hadFence: false, fenceTypes: [], textLen: 0, order: ++messageOrder });
      slog('message.created', { runId, threadId: tid, messageId: m?.id, order: messageOrder });
      return;
    }
    if (type === 'thread.message.in_progress') {
      slog('message.in_progress', { runId, threadId: tid, messageId: e?.data?.id });
      return;
    }

    // ---- delta de mensaje
    if (type === 'thread.message.delta') {
      const deltaText = extractDeltaTextFromEvent(e);
      if (deltaText) {
        saw.text = true;
        saw.deltaChars += deltaText.length;
        fullText += deltaText;
        send('delta', { value: deltaText });

        if (tFirstDelta == null) {
          tFirstDelta = Date.now();
          slog('stream.first_delta', {
            runId,
            threadId: tid,
            firstDeltaMs: tFirstDelta - t0,
          });
        }

        if (!saw.fenceSeenInDelta && fenceStartRx.test(deltaText)) {
          saw.fenceSeenInDelta = true;
          emitDiag('delta', {
            runId,
            fenceSeenInDelta: true,
            sample: deltaText.slice(0, 160),
          });
        }

        if (saw.deltaChars % 300 === 0) {
          slog('stream.delta.tick', { deltaChars: saw.deltaChars, runId, threadId: tid });
        }
      }
      return;
    }

    // ---- mensaje completado
    if (type === 'thread.message.completed') {
      const m = e?.data;

      let completeForThisMessage = '';
      try {
        completeForThisMessage = flattenAssistantTextFromMessage(m);
      } catch {}

      if (completeForThisMessage) {
        saw.text = true;
        fullText += completeForThisMessage;

        // D: por mensaje, detectar fences
        const fences = [...completeForThisMessage.matchAll(allFencesRx)];
        const fenceTypes = fences.map((mm) => String(mm[1]));
        const hadFence = fenceTypes.length > 0;

        // Asociar meta al último slot creado
        const last = msgMeta[msgMeta.length - 1];
        if (last) {
          last.hadFence = hadFence;
          last.fenceTypes = fenceTypes;
          last.textLen = completeForThisMessage.length;
        }

        // DIAG final del run (agregado: mantenemos el global)
        const allFences = [...fullText.matchAll(allFencesRx)];
        const hashes = allFences.map((mm) => {
          const raw = mm[0];
          let hash = 0;
          for (let i = 0; i < raw.length; i++) hash = (hash * 31 + raw.charCodeAt(i)) >>> 0;
          return hash.toString(16);
        });
        const unique = Array.from(new Set(hashes)).length;

        emitDiag('final', {
          runId,
          fenceCount: allFences.length,
          fenceTypes: allFences.map((mm) => String(mm[1])),
          hashes,
          unique,
          fenceSeenInDelta: saw.fenceSeenInDelta,
        });

        // Emitimos lo que ya usas (UI): un 'final' por mensaje completado
        send('final', { text: completeForThisMessage });

        const ops = extractKommoOps(completeForThisMessage);
        slog('message.completed', {
          fullLen: completeForThisMessage.length,
          kommoOps: ops.length,
          runId,
          threadId: tid,
          messageId: m?.id,
        });
        if (ops.length) send('kommo', { ops });
      }
      return;
    }

    // ---- steps/tools (solo logs)
    if (type === 'thread.run.step.delta' || type === 'thread.run.step.completed') {
      try {
        const d = e?.data;
        const details = d?.step_details || d?.delta?.step_details;
        let toolCalls = 0;
        let names: string[] = [];

        if (details?.type === 'tool_calls') {
          const list = details?.tool_calls ?? details?.delta?.tool_calls ?? [];
          toolCalls = Array.isArray(list) ? list.length : 0;

          // ----- FIX TS: filtra con type-guard para garantizar string[] -----
          names = (Array.isArray(list) ? list : [])
            .map((tc: any) => (tc?.function?.name ? String(tc.function.name) : undefined))
            .filter((n: string | undefined): n is string => typeof n === 'string' && n.length > 0);
        }

        slog(type === 'thread.run.step.delta' ? 'run.step.delta' : 'run.step.completed', {
          runId,
          threadId: tid,
          toolCalls,
          names,
        });
      } catch {}
      return;
    }

    // ---- requires_action / cancel / otros (solo logs)
    if (type === 'thread.run.requires_action' || type === 'thread.run.cancelling' || type === 'thread.run.cancelled') {
      slog('run.state', { type, runId, threadId: tid });
      return;
    }

    // ---- error del stream
    if (type === 'error') {
      slog('stream.error', { runId, threadId: tid, error: String(e?.data || 'unknown') });
      send('error', { error: String(e?.data || 'unknown') });
      return;
    }

    // Otros eventos (diagnóstico)
    try {
      slog('stream.event.other', { type, runId, threadId: tid });
    } catch {}
  });

  await new Promise<void>((resolve) => {
    stream.on('end', () => {
      slog('stream.end', {
        deltaChars: saw.deltaChars,
        sawText: saw.text,
        runId,
        threadId: tid,
      });
      slog('stream.timing', {
        runId,
        threadId: tid,
        firstDeltaMs: tFirstDelta == null ? null : tFirstDelta - t0,
        totalMs: Date.now() - t0,
      });
      resolve();
    });
    stream.on('error', (err: any) => {
      slog('exception.stream', { runId, threadId: tid, error: String(err?.message || err) });
      send('error', { error: String(err?.message || err) });
      resolve();
    });
  });

  return { fullText, sawText: saw.text, messagesMeta: msgMeta, messagesCount: msgMeta.length };
}

export async function POST(req: NextRequest) {
  const { message, threadId } = await req.json();
  const userText = asText(message);
  slog('request.in', { hasThreadId: !!threadId, userTextLen: userText.length });

  // 1) Asegurar thread
  let tid = String(threadId || '');
  if (!tid) {
    const t = await client.beta.threads.create();
    tid = t.id;
    slog('thread.created', { threadId: tid });
  } else {
    slog('thread.reuse', { threadId: tid });
  }

  // 2) Adjuntar mensaje del usuario
  await client.beta.threads.messages.create(tid, { role: 'user', content: userText });
  slog('message.append.ok', { threadId: tid });

  // 3) Abrir SSE
  const encoder = new TextEncoder();
  const rs = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: any) => controller.enqueue(encoder.encode(sse(event, data)));

      // meta con threadId
      send('meta', { threadId: tid });

      try {
        // ---- Run 1
        const r1 = await runOnceWithStream(tid, send);

        // --- Opción B: heurística afinada para auto-reprompt
        const decision = decideAutoReprompt({
          fullText: r1.fullText,
          userText,
          messageCountInRun: r1.messagesCount,
          alreadyRepromptedInThisRequest: false,
        });

        slog('auto.reprompt.decision', {
          threadId: tid,
          ok: decision.ok,
          reason: decision.reason,
          r1Len: r1.fullText.length,
          r1Msgs: r1.messagesCount,
        });

        if (decision.ok) {
          const content = decision.langHint ? `?${decision.langHint}` : '?';
          await client.beta.threads.messages.create(tid, { role: 'user', content });
          slog('message.append.ok', { threadId: tid, info: 'auto-?' });

          // ---- Run 2
          const r2 = await runOnceWithStream(tid, send);

          // Log D: resumen de ambos runs
          slog('runs.summary', {
            threadId: tid,
            r1: {
              msgs: r1.messagesCount,
              meta: r1.messagesMeta.map((m) => ({
                order: m.order,
                hadFence: m.hadFence,
                fenceTypes: m.fenceTypes,
                textLen: m.textLen,
              })),
            },
            r2: {
              msgs: r2.messagesCount,
              meta: r2.messagesMeta.map((m) => ({
                order: m.order,
                hadFence: m.hadFence,
                fenceTypes: m.fenceTypes,
                textLen: m.textLen,
              })),
            },
          });
        }

        // Opción A: emitir 'done' **solo una vez**, al final del pipeline
        send('done', {});
        controller.close();
      } catch (e: any) {
        slog('exception.createStream', { error: String(e?.message || e) });
        send('error', { error: String(e?.message || e) });
        controller.close();
      }
    },
  });

  return new Response(rs, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
