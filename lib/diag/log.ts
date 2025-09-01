// lib/diag/log.ts
export type LogPayload = Record<string, unknown>;

function stamp(payload: LogPayload) {
  return JSON.stringify({ tag: "[CV][server]", ...payload });
}

export function info(event: string, data: LogPayload = {}) {
  // usa console.log para Vercel logs
  console.log(stamp({ event, ...data }));
}
export function warn(event: string, data: LogPayload = {}) {
  console.warn(stamp({ event, ...data }));
}
export function error(event: string, data: LogPayload = {}) {
  console.error(stamp({ event, ...data }));
}
