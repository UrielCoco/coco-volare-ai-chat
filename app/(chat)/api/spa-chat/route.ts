// /app/api/spa-chat/route.ts
/* eslint-disable no-console */
import OpenAI from "openai";
import type { NextRequest } from "next/server";

export const runtime = "edge";          // Edge runtime = Web Streams (sin @types/node)
export const dynamic = "force-dynamic"; // evita cache en Vercel/Next

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
const ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID!; // ← tienes esta var en Vercel

// Helper SSE
const enc = new TextEncoder();
function send(controller: ReadableStreamDefaultController, event: string, data: any) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  controller.enqueue(enc.encode(payload));
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      messages?: Array<{ role: "user" | "assistant" | "system"; content: string }>;
    };

    const messages = body.messages ?? [];
    if (!ASSISTANT_ID) {
      return new Response("Missing OPENAI_ASSISTANT_ID", { status: 500 });
    }

    const stream = new ReadableStream({
      start: async (controller) => {
        try {
          // 1) Crea thread y envía TODO el historial que venga del front
          const thread = await openai.beta.threads.create();

          // Importante: solo agregamos mensajes de usuario/assistant; los system no aplican en threads
          for (const m of messages) {
            const role = m.role === "assistant" ? "assistant" : "user";
            await openai.beta.threads.messages.create(thread.id, {
              role,
              content: m.content,
            });
          }

          // 2) Lanza el run del Assistant con streaming de eventos
          const runStream: any = await openai.beta.threads.runs.stream(thread.id, {
            assistant_id: ASSISTANT_ID,
            stream: true,
            tool_choice: "auto",
          });

          // Texto delta (lo que tu hook mapea a 'delta')
          runStream.on("textDelta", (e: any) => {
            // e.value es el chunk
            send(controller, "delta", { value: e?.value ?? "" });
          });

          // Tool calls: argumentos parciales (tu hook espera 'tool_call.arguments.delta')
          runStream.on("toolCallDelta", (e: any) => {
            // e.id, e.name, e.delta (string incremental)
            send(controller, "tool_call.arguments.delta", {
              id: e?.id ?? "tc",
              name: e?.name,
              arguments: { delta: e?.delta ?? "" },
            });
          });

          // Tool calls: completado con args totales (tu hook espera 'tool_call.completed')
          runStream.on("toolCallCompleted", (e: any) => {
            // e.id, e.name, e.args (string completo con el JSON)
            send(controller, "tool_call.completed", {
              id: e?.id ?? "tc",
              name: e?.name,
              arguments: typeof e?.args === "string" ? e.args : "",
            });
          });

          // Fin de stream
          runStream.on("end", () => {
            send(controller, "done", { text: "" });
            controller.close();
          });

          // Errores
          runStream.on("error", (err: any) => {
            console.error("[assistants stream error]", err);
            send(controller, "error", { message: String(err), err });
            try { controller.close(); } catch {}
          });
        } catch (err: any) {
          console.error("[route error]", err);
          send(controller, "error", { message: String(err), err });
          try { controller.close(); } catch {}
        }
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (e: any) {
    return new Response(`Bad Request: ${e?.message || e}`, { status: 400 });
  }
}
