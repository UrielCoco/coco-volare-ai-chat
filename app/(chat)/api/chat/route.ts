import { NextRequest, NextResponse } from "next/server";
import { runAssistantWithTools } from "@/lib/ai/providers/openai-assistant";

// ===== util: extraer texto de cualquier shape =====
function pickText(body: any): string {
  if (body == null) return "";

  // raw string
  if (typeof body === "string") return body.trim();

  // body.message, body.text, body.prompt
  const directFields = ["message", "text", "prompt"];
  for (const k of directFields) {
    const v = (body as any)[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (v && typeof v?.text === "string" && v.text.trim()) return v.text.trim();
  }

  // body.message.parts => ["hola"] o [{text:"hola"}]
  const msg = (body as any).message;
  if (msg?.parts && Array.isArray(msg.parts)) {
    for (const p of msg.parts) {
      if (typeof p === "string" && p.trim()) return p.trim();
      if (p && typeof p.text === "string" && p.text.trim()) return p.text.trim();
      if (p && typeof p.content === "string" && p.content.trim()) return p.content.trim();
    }
  }

  // OpenAI style: body.messages: [{role, content}]
  const messages = (body as any).messages;
  if (Array.isArray(messages) && messages.length) {
    // toma el último user, si no hay, toma el último
    const lastUser =
      [...messages].reverse().find((m: any) => m?.role === "user") ??
      messages[messages.length - 1];

    if (lastUser) {
      // content puede ser string o array de bloques
      if (typeof lastUser.content === "string" && lastUser.content.trim())
        return lastUser.content.trim();

      if (Array.isArray(lastUser.content)) {
        for (const c of lastUser.content) {
          if (typeof c === "string" && c.trim()) return c.trim();
          if (typeof c?.text === "string" && c.text.trim()) return c.text.trim();
          if (typeof c?.content === "string" && c.content.trim())
            return c.content.trim();
          if (typeof c?.value === "string" && c.value.trim()) return c.value.trim();
        }
      }
    }
  }

  // content (fuera de messages)
  if (Array.isArray((body as any).content)) {
    for (const c of (body as any).content) {
      if (typeof c === "string" && c.trim()) return c.trim();
      if (typeof c?.text === "string" && c.text.trim()) return c.text.trim();
      if (typeof c?.content === "string" && c.content.trim())
        return c.content.trim();
    }
  }

  return "";
}

export async function POST(req: NextRequest) {
  try {
    // parse body flexible (JSON o texto)
    const ct = req.headers.get("content-type") || "";
    let body: any = {};
    if (ct.includes("application/json")) {
      body = (await req.json().catch(() => ({}))) || {};
    } else {
      const txt = await req.text();
      try {
        body = JSON.parse(txt);
      } catch {
        body = txt;
      }
    }

    const text = pickText(body);
    console.log("CV:/api/chat START msg.len=", text.length);

    if (!text) {
      return NextResponse.json(
        { error: "Message content must be non-empty." },
        { status: 400 }
      );
    }

    const hubBaseUrl =
      process.env.NEXT_PUBLIC_HUB_BASE_URL || process.env.HUB_BASE_URL;
    const hubSecret =
      process.env.HUB_BRIDGE_SECRET || process.env.WEBHOOK_SECRET;

    if (!hubBaseUrl || !hubSecret) {
      return NextResponse.json(
        { error: "Hub config missing (HUB_BASE_URL / HUB_BRIDGE_SECRET)" },
        { status: 500 }
      );
    }

    const result = await runAssistantWithTools(text, {
      hubBaseUrl,
      hubSecret,
    });

    console.log("CV:/api/chat END toolEvents=", result.toolEvents);

    return NextResponse.json({
      reply: result.reply,
      threadId: result.threadId,
      toolEvents: result.toolEvents,
    });
  } catch (err: any) {
    console.error("CV:/api/chat ERROR:", err);
    return NextResponse.json(
      { error: String(err?.message || err) },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({ ok: true }, { status: 200 });
}
