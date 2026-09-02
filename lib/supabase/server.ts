import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { SUPABASE_KEY, SUPABASE_URL } from './env';

/**
 * Supabase client for server components, server actions and route handlers.
 *
 * Always read the user with `supabase.auth.getUser()`, never `getSession()`:
 * getSession trusts the cookie as-is, getUser revalidates the JWT with the
 * auth server. Everything in this app that gates access uses getUser.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(SUPABASE_URL, SUPABASE_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server components cannot set cookies. Harmless: the middleware
          // refreshes the session on every request, so the write is not lost.
        }
      },
    },
  });
}
