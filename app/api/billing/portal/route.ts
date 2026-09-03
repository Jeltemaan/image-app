import { NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import { createClient } from '@/lib/supabase/server';
import { getSubscription } from '@/lib/billing';

/**
 * Sends a subscriber to the Stripe customer portal to cancel or update a card.
 *
 * A GET handler behind a plain link rather than a form POST on purpose: the CSP
 * in next.config.ts sets form-action 'self', and Chrome applies that to the
 * redirect chain a form submission follows, so a POST landing on stripe.com
 * would be blocked with no visible error.
 *
 * The portal session is created for the customer id stored against *this*
 * user's row, so there is no id in the request to tamper with.
 */
export const dynamic = 'force-dynamic';

function text(message: string, status: number) {
  return new NextResponse(message, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return text('Please sign in.', 401);

  const subscription = await getSubscription(supabase, user.id);
  if (!subscription) {
    return NextResponse.redirect(new URL('/billing', request.url), 303);
  }

  try {
    const session = await stripe().billingPortal.sessions.create({
      customer: subscription.stripe_customer_id,
      return_url: new URL('/billing', request.url).toString(),
    });
    return NextResponse.redirect(session.url, 303);
  } catch (error) {
    // The usual cause is that the portal has never been configured for the
    // Stripe account (Dashboard > Settings > Billing > Customer portal).
    console.error('[billing] could not create a portal session:', error);
    return text(
      'The billing portal is unavailable right now. Please try again later.',
      502,
    );
  }
}
