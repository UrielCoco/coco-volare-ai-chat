// app/(chat)/api/chat/pull/route.ts
import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

export async function POST(req: NextRequest) {
  try {
    const { threadId, knownFingerprint } = await req.json();

    if (!threadId || typeof threadId !== 'string') {
      return NextResponse.json({ error: 'Missing threadId' }, { status: 400 });
    }

    // Firma compatible (objeto/posicional) para listar mensajes
    let msgs: any;
    try {
      msgs = await (client.beta.threads.messages as any).list({ thread_id: threadId, order: 'desc', limit: 10 });
    } catch {
      msgs = await (client.beta.threads.messages as any).list(threadId, { order: 'desc', limit: 10 });
    }

    // Une todo el texto de los últimos mensajes del assistant por si vinieron en varias partes
    const assistantTexts: string[] = [];
    for (const m of msgs.data) {
      if (m.role !== 'assistant') continue;
      let txt = '';
      for (const c of m.content) if (c.type === 'text') txt += (c.text?.value || '') + '\n';
      txt = txt.trim();
      if (txt) assistantTexts.push(txt);
    }

    if (assistantTexts.length === 0) {
      return NextResponse.json({ hasUpdate: false });
    }

    // Usamos el texto más reciente (posición 0 porque orden desc)
    const latest = assistantTexts[0];
    const fingerprint = String(latest).slice(0, 512); // huella simple (evita calcular hash)

    if (knownFingerprint && typeof knownFingerprint === 'string' && knownFingerprint === fingerprint) {
      return NextResponse.json({ hasUpdate: false });
    }

    // Enviamos el texto crudo tal cual; el front se encarga de parsear cv:itinerary/kommo como siempre
    return NextResponse.json({
      hasUpdate: true,
      reply: latest,
      fingerprint,
    });
  } catch (err: any) {
    return NextResponse.json({ hasUpdate: false, error: String(err?.message || err) }, { status: 500 });
  }
}
