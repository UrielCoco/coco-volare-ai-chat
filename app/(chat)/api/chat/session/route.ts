// app/(chat)/api/chat/session/route.ts
import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { db } from "@/lib/db";
import { webSessionThread } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { kommoCreateLead } from "@/lib/kommo-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";

// ---------- DB helpers (a nivel módulo para evitar scope issues) ----------
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
    );
  `;
  // @ts-ignore drizzle variance
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

async function updateRow(sessionId: string, patch: Record<string, any>) {
  // @ts-ignore
  await db.update(webSessionThread).set(patch).where(eq(webSessionThread.sessionId, sessionId));
}

// ---------- Memory fallback ----------
const SESSION_MAP: Map<string, { threadId: string; updatedAt: number; kommoLeadId?: string }> =
  (global as any).__cvSessionMap || new Map();
(global as any).__cvSessionMap = SESSION_MAP;

// ---------- Util ----------
function uuidv4() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

async function ensureKommoLead(sessionId: string, nameHint?: string): Promise<number | null> {
  try {
    // DB first
    try {
      const rows = await getRowBySessionId(sessionId);
      const row = rows?.[0];
      if (row?.kommoLeadId) return Number(row.kommoLeadId);
    } catch (e) {
      // ignored
    }
    // Create via Hub/Kommo
    const leadName = nameHint || `Coco Volare Webchat · ${sessionId.slice(0, 8)}`;
    const res: any = await kommoCreateLead(leadName, { source: "webchat", notes: "Sesión iniciada desde webchat" });
    const leadId = Number(res?.data?.lead_id || res?.data?.id || 0) || null;
    if (leadId) {
      try {
        await updateRow(sessionId, { kommoLeadId: String(leadId) });
      } catch (e) {
        // en caso de que tabla no exista todavía
        const mem = SESSION_MAP.get(sessionId) || { threadId: "", updatedAt: Date.now() };
        mem.kommoLeadId = String(leadId);
        SESSION_MAP.set(sessionId, mem);
      }
      return leadId;
    }
  } catch (e) {
    console.warn("CV:/api/chat/session ensureKommoLead error", e);
  }
  return null;
}

// ---------- Handler ----------
export async function GET(req: NextRequest) {
  try {
    const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
    const cookie = req.cookies.get("cv_session")?.value || "";
    const sessionId = cookie || uuidv4();

    // 1) DB path
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
      console.warn("CV:/api/chat/session DB path failed → memory fallback", e);
    }

    // 2) Memory fallback si DB falló
    if (!threadId) {
      const mem = SESSION_MAP.get(sessionId);
      if (mem?.threadId) {
        threadId = mem.threadId;
      } else {
        const created = await openai.beta.threads.create({});
        threadId = created.id;
        SESSION_MAP.set(sessionId, { threadId, updatedAt: Date.now() });
      }
    }

    // 3) Asegurar lead en Kommo (no bloqueante)
    ensureKommoLead(sessionId).catch(e => console.warn("CV:/api/chat/session kommo lead init failed", e));

    // 4) Responder y setear cookie
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
