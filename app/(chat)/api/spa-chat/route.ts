// app/(chat)/api/spa-chat/route.ts
/* eslint-disable @next/next/no-server-import-in-page */
/// <reference lib="webworker" />
// @ts-nocheck
import OpenAI from "openai";

export const runtime = "edge";

function sseHeaders() {
  return {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  };
}

// Pequeño helper para loguear bonito en Vercel
function log(label: string, data: unknown) {
  try {
    console.log(`[spa-chat] ${label}:`, typeof data === "string" ? data : JSON.stringify(data));
  } catch {
    console.log(`[spa-chat] ${label} (unserializable)`);
  }
}

export async function POST(req: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";

  if (!apiKey) {
    return new Response("Missing OPENAI_API_KEY", { status: 500 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  const {
    messages = [],
    system,
    tools, // si quieres pasar tools (function calling) desde el front
    metadata,
  } = body || {};

  // Logs de entrada
  log("REQUEST.messages", messages);
  if (system) log("REQUEST.system", system);
  if (tools) log("REQUEST.tools", tools);
  if (metadata) log("REQUEST.metadata", metadata);

  const client = new OpenAI({ apiKey });

  // Creamos el ReadableStream que reemite 1:1 el stream de OpenAI como SSE
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const rspStream = await client.responses.stream({
          model,
          // Pasamos el system si lo mandas
          ...(system ? { system } : {}),
          // Mensajes tal cual los mandas (user/assistant/system/tool)
          input: messages,
          // Si pasas tools (function calling)
          ...(tools ? { tools } : {}),
          // Podrías anexar metadata si te sirve
          ...(metadata ? { metadata } : {}),
        });

        // Logs de fases principales
        rspStream.on("response.created", (e) => log("response.created", e));
        rspStream.on("response.refusal.delta", (e) => log("response.refusal.delta", e));
        rspStream.on("message", (e) => log("message", e));
        rspStream.on("response.output_text.delta", (e) => log("output_text.delta", e));
        rspStream.on("response.output_text.done", (e) => log("output_text.done", e));
        rspStream.on("response.completed", (e) => log("response.completed", e));
        rspStream.on("error", (e) => log("ERROR", e));

        // Re-emitimos **tal cual** cada evento como SSE (NDJSON por línea)
        rspStream.on("event", (event) => {
          try {
            const line = `data: ${JSON.stringify(event)}\n\n`;
            controller.enqueue(new TextEncoder().encode(line));
          } catch (err) {
            log("enqueue.error", err);
          }
        });

        // Cuando termina, cerramos
        rspStream.on("end", () => {
          controller.enqueue(new TextEncoder().encode("event: done\ndata: {}\n\n"));
          controller.close();
        });

        // Arranca
        await rspStream.start();
      } catch (err: any) {
        log("fatal", err?.message || err);
        const payload = {
          ok: false,
          error: {
            message: err?.message || "OpenAI stream error",
            code: err?.code || null,
          },
        };
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`));
        controller.enqueue(new TextEncoder().encode("event: done\ndata: {}\n\n"));
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: sseHeaders() });
}
