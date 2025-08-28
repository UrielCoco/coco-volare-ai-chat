/**
 * Client wrappers that the tool handlers (in the chat route) will call.
 * These hit the agent-hub-brain endpoints so we don't duplicate logic.
 */
export async function hubBuildItinerary(payload: any) {
  const res = await fetch(`${process.env.HUB_BRAIN_URL}/api/itinerary/build`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-hub-secret": process.env.HUB_BRAIN_SECRET || "" },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`hubBuildItinerary failed: ${res.status}`);
  return await res.json();
}

export async function hubQuote(payload: any) {
  const res = await fetch(`${process.env.HUB_BRAIN_URL}/api/quote`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-hub-secret": process.env.HUB_BRAIN_SECRET || "" },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`hubQuote failed: ${res.status}`);
  return await res.json();
}

export async function hubRender(payload: any) {
  const res = await fetch(`${process.env.HUB_BRAIN_URL}/api/render`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-hub-secret": process.env.HUB_BRAIN_SECRET || "" },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`hubRender failed: ${res.status}`);
  return await res.json();
}

export async function hubSend(payload: any) {
  const res = await fetch(`${process.env.HUB_BRAIN_URL}/api/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-hub-secret": process.env.HUB_BRAIN_SECRET || "" },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`hubSend failed: ${res.status}`);
  return await res.json();
}
