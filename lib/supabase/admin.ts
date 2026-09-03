import 'server-only';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_URL } from './env';

/**
 * Service-role Supabase client. Bypasses row level security entirely.
 *
 * This exists for exactly one reason: the Stripe webhook arrives from Stripe's
 * servers with no user cookie, so there is no session to write the entitlement
 * under. Every other part of the app must keep using lib/supabase/server.ts,
 * where RLS is the boundary.
 *
 * Rules for this file:
 *   - `server-only` above makes a client-side import a build error.
 *   - SUPABASE_SERVICE_ROLE_KEY has no NEXT_PUBLIC_ prefix, so Next never
 *     inlines it into the browser bundle.
 *   - Nothing outside lib/billing.ts and the webhook route should import this.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is not set. Copy .env.example to .env.local ' +
        'and fill it in (and add the same variable in the Vercel project settings).',
    );
  }

  return createSupabaseClient(SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
