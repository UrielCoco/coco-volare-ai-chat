// lib/ai/tools-client.ts – cliente del Hub con logs simples
const HUB = process.env.NEXT_PUBLIC_HUB_BASE_URL!;
const SECRET =
  process.env.HUB_BRAIN_SECRET || process.env.HUB_BRIDGE_SECRET || "";

async function callHub(action: string, payload: any) {
  const url = `${HUB.replace(/\/$/, "")}/api/hub`;
  const body = { action, payload };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-hub-secret": SECRET,
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    const text = await res.text();
    try {
      const json = JSON.parse(text);
      if (!res.ok) {
        console.error("CV:/hub error", action, res.status, json);
        throw new Error(`hub ${action} failed: ${res.status}`);
      }
      return json;
    } catch {
      console.error("CV:/hub non-json response", action, res.status, text);
      throw new Error(`hub ${action} non-json`);
    }
  } catch (e: any) {
    console.error("CV:/hub fetch ERROR", action, e?.message || e);
    throw e;
  }
}

export const hubBuildItinerary = (p: any) => callHub("itinerary.build", p);
export const hubQuote = (p: any) => callHub("quote", p);
export const hubRender = (p: any) => callHub("render", p);
export const hubSend = (p: any) => callHub("send", p);
