import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { stripe, webhookSecret } from '@/lib/stripe';
import { createAdminClient } from '@/lib/supabase/admin';
import { findUserIdByCustomer, upsertSubscription } from '@/lib/billing-sync';

/**
 * Stripe webhook. The authoritative writer of public.subscriptions.
 *
 * Three things make this route different from every other one in the app:
 *
 *  1. The caller is Stripe, not a browser. There is no cookie and no session,
 *     so authentication is the *signature* on the request body and nothing
 *     else. That is also why it writes through the service-role client.
 *  2. The raw body is required. stripe.webhooks.constructEvent hashes the exact
 *     bytes Stripe sent, so the body is read with request.text() and never
 *     parsed first - JSON.parse then re-stringify would change the bytes and
 *     every signature would fail.
 *  3. It lives under /api/*, which the middleware matcher excludes. Correct: a
 *     302 to /login in response to a webhook would look like success to Stripe.
 *
 * As in /api/tryon, upstream detail goes to console.error only. The response
 * body is a fixed string.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function text(message: string, status: number) {
  return new NextResponse(message, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

/** Postgres unique-violation: this event id has already been claimed. */
const UNIQUE_VIOLATION = '23505';

export async function POST(request: Request) {
  const signature = request.headers.get('stripe-signature');
  if (!signature) return text('Missing signature.', 400);

  const body = await request.text();

  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(body, signature, webhookSecret());
  } catch (error) {
    // Either a forged request or a stale STRIPE_WEBHOOK_SECRET. `stripe listen`
    // prints a fresh secret every time it starts, which is the usual cause.
    console.error('[stripe-webhook] signature verification failed:', error);
    return text('Invalid signature.', 400);
  }

  // Claim the event id before doing any work. Stripe delivers at least once, so
  // a redelivery must not run the handler twice. The claim is released again if
  // the handler throws, so that Stripe's retry can pick it back up.
  const admin = createAdminClient();
  const { error: claimError } = await admin
    .from('stripe_events')
    .insert({ id: event.id, type: event.type });

  if (claimError) {
    if (claimError.code === UNIQUE_VIOLATION) {
      return text('Already handled.', 200);
    }
    console.error('[stripe-webhook] could not record event:', claimError.message);
    return text('Could not record event.', 500);
  }

  try {
    await handle(event);
  } catch (error) {
    console.error('[stripe-webhook] handler failed for %s:', event.type, error);
    await admin.from('stripe_events').delete().eq('id', event.id);
    // 500 so Stripe retries. A dropped event here means a paying customer
    // never gets access, which is the worst failure this app has.
    return text('Handler failed.', 500);
  }

  return text('OK', 200);
}

async function handle(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    /**
     * The first event that can map a Stripe customer to a Supabase user: the
     * Payment Link carries client_reference_id, and nothing else does. Every
     * later event is matched on stripe_customer_id, which this writes.
     */
    case 'checkout.session.completed': {
      const session = event.data.object;
      const userId = session.client_reference_id;

      if (!userId) {
        // A checkout started from the bare Payment Link rather than from
        // /billing. There is no account to attach it to; the return page and
        // the customer portal are the recovery path.
        console.error(
          '[stripe-webhook] checkout session %s has no client_reference_id',
          session.id,
        );
        return;
      }

      const subscriptionId =
        typeof session.subscription === 'string'
          ? session.subscription
          : session.subscription?.id;

      if (!subscriptionId) {
        console.error('[stripe-webhook] session %s has no subscription', session.id);
        return;
      }

      const subscription = await stripe().subscriptions.retrieve(subscriptionId);
      await upsertSubscription(userId, subscription);
      return;
    }

    /**
     * Renewals, cancellations, failed payments (which arrive here as a status
     * change to past_due) and plan changes all land on these. invoice.* events
     * are deliberately not handled: every one of them that matters to access
     * is followed by a subscription status change.
     */
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const subscription = event.data.object;
      const customerId =
        typeof subscription.customer === 'string'
          ? subscription.customer
          : subscription.customer.id;

      const userId = await findUserIdByCustomer(customerId);
      if (!userId) {
        // Expected on a first purchase: Stripe often sends
        // customer.subscription.created before checkout.session.completed, and
        // the customer -> user mapping only exists after the latter. Nothing to
        // do; the checkout event writes the row moments later.
        console.warn('[stripe-webhook] no user yet for customer %s', customerId);
        return;
      }

      await upsertSubscription(userId, subscription);
      return;
    }

    default:
      // Everything else is acknowledged and ignored.
      return;
  }
}

export function GET() {
  return text('Method not allowed.', 405);
}
