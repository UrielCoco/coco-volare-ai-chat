import { NextResponse, type NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { guestRegex, isDevelopmentEnvironment } from './lib/constants';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith('/ping')) return new Response('pong', { status: 200 });

  // 🚫 NO tocar /embed ni /_embed (clave para evitar loops en iframe)
  if (pathname.startsWith('/embed') || pathname.startsWith('/_embed')) {
    return NextResponse.next();
  }

  if (pathname.startsWith('/api/auth')) return NextResponse.next();

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
    return NextResponse.redirect(new URL(`/api/auth/guest?redirectUrl=${redirectUrl}`, request.url));
  }

  
  const isGuest = guestRegex.test(token?.email ?? '');
  if (!isGuest && ['/login', '/register'].includes(pathname)) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  return NextResponse.next();
}

export const runtime = 'nodejs';
export const config = {
  matcher: [
    '/',
    '/chat/:id',
    '/api/:path*',
    '/login',
    '/register',
    // Excluir estáticos y también /embed y /_embed
    '/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|embed|_embed).*)',
  ],
};
