// lib/client/chat.ts
import { ensureWebSession, peekSessionId } from "./session";

type ChatMessage =
  | { role: "user" | "assistant" | "system"; content: string }
  | { role: "user" | "assistant" | "system"; content: Array<{ type?: string; text?: string; content?: string; value?: string }> };

type ChatResponse = {
  reply?: string;
  threadId?: string;
  toolEvents?: Array<{ name: string; status: number; ok: boolean }>;
  sessionId?: string;
  ms?: number;
  error?: string;
};

async function postJson(input: string, body: any, headers: HeadersInit): Promise<ChatResponse> {
  const res = await fetch(input, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  try {
    const json = JSON.parse(text);
    if (!res.ok) throw Object.assign(new Error(json?.error || res.statusText), { status: res.status, json });
    return json as ChatResponse;
  } catch {
    if (!res.ok) throw Object.assign(new Error(text || res.statusText), { status: res.status, text });
    return { reply: text } as ChatResponse;
  }
}

/**
 * Envía un input de usuario al endpoint /api/chat manteniendo el mismo thread.
 * Acepta ya sea `text` string o un arreglo `messages` (formato OpenAI-like).
 */
export async function sendChat(input: { text?: string; messages?: ChatMessage[] }): Promise<ChatResponse> {
  // 1) Asegura que tenemos sesión y thread en backend (y setea cookie/lstorage)
  await ensureWebSession();

  // 2) Lee el sessionId para mandarlo como header
  const sid = peekSessionId();

  // 3) Prepara el cuerpo compatible con tu backend (/api/chat)
  let body: any;
  if (input?.messages?.length) {
    body = { messages: input.messages };
  } else {
    const text = (input?.text || "").trim();
    body = { messages: [{ role: "user", content: text }] };
  }

  // 4) POST con header x-cv-session SIEMPRE
  const res = await postJson("/api/chat", body, {
    "content-type": "application/json",
    ...(sid ? { "x-cv-session": sid } : {}),
  });

  // Logs útiles en consola del navegador
  if (res.toolEvents?.length) {
    // eslint-disable-next-line no-console
    console.log("CV: toolEvents", res.toolEvents);
  }
  if (res.error) {
    // eslint-disable-next-line no-console
    console.warn("CV: chat error", res.error);
  }
  return res;
}
