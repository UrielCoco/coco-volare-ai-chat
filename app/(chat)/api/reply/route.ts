// app/(chat)/api/reply/route.ts
import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

export const runtime = "nodejs";

const trace = () =>
  `b${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

const SYSTEM =
  "Eres el asistente de Coco Volare. Responde breve, claro y en español mexicano. Si falta contexto, pide datos puntuales.";

function log(level: "info" | "error", tid: string, msg: string, meta: any = {}) {
  console.log(JSON.stringify({ time: new Date().toISOString(), level, traceId: tid, msg, meta }));
}

export async function POST(req: NextRequest) {
  const tid = trace();
  try {
    const { message = "" } = await req.json().catch(() => ({ message: "" }));
    const text = String(message || "").trim();
    log("info", tid, "assistant:recv", { messagePreview: text.slice(0, 160) });

    if (!text) {
      return NextResponse.json({ reply: "¿Me repites el mensaje?" });
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.6,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: text },
      ],
    });

    const reply =
      completion.choices?.[0]?.message?.content?.toString().trim() ||
      "Listo, ¿algo más?";

    log("info", tid, "assistant:reply", { replyPreview: reply.slice(0, 160) });
    return NextResponse.json({ reply });
  } catch (e: any) {
    log("error", tid, "assistant:error", { err: e?.message || String(e) });
    return NextResponse.json(
      { reply: "Se me cruzaron los cables. ¿Puedes intentar de nuevo?" },
      { status: 200 }
    );
  }
}
