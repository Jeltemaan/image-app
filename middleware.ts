import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { SUPABASE_KEY, SUPABASE_URL } from '@/lib/supabase/env';
import { getSubscription, hasActiveAccess } from '@/lib/billing';

/** Paths a signed-out visitor is allowed to reach. */
const PUBLIC_PATHS = ['/login', '/signup'];

/**
 * Paths a signed-in visitor may reach without an active subscription. Anything
 * else redirects to /billing. /billing/return is included because that is where
 * Stripe drops the user back, before the entitlement row exists.
 */
const UNPAID_PATHS = ['/billing'];

/**
 * Refreshes the Supabase session on every request and gates the app.
 *
 * The whole app is behind the login and then behind the paywall: /api/tryon
 * spends a real image generation per call, so a paid account is the primary
 * cost control and the in-process rate limiter is the second layer.
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
  const matches = (paths: string[]) =>
    paths.some((path) => pathname === path || pathname.startsWith(`${path}/`));

  /**
   * A redirect is a brand new response, so it does not carry the refreshed auth
   * cookies that `setAll` wrote onto `response`. Copying them across is what
   * stops a redirect from silently rolling the session back to the stale
   * cookie the request arrived with.
   */
  const redirectTo = (pathname: string) => {
    const url = request.nextUrl.clone();
    url.pathname = pathname;
    url.search = '';
    const redirect = NextResponse.redirect(url);
    for (const cookie of response.cookies.getAll()) {
      redirect.cookies.set(cookie);
    }
    return redirect;
  };

  const isPublic = matches(PUBLIC_PATHS);

  if (!user) {
    return isPublic ? response : redirectTo('/login');
  }

  if (isPublic) {
    return redirectTo('/');
  }

  // Signed in, so the paywall applies. Read through the user's own client:
  // the select policy on public.subscriptions is scoped to auth.uid(), so this
  // can only ever see their own row.
  if (!matches(UNPAID_PATHS)) {
    const subscription = await getSubscription(supabase, user.id);
    if (!hasActiveAccess(subscription)) {
      return redirectTo('/billing');
    }
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
