import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { webSessionThread } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { kommoAddNote } from "@/lib/kommo-sync";
import { runAssistantOnce } from "@/lib/ai/providers/openai-assistant";
import { appendPart } from "@/lib/session-state";

export const runtime = "nodejs";

async function getThreadBySession(sessionId: string): Promise<string | null> {
  try {
    // @ts-ignore
    const rows = await db.select().from(webSessionThread).where(eq(webSessionThread.sessionId, sessionId));
    const row: any = rows?.[0];
    return row?.threadId || null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const traceId = `str_${Math.random().toString(36).slice(2)}`;
  const nowIso = new Date().toISOString();
  try {
    const body = await req.json().catch(() => ({} as any));

    const rawText =
      body?.message?.parts?.[0]?.text ??
      body?.message?.text ??
      body?.message ??
      body?.text ??
      "";
    const userInput: string = String(rawText || "").trim();

    const cookieThread = req.cookies.get("cv_thread_id")?.value ?? null;
    const cookieSession = req.cookies.get("cv_session")?.value ?? null;
    const bodyThread = body?.threadId || body?.thread_id || null;
    const bodySession = body?.sessionId || body?.session_id || null;

    // Sesión final que usaremos
    const sessionId = bodySession || cookieSession || "no-session";
    // Intento de thread preferente: body → cookie → DB por session
    let threadId: string | null = bodyThread || cookieThread || null;
    if (!threadId && sessionId !== "no-session") {
      threadId = await getThreadBySession(sessionId);
    }

    console.log(JSON.stringify({
      level: "info",
      tag: "[CV][server]",
      msg: "incoming",
      meta: { nowIso, sessionId, cookieThread, bodyThread, chosenThread: threadId, textPreview: userInput.slice(0, 120) }
    }));

    appendPart(sessionId, "user", userInput);

    // Si ya hay lead asociado en tu DB y quieres log, deja esta llamada (silenciosa si falla)
    try {
      const leadId = Number((await (await import("@/lib/session-state")).getLeadId(sessionId)) || 0) || null;
      if (leadId) await kommoAddNote(leadId, `🧑‍💻 Usuario: ${userInput}`);
    } catch (e) {
      console.warn("[CV][server] kommo user note failed", e);
    }

    // Assistant
    const { reply, threadId: ensuredThread } = await runAssistantOnce({
      input: userInput,
      threadId: threadId || undefined,
      metadata: { source: "webchat", sessionId },
    });

    // Guardar cookie del thread si veníamos sin una
    const res = NextResponse.json({ reply, threadId: ensuredThread || threadId || null });
    if (!cookieThread && ensuredThread) {
      res.cookies.set("cv_thread_id", ensuredThread, {
        httpOnly: true,
        path: "/",
        maxAge: 60 * 60 * 24 * 7,
      });
    }

    console.log(JSON.stringify({
      level: "info",
      tag: "[CV][server]",
      msg: "reply",
      meta: { sessionId, ensuredThread, replyPreview: reply.slice(0, 140) }
    }));

    appendPart(sessionId, "assistant", reply);
    return res;
  } catch (error: any) {
    console.error(JSON.stringify({
      level: "error",
      tag: "[CV][server]",
      msg: "Assistant error",
      meta: { traceId, error: String(error?.message || error) }
    }));
    return NextResponse.json({ error: "assistant_error" }, { status: 500 });
  }
}
