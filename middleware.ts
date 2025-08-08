import { NextResponse, type NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { guestRegex, isDevelopmentEnvironment } from './lib/constants';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ✅ Permitir health check sin token
  if (pathname.startsWith('/ping')) {
    return new Response('pong', { status: 200 });
  }

  // ✅ IGNORAR COMPLETAMENTE EL EMBED (clave para Shopify)
  //    Nada de auth ni redirecciones aquí para evitar loops en iframe.
  if (pathname.startsWith('/_embed')) {
    return NextResponse.next();
  }

  // ✅ Ignorar rutas de auth
  if (pathname.startsWith('/api/auth')) {
    return NextResponse.next();
  }

  let token = null;

  try {
    token = await getToken({
      req: request,
      secret: process.env.AUTH_SECRET,
      secureCookie: !isDevelopmentEnvironment,
    });
  } catch (error) {
    console.error('Error getting token in middleware:', error);
    // 🚨 Devolver respuesta en vez de dejar que falle silenciosamente
    return new Response('Unauthorized', { status: 401 });
  }

  // 🔒 Si no hay token, redirige a auth de guest
  //    (pero nunca para /_embed, ya excluido arriba)
  if (!token) {
    const redirectUrl = encodeURIComponent(request.url);
    return NextResponse.redirect(
      new URL(`/api/auth/guest?redirectUrl=${redirectUrl}`, request.url),
    );
  }

  // 👤 Si es user autenticado, evitar ir al login o registro
  const isGuest = guestRegex.test(token?.email ?? '');
  if (!isGuest && ['/login', '/register'].includes(pathname)) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  return NextResponse.next();
}

export const runtime = 'nodejs';

// 👇 Ajuste del matcher para excluir /_embed y archivos estáticos
export const config = {
  matcher: [
    '/',
    '/chat/:id',
    '/api/:path*',
    '/login',
    '/register',
    // Excluimos _next, estáticos y _embed (importantísimo)
    '/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|_embed).*)',
  ],
};
