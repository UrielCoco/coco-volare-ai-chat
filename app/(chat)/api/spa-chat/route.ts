// app/(chat)/api/spa-chat/route.ts
export async function POST(req: Request) {
  console.log("[spa-chat:req]", { method: "POST", path: "/api/spa-chat" });

  try {
    const body = await req.json();
    console.log("[spa-chat:body]", body);

    // ... tu lógica con OpenAI/Assistant ...

    // ejemplo de enviar SSE/NDJSON:
    const stream = new ReadableStream({
      async start(controller) {
        const send = (obj: unknown) =>
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(obj)}\n`));

        send({ event: "assistant", payload: { content: "¡Listo! Estoy armando tu itinerario…" } });
        send({ event: "itinerary", payload: { partial: { meta: { tripTitle: "New Trip" } } } });
        // ...
        controller.close();
      }
    });

    return new Response(stream, {
      headers: { "Content-Type": "text/event-stream; charset=utf-8" }
    });
  } catch (e: any) {
    console.error("[spa-chat:error]", e);
    return new Response(`Error: ${e?.message ?? e}`, { status: 500 });
  }
}
