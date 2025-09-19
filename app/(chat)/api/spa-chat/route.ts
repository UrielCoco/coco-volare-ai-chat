// app/(chat)/api/spa-chat/route.ts
import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

export const runtime = "nodejs"; // fuerza entorno de servidor

type ChatRole = "user" | "assistant" | "system";
type ChatMessage = { role: ChatRole; content: string };
type ChatRequest = { messages: ChatMessage[] };

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body: ChatRequest = await req.json();

    // Validación mínima
    if (!body?.messages?.length) {
      return NextResponse.json(
        { ok: false, error: "Missing messages[]" },
        { status: 400 }
      );
    }

    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    // Usa tu modelo preferido (ajústalo a tu setup)
    const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

    const completion = await client.chat.completions.create({
      model,
      messages: body.messages,
      // Si luego quieres streaming, aquí pasarías stream: true y harías SSE
    });

    const text = completion.choices?.[0]?.message?.content ?? "";

    return NextResponse.json({
      ok: true,
      message: { role: "assistant", content: text } satisfies ChatMessage,
      // Puedes incluir metadata si lo necesitas
      usage: completion.usage ?? null,
    });
  } catch (err) {
    const e = err as Error;
    // Log visible (Vercel) para diagnóstico
    console.error("[spa-chat] POST error:", e.message, e.stack);
    return NextResponse.json(
      { ok: false, error: e.message },
      { status: 500 }
    );
  }
}
