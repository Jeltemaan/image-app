import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Reading the paywall entitlement.
 *
 * Deliberately free of any Stripe import: this module runs in the Edge runtime
 * from middleware.ts, where the Stripe SDK does not belong. Everything that
 * talks to Stripe lives in lib/billing-sync.ts instead.
 *
 * public.subscriptions is a local mirror of Stripe, written only by the webhook
 * and the checkout return page. Stripe remains the source of truth; this table
 * exists so the middleware can answer "may this user generate?" without a
 * round trip to Stripe on every single request.
 */

/** One row of public.subscriptions. */
export type SubscriptionRow = {
  user_id: string;
  stripe_customer_id: string;
  stripe_subscription_id: string | null;
  status: string;
  price_id: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
};

/**
 * Stripe statuses that unlock the app.
 *
 * `past_due` is deliberately excluded: Stripe has already failed to collect and
 * is retrying, and every generation costs us money upstream. A subscriber whose
 * card is declined is bounced to /billing to fix it. Note that a subscription
 * set to cancel at period end stays `active` until that date, so cancelling
 * does not cut access off early - that is intended.
 */
const ACTIVE_STATUSES = new Set(['active', 'trialing']);

/** The one definition of "this user may generate". */
export function hasActiveAccess(row: SubscriptionRow | null): boolean {
  if (!row) return false;
  if (!ACTIVE_STATUSES.has(row.status)) return false;
  if (!row.current_period_end) return true;
  return new Date(row.current_period_end).getTime() > Date.now();
}

const COLUMNS =
  'user_id, stripe_customer_id, stripe_subscription_id, status, price_id, current_period_end, cancel_at_period_end';

/**
 * Reads the signed-in user's own subscription row through their own client.
 * The select policy on public.subscriptions is scoped to auth.uid() = user_id,
 * so this cannot see anybody else's row even if the id were wrong.
 */
export async function getSubscription(
  supabase: SupabaseClient,
  userId: string,
): Promise<SubscriptionRow | null> {
  const { data, error } = await supabase
    .from('subscriptions')
    .select(COLUMNS)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    // Fail closed: an unreadable entitlement is treated as no entitlement.
    console.error('[billing] could not read subscription:', error.message);
    return null;
  }

  return (data as SubscriptionRow | null) ?? null;
}
