import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { SUPABASE_KEY, SUPABASE_URL } from '@/lib/supabase/env';

/** Paths a signed-out visitor is allowed to reach. */
const PUBLIC_PATHS = ['/login', '/signup'];

/**
 * Refreshes the Supabase session on every request and gates the app.
 *
 * The whole app is behind the login: /api/tryon spends a real image generation
 * per call, so an account is the primary cost control and the in-process rate
 * limiter is the second layer.
 *
 * /api/* is excluded from the matcher on purpose. An API caller should get a
 * 401 with a readable message, not a 302 to an HTML page, so the route guards
 * itself in app/api/tryon/route.ts.
 */
export async function middleware(request: NextRequest) {
  // This response carries any refreshed auth cookies, so it must be the one
  // returned (or copied onto a redirect) — never a fresh NextResponse.next().
  let response = NextResponse.next({ request });

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // getUser, not getSession: getSession trusts the cookie without verifying it.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    return NextResponse.redirect(url);
  }

  if (user && isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except Next's own assets, the favicon, image files, and
     * /api/* (which returns its own 401 rather than redirecting).
     */
    '/((?!api|_next/static|_next/image|favicon.ico|.*\.(?:png|jpg|jpeg|gif|webp|svg|ico)$).*)',
  ],
};
