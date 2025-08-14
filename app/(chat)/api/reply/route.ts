import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

export const runtime = "nodejs";

function trace() { return `b${Date.now().toString(36)}${Math.floor(Math.random()*1e6).toString(36)}`; }

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
const SYSTEM =
  "Eres el asistente de Coco Volare. Responde breve, claro y en español mexicano. Si falta contexto, pide datos puntuales.";

export async function POST(req: NextRequest) {
  const tid = trace();
  try {
    const body = await req.json().catch(() => ({} as any));
    const message: string = String(body?.message || "").trim();

    console.log(JSON.stringify({ time: new Date().toISOString(), level: "info", traceId: tid, msg: "assistant:recv", meta: { messagePreview: message.slice(0,160) } }));

    if (!message) {
      return NextResponse.json({ error: "message requerido" }, { status: 400 });
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.6,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: message },
      ],
    });

    const reply =
      completion.choices?.[0]?.message?.content?.toString().trim() || "Listo, ¿algo más?";

    console.log(JSON.stringify({ time: new Date().toISOString(), level: "info", traceId: tid, msg: "assistant:reply", meta: { replyPreview: reply.slice(0,160) } }));

    return NextResponse.json({ reply });
  } catch (e: any) {
    console.log(JSON.stringify({ time: new Date().toISOString(), level: "error", traceId: tid, msg: "assistant:error", meta: { err: e?.message || String(e) } }));
    return NextResponse.json({ error: "server error" }, { status: 500 });
  }
}
