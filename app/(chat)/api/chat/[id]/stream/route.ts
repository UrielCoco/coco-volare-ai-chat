import { NextRequest, NextResponse } from "next/server";
import { runAssistantOnce } from "@/lib/ai/providers/openai-assistant";

// Importa solo lo que tienes disponible en tu lib:
import { kommoAddNote, kommoCreateLead } from "@/lib/kommo-sync";

const RE_KOMMO = /```cv:kommo\s*([\s\S]*?)```/i;

export const runtime = "nodejs";

/** Normaliza el leadId que pueda regresar tu lib (number u objeto) */
function pickLeadId(result: any): number | null {
  if (typeof result === "number") return result;
  if (result && typeof result === "object") {
    if (typeof result.lead_id === "number") return result.lead_id;
    if (typeof result.id === "number") return result.id;
    if (typeof result?.data?.lead_id === "number") return result.data.lead_id;
  }
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

    // —— Procesar bloque oculto cv:kommo, si viene ——
    const m = reply.match(RE_KOMMO);
    if (m?.[1]) {
      try {
        const ops = JSON.parse(m[1]);
        console.log("[CV][kommo] ops:", JSON.stringify(ops));

        // Ejecuta side-effects sin bloquear la respuesta
        (async () => {
          try {
            const list = Array.isArray(ops?.ops) ? ops.ops : [];
            const needsCreate = list.some((o: any) => o?.action === "create_lead");
            let leadId: number | null = null;

            if (needsCreate) {
              // ✅ tu función espera string, no objeto
              const created = await kommoCreateLead("Lead desde webchat");
              leadId = pickLeadId(created);
              console.log("[CV][kommo] leadId:", leadId);
            }

            // add_note
            for (const op of list) {
              if (op?.action === "add_note") {
                const text = typeof op?.text === "string" ? op.text : `🧑‍💻 Usuario: ${userInput}`;
                if (leadId != null) {
                  await kommoAddNote(leadId, text); // ✅ tu función espera (number, string)
                }
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

    // —— al cliente le mandamos TAL CUAL (no tocamos cv:itinerary) ——
    return NextResponse.json({ reply, threadId: ensuredThread || threadId || null });
  } catch (e: any) {
    console.error(JSON.stringify({ level: "error", tag: "[CV][server]", msg: "exception", meta: { traceId, error: String(e?.message || e) } }));
    const fallback =
      /[a-zA-Z]/.test((await req.text().catch(() => "")) || "") ?
      "An error occurred, we apologize for the inconvenience." :
      "Ocurrió un error, lamentamos los inconvenientes.";
    return NextResponse.json({ reply: fallback }, { status: 500 });
  }
}
