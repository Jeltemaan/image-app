import 'server-only';
import type Stripe from 'stripe';
import { createAdminClient } from '@/lib/supabase/admin';
import { paymentLinkUrl, stripe } from '@/lib/stripe';
import { ACTIVE_STATUSES } from '@/lib/billing';

/**
 * Writing the paywall entitlement, i.e. everything that touches Stripe.
 *
 * Kept apart from lib/billing.ts because that module is imported by
 * middleware.ts and therefore has to stay Edge-safe and Stripe-free.
 *
 * The user <-> Stripe mapping is `client_reference_id`, which the paywall link
 * carries. It is set once, at checkout, and stored as stripe_customer_id; every
 * later customer.subscription.* event carries only the Stripe customer, so that
 * column is the lookup key from then on.
 */

/** Reads an id off a field Stripe may return expanded or as a bare string. */
function idOf(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === 'string' ? value : value.id;
}

/**
 * The paywall link for one user.
 *
 * client_reference_id is what ties the payment back to a Supabase account, and
 * it is verified on the way back in - see reconcileCheckoutSession. The email is
 * prefilled only for convenience; nothing trusts it.
 */
export function paymentLinkFor(user: { id: string; email?: string | null }): string {
  const url = new URL(paymentLinkUrl());
  url.searchParams.set('client_reference_id', user.id);
  if (user.email) url.searchParams.set('prefilled_email', user.email);
  return url.toString();
}

/**
 * The single place public.subscriptions is written, used by both the webhook
 * and the checkout return page so the field mapping exists exactly once.
 *
 * Note current_period_end: as of API version 2026-08-26 it lives on the
 * subscription *item*, not on the subscription. This app sells one line item,
 * so the first item's period is the subscription's period.
 */
export async function upsertSubscription(
  userId: string,
  subscription: Stripe.Subscription,
): Promise<void> {
  const customerId = idOf(subscription.customer);
  if (!customerId) {
    console.error('[billing] subscription has no customer:', subscription.id);
    return;
  }

  const item = subscription.items.data[0];
  const periodEnd = item?.current_period_end;

  const admin = createAdminClient();
  const { error } = await admin.from('subscriptions').upsert(
    {
      user_id: userId,
      stripe_customer_id: customerId,
      stripe_subscription_id: subscription.id,
      status: subscription.status,
      price_id: item?.price?.id ?? null,
      current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
      cancel_at_period_end: subscription.cancel_at_period_end,
    },
    { onConflict: 'user_id' },
  );

  if (error) {
    // Thrown, not swallowed: the webhook must return a non-2xx so Stripe
    // retries, otherwise a paying customer silently never gets access.
    throw new Error(`could not upsert subscription: ${error.message}`);
  }
}

/** Which user a Stripe customer belongs to, for events that carry no user id. */
export async function findUserIdByCustomer(
  customerId: string,
): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('subscriptions')
    .select('user_id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle();

  if (error) {
    throw new Error(`could not look up customer ${customerId}: ${error.message}`);
  }
  return data?.user_id ?? null;
}

/**
 * Grants access straight from a completed Checkout Session.
 *
 * This is what makes /billing/return work the instant Stripe redirects back,
 * without waiting on webhook delivery. It is also the reason the flow is
 * testable without a publicly reachable webhook endpoint.
 *
 * The security check is `client_reference_id === userId`. Without it the
 * session id in the return URL would be a bearer token for somebody else's
 * payment: anyone could paste a session id they had seen and be granted access.
 */
export async function reconcileCheckoutSession(
  sessionId: string,
  userId: string,
): Promise<boolean> {
  let session: Stripe.Checkout.Session;
  try {
    session = await stripe().checkout.sessions.retrieve(sessionId, {
      expand: ['subscription', 'subscription.items'],
    });
  } catch (error) {
    console.error('[billing] could not retrieve checkout session:', error);
    return false;
  }

  if (session.client_reference_id !== userId) {
    console.error(
      '[billing] checkout session %s does not belong to user %s',
      sessionId,
      userId,
    );
    return false;
  }

  if (session.status !== 'complete') return false;

  const subscription = session.subscription;
  if (!subscription || typeof subscription === 'string') {
    console.error('[billing] completed session has no expanded subscription');
    return false;
  }

  await upsertSubscription(userId, subscription);
  return true;
}

/**
 * Last-resort recovery: find a completed checkout for this user and grant it.
 *
 * This exists because of a real incident. A payment can be made and still leave
 * the user on the paywall: the Payment Link's redirect can point at the wrong
 * host (it is baked into the link, not the app), and the webhook can be failing
 * for a reason nobody has noticed yet. When both grant paths miss, the only
 * thing the paywall used to offer was the pay button - so the user pays a
 * second time, and it still does not work.
 *
 * Scanning sessions is not elegant. Stripe cannot filter checkout sessions by
 * client_reference_id, so this walks recent sessions newest-first looking for
 * one that still grants something. It is bounded, it only runs when a user asks
 * for it, and it verifies exactly what reconcileCheckoutSession verifies: the
 * session must be complete and its client_reference_id must be this user.
 */
const RECOVERY_PAGES = 3;
const RECOVERY_PAGE_SIZE = 100;

export async function recoverAccess(userId: string): Promise<boolean> {
  let startingAfter: string | undefined;
  // The newest matching subscription, whatever its state. Used only as a
  // fallback, so that a user who really has nothing active still ends up with
  // an accurate row rather than none at all.
  let newestMatch: Stripe.Subscription | null = null;

  for (let page = 0; page < RECOVERY_PAGES; page += 1) {
    const sessions = await stripe().checkout.sessions.list({
      limit: RECOVERY_PAGE_SIZE,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });

    for (const session of sessions.data) {
      if (session.client_reference_id !== userId) continue;
      if (session.status !== 'complete') continue;

      const subscriptionId =
        typeof session.subscription === 'string'
          ? session.subscription
          : session.subscription?.id;
      if (!subscriptionId) continue;

      const subscription = await stripe().subscriptions.retrieve(subscriptionId);
      newestMatch ??= subscription;

      // Keep looking past a completed checkout whose subscription has since
      // been cancelled. Somebody who paid twice, or resubscribed after
      // cancelling, has more than one completed session, and only one of them
      // still grants anything - stopping at the newest would restore a dead
      // subscription and report success while the paywall stayed up.
      if (!ACTIVE_STATUSES.has(subscription.status)) continue;

      await upsertSubscription(userId, subscription);
      return true;
    }

    if (!sessions.has_more) break;
    startingAfter = sessions.data.at(-1)?.id;
    if (!startingAfter) break;
  }

  if (newestMatch) {
    await upsertSubscription(userId, newestMatch);
  }
  return false;
}
