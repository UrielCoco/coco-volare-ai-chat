import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { db } from "@/lib/db";
import { webSessionThread } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";

async function ensureTableExists() {
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
    );`;
  // @ts-ignore
  await (db.execute?.(ddl) ?? db.run?.(ddl));
}

async function getRowBySessionId(sessionId: string) {
  // @ts-ignore
  return await db.select().from(webSessionThread).where(eq(webSessionThread.sessionId, sessionId));
}

async function insertRow(sessionId: string, threadId: string) {
  const now = new Date();
  // @ts-ignore
  await db.insert(webSessionThread).values({
    sessionId,
    threadId,
    channel: "webchat",
    createdAt: now,
    updatedAt: now,
  });
}

function uuidv4() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export async function GET(req: NextRequest) {
  try {
    const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
    const cookie = req.cookies.get("cv_session")?.value || "";
    const sessionId = cookie || uuidv4();

    let threadId: string | null = null;
    try {
      await ensureTableExists();
      const rows = await getRowBySessionId(sessionId);
      if (rows?.[0]?.threadId) {
        threadId = rows[0].threadId;
      } else {
        const created = await openai.beta.threads.create({});
        threadId = created.id;
        await insertRow(sessionId, threadId);
      }
    } catch (e) {
      console.warn("CV:/api/chat/session DB path failed → fallback", e);
      const created = await openai.beta.threads.create({});
      threadId = created.id;
    }

    const res = NextResponse.json({ ok: true, sessionId, threadId });
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
