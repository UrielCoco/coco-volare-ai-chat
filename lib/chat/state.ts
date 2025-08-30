const memMap = new Map<string, string>(); // key = `${threadId}:${clientMessageId}` -> runId

async function kvGet(key: string) {
  if (!process.env.UPSTASH_REDIS_REST_URL) return null;
  const r = await fetch(`${process.env.UPSTASH_REDIS_REST_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}` }
  });
  const j = await r.json();
  return j?.result ? JSON.parse(j.result) : null;
}
async function kvSetEx(key: string, val: any, ttlSec: number) {
  if (!process.env.UPSTASH_REDIS_REST_URL) return null;
  await fetch(`${process.env.UPSTASH_REDIS_REST_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(JSON.stringify(val))}?EX=${ttlSec}`, {
    headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}` }
  });
}

export async function rememberClientMessage(threadId: string, clientMessageId: string, runId: string) {
  const key = `${threadId}:${clientMessageId}`;
  memMap.set(key, runId);
  if (process.env.UPSTASH_REDIS_REST_URL) {
    await kvSetEx(`cv:cm:${key}`, { runId }, 3600);
  }
}

export async function getRunForClientMessage(threadId: string, clientMessageId: string): Promise<string | null> {
  const key = `${threadId}:${clientMessageId}`;
  if (memMap.has(key)) return memMap.get(key)!;
  if (process.env.UPSTASH_REDIS_REST_URL) {
    const v = await kvGet(`cv:cm:${key}`);
    return v?.runId ?? null;
  }
  return null;
}
