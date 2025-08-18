import { cookies } from 'next/headers';
import { randomUUID } from 'crypto';

const COOKIE_NAME = 'cv_sid';

export function getOrSetSessionId(): { sessionId: string; newCookie: boolean } {
  const store = cookies();
  const existing = store.get(COOKIE_NAME)?.value;
  if (existing) return { sessionId: existing, newCookie: false };

  const sid = randomUUID();
  const isProd = process.env.NODE_ENV === 'production';

  store.set({
    name: COOKIE_NAME,
    value: sid,
    httpOnly: true,
    // Para iframes en dominio distinto (Shopify): None+Secure en prod
    sameSite: isProd ? 'none' : 'lax',
    secure: isProd ? true : false,
    path: '/',
    maxAge: 60 * 60 * 24 * 30, // 30 días
  });

  return { sessionId: sid, newCookie: true };
}
