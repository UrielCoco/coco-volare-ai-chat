type QueueItem = { threadId: string; userText: string; clientMessageId: string; metadata?: any };

const memLocks = new Map<string, number>(); // threadId -> expiresAt
const memQueues = new Map<string, QueueItem[]>();

const TTL_MS = 60_000;

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
async function kvDel(key: string) {
  if (!process.env.UPSTASH_REDIS_REST_URL) return null;
  await fetch(`${process.env.UPSTASH_REDIS_REST_URL}/del/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}` }
  });
}

export async function acquireThreadLock(threadId: string): Promise<boolean> {
  const now = Date.now();

  if (!process.env.UPSTASH_REDIS_REST_URL) {
    const exp = memLocks.get(threadId);
    if (exp && exp > now) return false;
    memLocks.set(threadId, now + TTL_MS);
    return true;
  }

  const key = `cv:lock:${threadId}`;
  const existing = await kvGet(key);
  if (existing && existing.expiresAt > now) return false;
  await kvSetEx(key, { expiresAt: now + TTL_MS }, Math.ceil(TTL_MS / 1000));
  return true;
}

export async function finishThreadLock(threadId: string) {
  memLocks.delete(threadId);
  if (process.env.UPSTASH_REDIS_REST_URL) {
    await kvDel(`cv:lock:${threadId}`);
  }
  // Aquí podrías disparar procesamiento de cola si la manejas server-side.
}

export async function enqueueIfLocked(threadId: string, item: QueueItem) {
  // En memoria (sencillo). Si usas KV, guárdala ahí.
  const q = memQueues.get(threadId) ?? [];
  q.push(item);
  memQueues.set(threadId, q);
}

export function shiftQueue(threadId: string): QueueItem | undefined {
  const q = memQueues.get(threadId) ?? [];
  const item = q.shift();
  memQueues.set(threadId, q);
  return item;
}
