import { NextResponse } from 'next/server';
import { recoverAccess } from '@/lib/billing-sync';
import { createClient } from '@/lib/supabase/server';

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
    return NextResponse.redirect(new URL('/billing?recover=error', request.url), 303);
  }

  return NextResponse.redirect(
    new URL(recovered ? '/' : '/billing?recover=none', request.url),
    303,
  );
}
