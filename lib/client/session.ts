// lib/client/session.ts
export const CV_SESSION_KEY = "cv_session";

function isBrowser() {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

async function fetchJson(input: RequestInfo, init?: RequestInit) {
  const res = await fetch(input, init);
  const text = await res.text();
  try {
    const json = JSON.parse(text);
    if (!res.ok) throw Object.assign(new Error(json?.error || res.statusText), { status: res.status, json });
    return json;
  } catch {
    if (!res.ok) throw Object.assign(new Error(text || res.statusText), { status: res.status, text });
    return text as any;
  }
}

/**
 * Obtiene/crea el sessionId y lo persiste en localStorage.
 * Llama a /api/chat/session para obtener (o crear) el threadId asociado en backend.
 */
export async function ensureWebSession(): Promise<{ sessionId: string; threadId: string }> {
  if (!isBrowser()) {
    // SSR: deja que el backend gestione la sesión; retorna placeholders
    return { sessionId: "", threadId: "" };
  }

  let sid = localStorage.getItem(CV_SESSION_KEY) || "";

  // Pide/renueva datos de la sesión al backend (también setea cookie)
  const url = sid ? `/api/chat/session?sid=${encodeURIComponent(sid)}` : `/api/chat/session`;
  const data = await fetchJson(url, {
    method: "GET",
    headers: sid ? { "x-cv-session": sid } : undefined,
    cache: "no-store",
  });

  const sessionId = data.sessionId as string;
  const threadId  = data.threadId  as string;

  if (sessionId && sessionId !== sid) {
    localStorage.setItem(CV_SESSION_KEY, sessionId);
  }

  return { sessionId, threadId };
}

/**
 * Lee el sessionId actual (si existe) sin hacer red.
 * Si no existe, retorna string vacío.
 */
export function peekSessionId(): string {
  if (!isBrowser()) return "";
  return localStorage.getItem(CV_SESSION_KEY) || "";
}
