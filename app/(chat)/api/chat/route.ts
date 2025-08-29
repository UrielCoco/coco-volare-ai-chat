import { NextRequest, NextResponse } from "next/server";
import { runAssistantOnce } from "@/lib/ai/providers/openai-assistant";
import { kommoAddNote, kommoCreateLead } from "@/lib/kommo-sync";

const RE_KOMMO = /```cv:kommo\s*([\s\S]*?)```/i;

export const runtime = "nodejs";

function pickLeadId(x: any): number | null {
  if (typeof x === "number") return x;
  if (!x || typeof x !== "object") return null;
  if (typeof x.lead_id === "number") return x.lead_id;
  if (typeof x.id === "number") return x.id;
  if (typeof x?.data?.lead_id === "number") return x.data.lead_id;
  if (Array.isArray(x?.data?.leads) && typeof x.data.leads[0]?.id === "number") return x.data.leads[0].id;
  return null;
}

export async function POST(req: NextRequest) {
  const traceId = `cv_${Math.random().toString(36).slice(2)}`;

  try {
    const body = await req.json().catch(() => ({} as any));
    const rawText =
      body?.message?.parts?.[0]?.text ??
      body?.message?.text ??
      body?.message ??
      body?.text ??
      "";
    const userInput: string = String(rawText || "").trim();
    const threadId = body?.threadId || body?.thread_id || undefined;

    const { reply, threadId: ensuredThread } = await runAssistantOnce({
      input: userInput,
      threadId,
      metadata: { source: "webchat" },
    });

    // Procesa cv:kommo sin bloquear la respuesta
    const m = reply.match(RE_KOMMO);
    if (m?.[1]) {
      try {
        const ops = JSON.parse(m[1]);
        (async () => {
          try {
            const list = Array.isArray(ops?.ops) ? ops.ops : [];
            let leadId: number | null = null;

            if (list.some((o: any) => o?.action === "create_lead")) {
              const created = await kommoCreateLead("Lead desde webchat"); // ← STRING, no objeto
              leadId = pickLeadId(created);
            }

            for (const op of list) {
              if (op?.action === "add_note" && leadId != null) {
                const text = typeof op?.text === "string" ? op.text : `🧑‍💻 Usuario: ${userInput}`;
                await kommoAddNote(leadId, text); // ← (leadId:number, text:string)
              }
            }
          } catch (err) {
            console.warn("[CV][kommo] failed:", err);
          }
        })();
      } catch (err) {
        console.warn("[CV][kommo] invalid json:", err);
      }
    }

    return NextResponse.json({ reply, threadId: ensuredThread || threadId || null });
  } catch (e: any) {
    console.error(JSON.stringify({ level: "error", tag: "[CV][server]", msg: "exception", meta: { traceId, error: String(e?.message || e) } }));
    return NextResponse.json(
      { reply: "Ocurrió un error, lamentamos los inconvenientes. / An error occurred, we apologize for the inconvenience." },
      { status: 500 }
    );
  }
}
