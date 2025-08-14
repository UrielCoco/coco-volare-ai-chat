// coco-volare-ai-chat-main-2/app/api/reply/route.ts
// Endpoint simple: recibe { message, context } y regresa { reply } usando OpenAI.

import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

export const runtime = "nodejs";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
const SYSTEM =
  "Eres el asistente de Coco Volare. Responde breve, claro y en español mexicano. Si falta contexto, pide datos puntuales.";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const message: string = String(body?.message || "").trim();

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
      completion.choices?.[0]?.message?.content?.toString().trim() ||
      "Listo, ¿algo más?";

    return NextResponse.json({ reply });
  } catch (e: any) {
    console.error("[/api/reply] error:", e?.message || e);
    return NextResponse.json({ error: "server error" }, { status: 500 });
  }
}
