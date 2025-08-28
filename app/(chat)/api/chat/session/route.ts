// /app/(chat)/api/chat/session/route.ts
import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { db } from "@/lib/db"; // ajusta si tu cliente drizzle está en otra ruta
import { webSessionThread } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ====== In-memory fallback (si DB truena) ======
const SESSION_MAP: Map<string, { threadId: string; updatedAt: number }> =
  (global as any).__cvSessionMap || new Map();
(global as any).__cvSessionMap = SESSION_MAP;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY missing");
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

function uuidv4() {
  // suficiente para sesión, no criptográfico
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0,
      v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

async function ensureThreadId(sessionId: string): Promise<string> {
  // 1) DB first
  try {
    const rows = await db
      .select({
        sessionId: webSessionThread.sessionId,
        threadId: webSessionThread.threadId,
      })
      .from(webSessionThread)
      .where(eq(webSessionThread.sessionId, sessionId))
      .limit(1);

    if (rows?.[0]?.threadId) {
      return rows[0].threadId;
    }

    // no hay registro -> crear thread y guardar
    const created = await openai.beta.threads.create({});
    const threadId = created.id;
    const now = new Date();

    await db.insert(webSessionThread).values({
      sessionId,
      threadId,
      channel: "web",
      createdAt: now,
      updatedAt: now,
      kommoLeadId: null,
      kommoContactId: null,
      chatId: null,
    });

    return threadId;
  } catch (e) {
    // 2) Fallback en memoria
    console.warn("CV:/api/chat/session DB path failed, using MEMORY fallback", e);
    const mem = SESSION_MAP.get(sessionId);
    if (mem?.threadId) return mem.threadId;

    const created = await openai.beta.threads.create({});
    const threadId = created.id;
    SESSION_MAP.set(sessionId, { threadId, updatedAt: Date.now() });
    return threadId;
  }
}

export async function GET(req: NextRequest) {
  try {
    const sp = new URL(req.url).searchParams;
    const headerSid = req.headers.get("x-cv-session") || "";
    const cookieSid = req.cookies.get("cv_session")?.value || "";
    let sessionId = headerSid || sp.get("sid") || cookieSid;

    if (!sessionId) sessionId = uuidv4();

    const threadId = await ensureThreadId(sessionId);

    const res = NextResponse.json({
      ok: true,
      sessionId,
      threadId,
    });

    // set cookie para el cliente (1 año)
    res.cookies.set("cv_session", sessionId, {
      httpOnly: false,
      sameSite: "lax",
      secure: true,
      maxAge: 60 * 60 * 24 * 365,
      path: "/",
    });

    return res;
  } catch (e: any) {
    console.error("CV:/api/chat/session ERROR", e);
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
