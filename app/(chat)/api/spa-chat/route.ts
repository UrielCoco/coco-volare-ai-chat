// app/(chat)/api/spa-chat/route.ts
import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

/**
 * Fuerza que este endpoint no se cachee y se ejecute en cada request.
 * Y que corra en Node (para ver logs en Vercel fácilmente).
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

type ChatRole = "user" | "assistant" | "system";
type ChatMessage = { role: ChatRole; content: string };
type ChatRequest = { messages: ChatMessage[] };

function log(...args: any[]) {
  // Logs que verás en Vercel -> "Functions" / "Logs"
  console.log("[spa-chat]", ...args);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const startedAt = Date.now();

  try {
    const bodyText = await req.text();
    let body: ChatRequest | null = null;

    try {
      body = JSON.parse(bodyText);
    } catch {
      log("ERROR body JSON parse:", bodyText);
      return NextResponse.json(
        { ok: false, error: "Request body must be valid JSON" },
        { status: 400 }
      );
    }

    log("REQUEST.messages:", body?.messages);

    if (!body?.messages?.length) {
      log("ERROR missing messages[]");
      return NextResponse.json(
        { ok: false, error: "Missing messages[]" },
        { status: 400 }
      );
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      log("ERROR OPENAI_API_KEY missing");
      return NextResponse.json(
        { ok: false, error: "OPENAI_API_KEY is not set" },
        { status: 500 }
      );
    }

    const client = new OpenAI({ apiKey });
    const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

    const completion = await client.chat.completions.create({
      model,
      messages: body.messages,
    });

    const text = completion.choices?.[0]?.message?.content ?? "";

    log("OK response in", Date.now() - startedAt, "ms");
    return NextResponse.json({
      ok: true,
      message: { role: "assistant", content: text } satisfies ChatMessage,
      usage: completion.usage ?? null,
    });
  } catch (err) {
    const e = err as Error;
    log("FATAL:", e.message, e.stack);
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
