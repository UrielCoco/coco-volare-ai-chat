import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { webSessionThread } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { kommoAddNote, kommoAttachTranscript, kommoAttachContact, kommoCreateLead } from "@/lib/kommo-sync";
import { runAssistantOnce } from "@/lib/ai/providers/openai-assistant";
import { appendPart, buildTranscript, getLeadId, setKommoLead } from "@/lib/session-state";
import { extractBlocks } from "@/lib/block-parser";

export const runtime = "nodejs";

async function getKommoLeadIdFromDB(sessionId: string): Promise<number | null> {
  try {
    // @ts-ignore
    const rows = await db.select().from(webSessionThread).where(eq(webSessionThread.sessionId, sessionId));
    const row: any = rows?.[0];
    if (row?.kommoLeadId) return Number(row.kommoLeadId);
  } catch (e) { console.warn("CV:/chat/[id]/stream getKommoLeadId failed", e); }
  return null;
}
async function persistLeadId(sessionId: string, leadId: number) {
  try {
    // @ts-ignore
    await db.update(webSessionThread).set({ kommoLeadId: String(leadId) }).where(eq(webSessionThread.sessionId, sessionId));
  } catch {}
  setKommoLead(sessionId, leadId);
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

    if (!sessionId) return NextResponse.json({ error: "no_session" }, { status: 400 });

    // Guardar turno USER y nota (lead si existe)
    appendPart(sessionId, "user", userInput);
    const maybeLead = getLeadId(sessionId) ?? (await getKommoLeadIdFromDB(sessionId));
    if (maybeLead) {
      try { await kommoAddNote(maybeLead, `🧑‍💻 Usuario: ${userInput}`); } catch (e) { console.warn("CV:kommo add user note failed", e); }
    }

    // Assistant responde
    const { reply, threadId } = await runAssistantOnce({
      input: userInput,
      threadId: existingThread || undefined,
      metadata: { source: "webchat" },
    });

    // Procesar bloques (itinerary/quote visibles, kommo oculto)
    const { clean, blocks } = extractBlocks(reply);

    // Ejecutar BLOQUE OCULTO cv:kommo si existe
    const kommoBlock = blocks.find(b => b.kind === 'kommo') as any;
    let leadId: number | null = getLeadId(sessionId) ?? null;

    if (kommoBlock?.json?.ops?.length) {
      for (const op of kommoBlock.json.ops) {
        const action = String(op?.action || "").toLowerCase();

        if (action === "create_lead") {
          try {
            const res: any = await kommoCreateLead(op?.name || `Coco Volare Webchat · ${sessionId.slice(0,8)}`, { source: "webchat" });
            const id = Number(res?.data?.lead_id || 0) || null;
            if (id) {
              leadId = id;
              await persistLeadId(sessionId, id);
            }
          } catch (e) { console.warn("CV:kommo create_lead failed", e); }
        }

        if (action === "add_note" && (leadId || maybeLead)) {
          try { await kommoAddNote(leadId || maybeLead!, String(op?.text || "").slice(0, 16000)); } catch (e) {}
        }

        if (action === "attach_transcript" && (leadId || maybeLead)) {
          try {
            const transcript = buildTranscript(sessionId);
            await kommoAttachTranscript(leadId || maybeLead!, transcript);
          } catch (e) { console.warn("CV:kommo attach_transcript failed", e); }
        }

        if (action === "attach_contact" && (leadId || maybeLead)) {
          try {
            await kommoAttachContact(leadId || maybeLead!, {
              name: op?.name || "Webchat Contact",
              email: op?.email || undefined,
              phone: op?.phone || undefined,
              notes: op?.notes || "Adjuntado automáticamente por el webchat",
            });
          } catch (e) { console.warn("CV:kommo attach_contact failed", e); }
        }
      }
    }

    // Guardar turno ASSISTANT y nota
    appendPart(sessionId, "assistant", clean);
    const finalLead = leadId ?? maybeLead ?? (await getKommoLeadIdFromDB(sessionId));
    if (finalLead) {
      try { await kommoAddNote(finalLead, `🤖 Asistente: ${clean}`); } catch {}
    }

    console.log(JSON.stringify({ level: "info", traceId, msg: "stream.reply", meta: { replyPreview: clean.slice(0, 120) } }));
    const res = NextResponse.json({ reply: clean, threadId: threadId || existingThread || null });

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
