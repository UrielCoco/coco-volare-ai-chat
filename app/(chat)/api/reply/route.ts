import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

// Ejecuta en runtime Node (no edge) para evitar límites de fetch/etc.
export const runtime = "nodejs";

/** Genera un traceId y/o usa el que mande el HUB para correlacionar logs */
function traceIdFrom(body?: any) {
  return (body?.traceId && String(body.traceId)) || `b${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

const SYSTEM =
  "Eres el asistente de Coco Volare. Responde breve, claro y en español mexicano. Si falta contexto, pide datos puntuales.";

/** Log unificado similar al HUB para depurar en Vercel */
function log(level: "info" | "error", msg: string, meta: any, tid: string) {
  console.log(JSON.stringify({ time: new Date().toISOString(), level, traceId: tid, msg, meta }));
}

/** Parsea JSON o x-www-form-urlencoded por si algún caller raro lo manda así */
async function parseBody(req: NextRequest): Promise<any> {
  const ct = req.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    try {
      return await req.json();
    } catch {}
  }
  if (ct.includes("application/x-www-form-urlencoded")) {
    const form = await req.formData();
    return Object.fromEntries(form.entries());
  }
  // Fallback
  try {
    return await req.json();
  } catch {
    return {};
  }
}

export async function POST(req: NextRequest) {
  const body = await parseBody(req);
  const tid = traceIdFrom(body);

  try {
    const message: string = String(
      body?.message ??
        body?.text ??
        body?.user_message ??
        ""
    ).trim();

    const leadId = body?.leadId ?? body?.lead_id;
    const contactId = body?.contactId ?? body?.contact_id;

    log("info", "assistant:recv", {
      messagePreview: message.slice(0, 160),
      leadId: leadId || null,
      contactId: contactId || null,
    }, tid);

    if (!message) {
      return NextResponse.json({ error: "message requerido" }, { status: 400 });
    }

    // Si no hay API key, regresamos un fallback útil para no romper el flujo durante pruebas.
    const apiKey = process.env.OPENAI_API_KEY;
    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

    if (!apiKey) {
      const fallback =
        `Te entendí: "${message}". ¿Quieres cotización, reservar o conocer disponibilidad?`;
      log("info", "assistant:reply", { replyPreview: fallback.slice(0, 160), mode: "fallback" }, tid);
      return NextResponse.json({ reply: fallback, leadId, contactId, traceId: tid });
    }

    const openai = new OpenAI({ apiKey });

    const completion = await openai.chat.completions.create({
      model,
      temperature: 0.6,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: message },
      ],
    });

    const reply =
      completion.choices?.[0]?.message?.content?.toString().trim() ||
      "Listo, ¿algo más?";

    log("info", "assistant:reply", { replyPreview: reply.slice(0, 160), model }, tid);

    // Respuesta esperada por el HUB: { reply, ... }
    return NextResponse.json({ reply, leadId, contactId, traceId: tid });
  } catch (e: any) {
    log("error", "assistant:error", { err: e?.message || String(e) }, tid);
    return NextResponse.json(
      { reply: "Tuve un detalle técnico, pero ya estoy revisando. ¿Podrías explicarlo de otra forma?" },
      { status: 200 }
    );
  }
}
