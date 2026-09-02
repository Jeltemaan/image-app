import { createBrowserClient } from '@supabase/ssr';
import { SUPABASE_KEY, SUPABASE_URL } from './env';

/**
 * Supabase client for client components.
 *
 * Sessions are kept in cookies, not localStorage, so the middleware, server
 * components and the route handler all see the same session.
 */
export function createClient() {
  return createBrowserClient(SUPABASE_URL, SUPABASE_KEY);
}
