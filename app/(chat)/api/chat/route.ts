import { NextRequest, NextResponse } from "next/server";
import { runAssistantWithTools } from "@/lib/ai/providers/openai-assistant";

export async function POST(req: NextRequest) {
  try {
    const { messages } = await req.json();
    const userMsg = messages?.[messages.length - 1]?.content || "";

    console.log("CV:/api/chat START msg.len=", userMsg.length);

    const hubBaseUrl = process.env.NEXT_PUBLIC_HUB_BASE_URL!;
    const hubSecret = process.env.HUB_BRIDGE_SECRET!;
    if (!hubBaseUrl || !hubSecret) throw new Error("Hub config missing");

    const result = await runAssistantWithTools(userMsg, {
      hubBaseUrl,
      hubSecret,
    });

    console.log("CV:/api/chat END toolEvents=", result.toolEvents);

    return NextResponse.json({
      reply: result.reply,
      threadId: result.threadId,
      toolEvents: result.toolEvents,
    });
  } catch (err: any) {
    console.error("CV:/api/chat ERROR:", err);
    return NextResponse.json({ error: String(err?.message || err) }, { status: 500 });
  }
}
