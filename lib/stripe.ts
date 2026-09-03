import 'server-only';
import Stripe from 'stripe';

/**
 * The Stripe client, and the two other Stripe values the app needs.
 *
 * All of this is server-only. STRIPE_SECRET_KEY can create charges and read
 * every customer on the account, so it must never carry a NEXT_PUBLIC_ prefix
 * and must never be imported from a client component - the `server-only`
 * import above turns that mistake into a build error rather than a leak.
 *
 * Validated lazily rather than at module load, the same way lib/supabase/env.ts
 * validates eagerly: the webhook route and the billing pages want a clear
 * error, but `next build` should not fail on a machine without the keys.
 */
function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `${name} is not set. Copy .env.example to .env.local and fill it in ` +
        '(and add the same variable in the Vercel project settings).',
    );
  }
  return value;
}

let cached: Stripe | null = null;

export function stripe(): Stripe {
  if (!cached) {
    cached = new Stripe(required('STRIPE_SECRET_KEY', process.env.STRIPE_SECRET_KEY), {
      // Pinned so a Stripe-side version bump cannot change the shape of the
      // objects this app reads. Matches the version the installed SDK was
      // generated against.
      apiVersion: '2026-08-26.dahlia',
    });
  }
  return cached;
}

/** The signing secret for /api/stripe/webhook. From `stripe listen` locally. */
export function webhookSecret(): string {
  return required('STRIPE_WEBHOOK_SECRET', process.env.STRIPE_WEBHOOK_SECRET);
}

/** The hosted Payment Link the paywall sends people to. */
export function paymentLinkUrl(): string {
  return required('STRIPE_PAYMENT_LINK_URL', process.env.STRIPE_PAYMENT_LINK_URL);
}

/** Display price. Kept next to the Stripe config so the two cannot drift. */
export const PLAN_PRICE_LABEL = '$9.99';
export const PLAN_INTERVAL_LABEL = 'month';
export const PLAN_NAME = 'Virtual Try-On Pro';
