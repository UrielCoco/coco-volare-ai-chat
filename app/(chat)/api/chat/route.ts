import { NextRequest } from "next/server";
import { __cvResolveBlob } from "@/lib/ai/providers/openai-assistant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id") || "";
    const name = searchParams.get("name") || "document";

    if (!id) return new Response("missing id", { status: 400 });

    const blob = __cvResolveBlob(id);
    if (!blob) return new Response("not found", { status: 404 });

    // ✅ Construimos un Uint8Array que apunta SOLO al segmento útil del Buffer
    const u8 = new Uint8Array(
      blob.bin.buffer as ArrayBuffer, // puede ser union, pero Uint8Array lo acepta
      blob.bin.byteOffset,
      blob.bin.byteLength
    );

    const headers = new Headers();
    headers.set("content-type", blob.mime);
    headers.set(
      "content-disposition",
      `inline; filename="${name || blob.filename}"`
    );
    headers.set("cache-control", "no-store");

    // ✅ Response acepta Uint8Array sin problemas
    return new Response(u8, { status: 200, headers });
  } catch {
    return new Response("error", { status: 500 });
  }
}
