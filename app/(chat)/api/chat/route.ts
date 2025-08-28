import { NextRequest, NextResponse } from "next/server";
import { runAssistantWithTools } from "@/lib/ai/providers/openai-assistant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ---------- CORS ---------- */
const ALLOWED_ORIGINS = [
  process.env.NEXT_PUBLIC_SITE_URL || "https://coco-volare-ai-chat.vercel.app",
  "https://coco-volare-ai-chat.vercel.app",
  "https://www.cocovolare.com",
  "https://cocovolare.com",
  "http://localhost:3000",
];

function corsHeaders(req: NextRequest) {
  const origin = req.headers.get("origin") || "";
  const allow =
    ALLOWED_ORIGINS.find((o) => o && origin.toLowerCase().startsWith(o.toLowerCase())) ||
    "*"; // para debug; en prod puedes quitar "*" y dejar solo dominios exactos

  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, x-requested-with, x-cv-session",
    Vary: "Origin",
  };
}

function withCors(req: NextRequest, res: NextResponse) {
  const h = corsHeaders(req);
  Object.entries(h).forEach(([k, v]) => res.headers.set(k, v));
  return res;
}

export async function OPTIONS(req: NextRequest) {
  const res = new NextResponse(null, { status: 204 });
  return withCors(req, res);
}

/* ---------- Body parser robusto ---------- */
function pickText(body: any): string {
  if (body == null) return "";
  if (typeof body === "string") return body.trim();

  const direct = ["message", "text", "prompt"];
  for (const k of direct) {
    const v = (body as any)[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (v && typeof v?.text === "string" && v.text.trim()) return v.text.trim();
  }

  const msg = (body as any).message;
  if (msg?.parts && Array.isArray(msg.parts)) {
    for (const p of msg.parts) {
      if (typeof p === "string" && p.trim()) return p.trim();
      if (p && typeof p.text === "string" && p.text.trim()) return p.text.trim();
      if (p && typeof p.content === "string" && p.content.trim()) return p.content.trim();
    }
  }

  const messages = (body as any).messages;
  if (Array.isArray(messages) && messages.length) {
    const lastUser =
      [...messages].reverse().find((m: any) => m?.role === "user") ??
      messages[messages.length - 1];

    if (lastUser) {
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

/* ---------- POST ---------- */
export async function POST(req: NextRequest) {
  const started = Date.now();
  try {
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
    console.log("CV:/api/chat START method=POST origin=", req.headers.get("origin"), "len=", text.length);

    if (!text) {
      const res = NextResponse.json(
        { error: "Message content must be non-empty." },
        { status: 400 }
      );
      return withCors(req, res);
    }

    const hubBaseUrl =
      process.env.NEXT_PUBLIC_HUB_BASE_URL || process.env.HUB_BASE_URL;
    const hubSecret =
      process.env.HUB_BRIDGE_SECRET || process.env.WEBHOOK_SECRET;

    if (!hubBaseUrl || !hubSecret) {
      const res = NextResponse.json(
        { error: "Hub config missing (HUB_BASE_URL / HUB_BRIDGE_SECRET)" },
        { status: 500 }
      );
      return withCors(req, res);
    }

    const result = await runAssistantWithTools(text, {
      hubBaseUrl,
      hubSecret,
    });

    const res = NextResponse.json(
      {
        reply: result.reply,
        threadId: result.threadId,
        toolEvents: result.toolEvents,
        ms: Date.now() - started,
      },
      { status: 200 }
    );
    return withCors(req, res);
  } catch (err: any) {
    console.error("CV:/api/chat ERROR:", err);
    const res = NextResponse.json(
      { error: String(err?.message || err) },
      { status: 500 }
    );
    return withCors(req, res);
  }
}

/* ---------- Health ---------- */
export async function GET(req: NextRequest) {
  const res = NextResponse.json({ ok: true });
  return withCors(req, res);
}
