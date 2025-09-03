// /lib/diag-log.ts
export const DIAG = process.env.CHAT_DIAGNOSTIC_MODE === 'true';

export function dlog(
  tag: string,
  payload: Record<string, unknown> = {},
  level: 'info' | 'warn' | 'error' = 'info'
) {
  if (!DIAG) return;
  try {
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        tag,
        level,
        ...payload,
      })
    );
  } catch (e: any) {
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        tag,
        level: 'error',
        note: 'diag-serialize-failed',
        err: String(e?.message || e),
      })
    );
  }
}

export async function timeit<T>(name: string, fn: () => Promise<T>) {
  const t0 = Date.now();
  try {
    const r = await fn();
    dlog('[CV][diag] timeit.ok', { name, ms: Date.now() - t0 });
    return r;
  } catch (e: any) {
    dlog('[CV][diag] timeit.err', { name, ms: Date.now() - t0, err: String(e?.message || e) }, 'error');
    throw e;
  }
}

export const short = (s?: string, n = 300) => (s ?? '').slice(0, n);
export const rid = (p = 'cv_') => `${p}${Math.random().toString(36).slice(2)}`;
