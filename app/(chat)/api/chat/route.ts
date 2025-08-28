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
    ALLOWED_ORIGINS.find((o) => o && origin.toLowerCase().startsWith(o.toLowerCase())) || "*";
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
  Object.entries(h).forEach(([k, v]) => res.headers.set(k, v as string));
  return res;
}

export async function OPTIONS(req: NextRequest) {
  const res = new NextResponse(null, { status: 204 });
  return withCors(req, res);
}

/* ---------- Body parser ---------- */
function pickText(body: any): string {
  if (body == null) return "";
  if (typeof body === "string") return body.trim();

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
          if (typeof c?.content === "string" && c.content.trim()) return c.content.trim();
          if (typeof c?.value === "string" && c.value.trim()) return c.value.trim();
        }
      }
    }
  }

  const direct = ["message", "text", "prompt"];
  for (const k of direct) {
    const v = (body as any)[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (v && typeof v?.text === "string" && v.text.trim()) return v.text.trim();
  }
  if (typeof (body as any).content === "string") return (body as any).content.trim();
  return "";
}

/* ---------- Session helper ---------- */
async function fetchSessionThread(req: NextRequest): Promise<{ sessionId: string; threadId: string }> {
  const origin = req.nextUrl.origin; // correcto host
  const sid =
    req.headers.get("x-cv-session") ||
    req.cookies.get("cv_session")?.value ||
    "";
  const url = `${origin.replace(/\/$/, "")}/api/chat/session${sid ? `?sid=${encodeURIComponent(sid)}` : ""}`;
  const r = await fetch(url, {
    method: "GET",
    headers: { "x-cv-session": sid || "" },
    cache: "no-store",
  });

  const ct = r.headers.get("content-type") || "";
  const raw = await r.text();
  if (!r.ok) throw new Error(`session fetch failed: ${r.status} ${raw.slice(0, 200)}`);
  let j: any = {};
  try {
    j = ct.includes("application/json") ? JSON.parse(raw) : {};
  } catch {
    throw new Error(`session returned non-JSON: ${raw.slice(0, 200)}`);
  }
  if (!j?.sessionId || !j?.threadId) throw new Error(`session response missing fields: ${raw.slice(0, 200)}`);
  return { sessionId: j.sessionId, threadId: j.threadId };
}

/* ---------- POST ---------- */
export async function POST(req: NextRequest) {
  const started = Date.now();
  try {
    const ctIn = req.headers.get("content-type") || "";
    let body: any = {};
    if (ctIn.includes("application/json")) {
      body = (await req.json().catch(async () => {
        const t = await req.text().catch(() => "");
        try { return JSON.parse(t); } catch { return {}; }
      })) || {};
    } else {
      const txt = await req.text();
      try { body = JSON.parse(txt); } catch { body = txt; }
    }

    const text = pickText(body);
    console.log("CV:/api/chat START method=POST origin=", req.headers.get("origin"), "len=", text.length);
    if (!text) {
      const res = NextResponse.json({ error: "Message content must be non-empty." }, { status: 400 });
      return withCors(req, res);
    }

    // 1) Session → thread
    let sessionId = "";
    let threadId = "";
    try {
      const s = await fetchSessionThread(req);
      sessionId = s.sessionId;
      threadId = s.threadId;
    } catch (e: any) {
      console.error("CV:/api/chat session fetch ERROR:", e?.message || e);
      // si falla, se creará un thread nuevo en el runner (pierdes continuidad)
    }

    // 2) Hub config
    const hubBaseUrl = process.env.NEXT_PUBLIC_HUB_BASE_URL || process.env.HUB_BASE_URL;
    const hubSecret = process.env.HUB_BRIDGE_SECRET || process.env.WEBHOOK_SECRET;
    if (!hubBaseUrl || !hubSecret) {
      const res = NextResponse.json({ error: "Hub config missing (HUB_BASE_URL / HUB_BRIDGE_SECRET)" }, { status: 500 });
      return withCors(req, res);
    }

    // 3) Ejecutar Assistant (Kommo + Hub tools)
    const result = await runAssistantWithTools(text, {
      threadId: threadId || undefined,
      hubBaseUrl,
      hubSecret,
    });

    const res = NextResponse.json(
      {
        reply: result.reply,
        threadId: result.threadId,
        toolEvents: result.toolEvents,
        sessionId: sessionId || undefined,
        ms: Date.now() - started,
      },
      { status: 200 }
    );
    if (sessionId) {
      res.cookies.set("cv_session", sessionId, {
        httpOnly: false,
        sameSite: "lax",
        secure: true,
        maxAge: 60 * 60 * 24 * 365,
        path: "/",
      });
    }
    return withCors(req, res);
  } catch (err: any) {
    console.error("CV:/api/chat ERROR:", err);
    const res = NextResponse.json({ error: String(err?.message || err) }, { status: 500 });
    return withCors(req, res);
  }
}

/* ---------- Health ---------- */
export async function GET(req: NextRequest) {
  const res = NextResponse.json({ ok: true });
  return withCors(req, res);
}
