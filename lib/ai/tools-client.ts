/**
 * lib/ai/tools-client.ts – cliente del Hub
 * Opción A: usa tus envs reales
 *   - URL:   NEXT_PUBLIC_HUB_BASE_URL
 *   - SECRET: HUB_BRAIN_SECRET o HUB_BRIDGE_SECRET (el que tengas)
 */

const HUB = process.env.NEXT_PUBLIC_HUB_BASE_URL!;
const SECRET =
  process.env.HUB_BRAIN_SECRET || process.env.HUB_BRIDGE_SECRET || "";

if (!HUB) {
  console.warn("NEXT_PUBLIC_HUB_BASE_URL is not set");
}

async function callHub(action: string, payload: any) {
  const res = await fetch(`${HUB}/api/hub`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-hub-secret": SECRET,
    },
    body: JSON.stringify({ action, payload }),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`hub ${action} failed: ${res.status} ${text}`);
  }
  return await res.json();
}

export const hubBuildItinerary = (p: any) => callHub("itinerary.build", p);
export const hubQuote = (p: any) => callHub("quote", p);
export const hubRender = (p: any) => callHub("render", p);
export const hubSend = (p: any) => callHub("send", p);
