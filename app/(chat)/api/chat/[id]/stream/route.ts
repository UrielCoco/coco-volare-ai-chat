// app/(chat)/api/chat/[id]/stream/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { webSessionThread } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { kommoAddNote } from "@/lib/kommo-sync";
import { runAssistantOnce } from "@/lib/ai/providers/openai-assistant";

export const runtime = "nodejs";

async function getKommoLeadId(sessionId: string): Promise<number | null> {
  try {
    // @ts-ignore
    const rows = await db.select().from(webSessionThread).where(eq(webSessionThread.sessionId, sessionId));
    const row: any = rows?.[0];
    if (row?.kommoLeadId) return Number(row.kommoLeadId);
  } catch (e) {
    console.warn("CV:/chat/[id]/stream getKommoLeadId failed", e);
  }
  return null;
}

export async function POST(req: NextRequest) {
  const traceId = `str_${Math.random().toString(36).slice(2)}`;
  try {
    const body = await req.json().catch(() => ({} as any));

    const text =
      body?.message?.parts?.[0]?.text ??
      body?.message?.text ??
      body?.message ??
      body?.text ??
      "";
    const userInput: string = String(text || "").trim();

    const existingThread: string | null =
      body?.threadId || body?.thread_id || (req.cookies.get("cv_thread_id")?.value ?? null);
    const sessionId: string | null =
      body?.sessionId || body?.session_id || (req.cookies.get("cv_session")?.value ?? null);

    // Nota del usuario en Kommo (no rompe flujo si falla)
    if (sessionId && userInput) {
      try {
        const leadId = await getKommoLeadId(sessionId);
        if (leadId) await kommoAddNote(leadId, `🧑‍💻 Usuario: ${userInput}`);
      } catch (e) {
        console.warn("CV:kommo add user note failed", e);
      }
    }

    // Llamar Assistant
    const { reply, threadId } = await runAssistantOnce({
      input: userInput,
      threadId: existingThread || undefined,
      metadata: { source: "webchat" },
    });

    // Nota de respuesta del asistente
    if (sessionId && reply) {
      try {
        const leadId = await getKommoLeadId(sessionId);
        if (leadId) await kommoAddNote(leadId, `🤖 Asistente: ${reply}`);
      } catch (e) {
        console.warn("CV:kommo add assistant note failed", e);
      }
    }

    console.log(JSON.stringify({ level: "info", traceId, msg: "stream.reply", meta: { replyPreview: reply.slice(0, 120) } }));
    const res = NextResponse.json({ reply, threadId: threadId || existingThread || null });

    if (!existingThread && threadId) {
      res.cookies.set("cv_thread_id", threadId, {
        httpOnly: true,
        path: "/",
        maxAge: 60 * 60 * 24 * 7,
      });
    }

    return res;
  } catch (error: any) {
    console.error(JSON.stringify({ level: "error", msg: "Assistant error", meta: { traceId, error: String(error?.message || error) } }));
    return NextResponse.json({ error: "assistant_error" }, { status: 500 });
  }
}
