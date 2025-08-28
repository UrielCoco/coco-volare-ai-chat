// /app/(chat)/api/chat/session/route.ts
import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { db } from "@/lib/db"; // ajusta si tu cliente drizzle está en otra ruta
import { webSessionThread } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";

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
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0,
      v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Crea la tabla si no existe (auto-migración en caliente). */
async function ensureTableExists() {
  // SQL equivalente a tu schema.ts
  const ddl = sql`
    CREATE TABLE IF NOT EXISTS "WebSessionThread" (
      "sessionId" uuid PRIMARY KEY,
      "threadId" varchar(128) NOT NULL,
      "channel" varchar(32) NOT NULL,
      "chatId" uuid,
      "createdAt" timestamptz NOT NULL,
      "updatedAt" timestamptz NOT NULL,
      "kommoLeadId" varchar(64),
      "kommoContactId" varchar(64)
    );
  `;
  // drizzle v0.30+ soporta db.execute(sql``)
  // en otras versiones, db.run/execute puede variar; esto funciona en la mayoría de setups con drizzle-orm/pg
  // @ts-ignore
  await db.execute?.(ddl) ?? db.run?.(ddl);
}

async function getRow(sessionId: string) {
  return await db
    .select({
      sessionId: webSessionThread.sessionId,
      threadId: webSessionThread.threadId,
    })
    .from(webSessionThread)
    .where(eq(webSessionThread.sessionId, sessionId))
    .limit(1);
}

async function insertRow(sessionId: string, threadId: string) {
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
}

async function ensureThreadId(sessionId: string): Promise<string> {
  // 1) DB first
  try {
    // a) Intento normal
    let rows = await getRow(sessionId);

    // b) Si no existe registro, creo thread y guardo
    if (!rows?.[0]?.threadId) {
      const created = await openai.beta.threads.create({});
      const threadId = created.id;
      await insertRow(sessionId, threadId);
      return threadId;
    }
    return rows[0].threadId;

  } catch (e: any) {
    const code = e?.code || e?.original?.code;
    const msg  = e?.message || String(e);

    // Si la causa es "tabla no existe", auto-migramos y reintentamos una vez
    if (code === "42P01" || /relation "WebSessionThread" does not exist/i.test(msg)) {
      console.warn("CV:/api/chat/session auto-migration: creating WebSessionThread…");
      try {
        await ensureTableExists();
        // reintento
        let rows = await getRow(sessionId);
        if (!rows?.[0]?.threadId) {
          const created = await openai.beta.threads.create({});
          const threadId = created.id;
          await insertRow(sessionId, threadId);
          return threadId;
        }
        return rows[0].threadId;
      } catch (e2: any) {
        console.warn("CV:/api/chat/session auto-migration failed; using MEMORY fallback", e2);
      }
    } else {
      console.warn("CV:/api/chat/session DB path failed, using MEMORY fallback", e);
    }

    // 2) Fallback en memoria
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
