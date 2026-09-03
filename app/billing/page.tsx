import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AlertCircle, Check, CreditCard } from 'lucide-react';
import AuthShell from '@/components/AuthShell';
import { signOut } from '@/app/auth/actions';
import { createClient } from '@/lib/supabase/server';
import { getSubscription, hasActiveAccess } from '@/lib/billing';
import { paymentLinkFor } from '@/lib/billing-sync';
import { PLAN_INTERVAL_LABEL, PLAN_NAME, PLAN_PRICE_LABEL } from '@/lib/stripe';

export const metadata: Metadata = { title: 'Subscribe' };

// The subscription state changes underneath this page (webhook, portal), so it
// must never be served from the full route cache.
export const dynamic = 'force-dynamic';

const included = [
  'Unlimited try-on generations',
  'Full-resolution results',
  'Cancel any time, from your account',
];

function formatDate(value: string | null): string {
  if (!value) return 'the end of the period';
  return new Date(value).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

const RECOVERY_MESSAGES: Record<string, string> = {
  none: 'We could not find a completed payment for this account. If you have just paid, give it a few seconds and try again.',
  stripe: 'Stripe did not answer when we checked for your payment. Please try again in a moment.',
  database: 'We reached Stripe, but this deployment cannot write to its database. Its Supabase service-role key is set but not working.',
  config: 'This deployment is missing part of its billing configuration, so we cannot confirm your payment. Nothing has been charged again.',
};

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ recover?: string }>;
}) {
  const { recover } = await searchParams;
  const recoveryMessage = recover ? RECOVERY_MESSAGES[recover] : undefined;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // The middleware already guarantees a session here; this is the belt to its
  // braces and keeps the page honest if the matcher ever changes.
  if (!user) redirect('/login');

  const subscription = await getSubscription(supabase, user.id);
  const active = hasActiveAccess(subscription);

  return (
    <AuthShell>
      <div className="w-full max-w-md">
        <h1 className="text-[30px] font-bold leading-tight tracking-tight sm:text-[34px]">
          {active ? 'Your plan' : 'Subscribe to start generating'}
        </h1>
        <p className="mt-2 text-sm text-muted">
          {active
            ? 'Your subscription is active. Everything is unlocked.'
            : 'Every try-on runs a real image generation, so the app is a paid subscription.'}
        </p>

        {recoveryMessage && (
          <div
            role="alert"
            className="mt-6 flex items-start gap-2 rounded-md bg-bar px-4 py-3 text-sm"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
            {recoveryMessage}
          </div>
        )}

        <div className="mt-8 rounded-2xl border border-hairline p-6">
          <div className="flex items-baseline justify-between">
            <span className="text-sm font-bold tracking-tight">{PLAN_NAME}</span>
            <span className="text-sm text-muted">
              <span className="text-[26px] font-bold tracking-tight text-ink">
                {PLAN_PRICE_LABEL}
              </span>
              {' / '}
              {PLAN_INTERVAL_LABEL}
            </span>
          </div>

          <ul className="mt-5 space-y-2">
            {included.map((item) => (
              <li key={item} className="flex items-start gap-2 text-sm">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                {item}
              </li>
            ))}
          </ul>

          {active ? (
            <>
              <p className="mt-5 rounded-md bg-bar px-4 py-3 text-sm">
                {subscription?.cancel_at_period_end
                  ? `Cancelled. Access continues until ${formatDate(
                      subscription.current_period_end ?? null,
                    )}.`
                  : `Renews on ${formatDate(subscription?.current_period_end ?? null)}.`}
              </p>
              <Link
                href="/"
                className="mt-5 inline-flex w-full items-center justify-center rounded-full bg-ink px-9 py-4 text-sm font-bold text-white transition hover:opacity-85"
              >
                Start generating
              </Link>
              <a
                href="/api/billing/portal"
                className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-full border border-hairline px-9 py-4 text-sm font-bold transition hover:border-ink"
              >
                <CreditCard className="h-4 w-4" />
                Manage subscription
              </a>
            </>
          ) : (
            <>
              {/*
                A plain link, not a form: the CSP sets form-action 'self', which
                Chrome also applies to the redirect that follows a submission,
                so a POST that ends up on stripe.com would be blocked.
              */}
              <a
                href={paymentLinkFor(user)}
                className="mt-6 inline-flex w-full items-center justify-center rounded-full bg-ink px-9 py-4 text-sm font-bold text-white transition hover:opacity-85"
              >
                Subscribe — {PLAN_PRICE_LABEL}/{PLAN_INTERVAL_LABEL}
              </a>
              <p className="mt-3 text-center text-xs text-muted">
                Secure checkout by Stripe. Cancel any time.
              </p>

              {/*
                The escape hatch. A payment can complete and still leave someone
                here - a Payment Link redirecting at the wrong host, a webhook
                that is misconfigured - and without this the only thing the page
                offers is to pay a second time. It grants nothing that Stripe
                does not already show as a completed checkout for this account.
              */}
              <a
                href="/api/billing/recover"
                className="mt-4 block text-center text-xs font-bold text-accent underline"
              >
                Already paid? Restore my access
              </a>
            </>
          )}
        </div>

        {/* A div, not a p: a <form> inside a <p> is invalid HTML, and React
            recovers from it with a hydration mismatch. */}
        <div className="mt-6 text-sm text-muted">
          Signed in as {user.email}.{' '}
          <form action={signOut} className="inline">
            <button type="submit" className="font-bold text-accent underline">
              Sign out
            </button>
          </form>
        </div>
      </div>
    </AuthShell>
  );
}
