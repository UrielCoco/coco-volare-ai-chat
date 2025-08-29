import { NextResponse, type NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { guestRegex, isDevelopmentEnvironment } from './lib/constants';

const PUBLIC_MODE = process.env.PUBLIC_CHAT_MODE === 'true';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ✅ Salud
  if (pathname.startsWith('/ping')) return new Response('pong', { status: 200 });

  // ✅ Abrir todo en modo público (no toques nada más)
  if (PUBLIC_MODE) {
    return NextResponse.next();
  }

  // ✅ Siempre permitir embed / APIs del chat / auth / history (para analytics/SSR)
  if (
    pathname.startsWith('/embed') ||
    pathname.startsWith('/_embed') ||
    pathname.startsWith('/api/chat') ||
    pathname.startsWith('/api/history') ||
    pathname.startsWith('/api/auth')
  ) {
    return NextResponse.next();
  }

  // ⛳️ Tu lógica original (solo aplica cuando NO es modo público)
  let token = null;
  try {
    token = await getToken({
      req: request,
      secret: process.env.AUTH_SECRET,
      secureCookie: !isDevelopmentEnvironment,
    });
  } catch (error) {
    console.error('Error getting token in middleware:', error);
    return new Response('Unauthorized', { status: 401 });
  }

  if (!token) {
    const redirectUrl = encodeURIComponent(request.url);
    return NextResponse.redirect(
      new URL(`/api/auth/guest?redirectUrl=${redirectUrl}`, request.url),
    );
  }

  const isGuest = guestRegex.test(token?.email ?? '');
  if (!isGuest && (pathname === '/login' || pathname === '/register')) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  return NextResponse.next();
}

export const runtime = 'nodejs';

// ⛑️ Importante: mantenemos el matcher como lo tienes (excluye /api/:path*) y además whitelisteamos /api/history arriba.
export const config = {
  matcher: [
    '/',
    '/chat/:id',
    '/login',
    '/register',
    '/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|embed|_embed).*)',
  ],
};
