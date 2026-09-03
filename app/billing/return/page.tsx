import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AlertCircle } from 'lucide-react';
import AuthShell from '@/components/AuthShell';
import { createClient } from '@/lib/supabase/server';
import { reconcileCheckoutSession } from '@/lib/billing-sync';

export const metadata: Metadata = { title: 'Confirming your payment' };
export const dynamic = 'force-dynamic';

/**
 * Where the Stripe Payment Link redirects after checkout.
 *
 * This exists so access is granted the moment checkout finishes rather than
 * whenever the webhook happens to arrive. It reads the session straight from
 * Stripe and verifies that its client_reference_id is this signed-in user - the
 * session id in the URL is not treated as proof of anything on its own.
 *
 * The webhook is still the authority for everything afterwards (renewals,
 * cancellations, failed payments). This page only covers the first moment.
 */
export default async function BillingReturnPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>;
}) {
  const { session_id: sessionId } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  if (sessionId && (await reconcileCheckoutSession(sessionId, user.id))) {
    redirect('/');
  }

  // Either no session id, or Stripe has not marked the session complete yet
  // (some payment methods settle asynchronously). The webhook will finish the
  // job; the user just has to look again.
  return (
    <AuthShell>
      <div className="w-full max-w-md">
        <h1 className="text-[30px] font-bold leading-tight tracking-tight sm:text-[34px]">
          Confirming your payment
        </h1>
        <p className="mt-2 text-sm text-muted">
          Stripe has not confirmed this payment yet. It usually takes a few
          seconds.
        </p>

        <div className="mt-8 flex items-start gap-2 rounded-md bg-bar px-4 py-3 text-sm">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
          If it does not unlock within a minute, your card may not have been
          charged. Check your email for a Stripe receipt.
        </div>

        <Link
          href="/billing"
          className="mt-6 inline-flex w-full items-center justify-center rounded-full bg-ink px-9 py-4 text-sm font-bold text-white transition hover:opacity-85"
        >
          Check again
        </Link>
      </div>
    </AuthShell>
  );
}
