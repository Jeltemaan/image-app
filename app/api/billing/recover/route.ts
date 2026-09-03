import { NextResponse } from 'next/server';
import { recoverAccess } from '@/lib/billing-sync';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * "I already paid" - re-grants access from a completed Stripe checkout.
 *
 * The escape hatch for a payment that went through while neither grant path
 * ran: a Payment Link redirecting at the wrong host, or a webhook that is
 * misconfigured. Without this the paywall's only offer is to pay again.
 *
 * Safe to expose: recoverAccess grants nothing that Stripe does not already
 * show as a completed checkout carrying this user's id, so pressing it without
 * having paid does nothing at all.
 */
export const dynamic = 'force-dynamic';

/**
 * Works out which service actually failed, so the paywall can say something
 * true rather than blaming whichever one is mentioned first.
 *
 * This is deliberately more than string matching on the thrown error. A
 * service-role key that is *present but wrong* - the publishable key pasted by
 * mistake, or a truncated one - throws from deep inside the Supabase client
 * with a message that names no environment variable at all, and is otherwise
 * indistinguishable from a Stripe outage. So the database is probed directly.
 */
async function classify(error: unknown): Promise<'config' | 'database' | 'stripe'> {
  const detail = error instanceof Error ? error.message : '';
  if (/SUPABASE_SERVICE_ROLE_KEY|STRIPE_SECRET_KEY|STRIPE_PAYMENT_LINK_URL/.test(detail)) {
    return 'config';
  }

  try {
    const { error: dbError } = await createAdminClient()
      .from('subscriptions')
      .select('user_id')
      .limit(1);
    if (dbError) {
      console.error('[billing] service-role client cannot read:', dbError.message);
      return 'database';
    }
  } catch (probeError) {
    console.error('[billing] service-role client unusable:', probeError);
    return 'config';
  }

  return 'stripe';
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL('/login', request.url), 303);
  }

  let recovered = false;
  try {
    recovered = await recoverAccess(user.id);
  } catch (error) {
    console.error('[billing] recovery failed:', error);
    const reason = await classify(error);
    return NextResponse.redirect(
      new URL(`/billing?recover=${reason}`, request.url),
      303,
    );
  }

  return NextResponse.redirect(
    new URL(recovered ? '/' : '/billing?recover=none', request.url),
    303,
  );
}
