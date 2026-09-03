import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { stripe } from '@/lib/stripe';

/**
 * Which billing configuration this deployment is actually missing.
 *
 * Written after an outage where a payment succeeded, the entitlement never
 * appeared, and the cause could have been any of four environment variables.
 * The environment is set per Vercel environment and cannot be inspected from
 * here, so debugging it meant guessing.
 *
 * It reports **presence only** - a boolean per variable, never a value, never a
 * prefix, never a length. That is enough to find a missing or empty variable
 * and useless to anybody else. It still requires a session, so it is not
 * readable by the public.
 */
export const dynamic = 'force-dynamic';

/**
 * Where the configured Payment Link sends people after checkout.
 *
 * The redirect is stored on the link in Stripe, not in the URL the app holds,
 * so this looks the link up and reports only the host. This is the check that
 * catches "the payment worked but it returned me to localhost".
 */
async function returnHost(): Promise<string> {
  const configured = process.env.STRIPE_PAYMENT_LINK_URL;
  if (!configured) return 'STRIPE_PAYMENT_LINK_URL is not set';

  try {
    const links = await stripe().paymentLinks.list({ limit: 100 });
    const link = links.data.find((candidate) => candidate.url === configured);
    if (!link) return 'no Stripe payment link matches STRIPE_PAYMENT_LINK_URL';

    const redirect =
      link.after_completion.type === 'redirect'
        ? link.after_completion.redirect?.url
        : null;
    if (!redirect) return "Stripe's own confirmation page (no redirect set)";

    return new URL(redirect).host;
  } catch (error) {
    console.error('[billing] could not inspect the payment link:', error);
    return 'could not reach Stripe';
  }
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Please sign in.' }, { status: 401 });
  }

  const present = (name: string) => Boolean(process.env[name]);

  // Does the service-role key actually work, as opposed to merely being set?
  // A wrong key is set and still cannot write, which looks identical from the
  // outside to a missing one.
  let serviceRoleWorks: boolean | string = false;
  try {
    const { error } = await createAdminClient()
      .from('stripe_events')
      .select('id')
      .limit(1);
    serviceRoleWorks = error ? error.message : true;
  } catch (error) {
    serviceRoleWorks = error instanceof Error ? error.message : 'unavailable';
  }

  return NextResponse.json(
    {
      env: {
        STRIPE_SECRET_KEY: present('STRIPE_SECRET_KEY'),
        STRIPE_WEBHOOK_SECRET: present('STRIPE_WEBHOOK_SECRET'),
        STRIPE_PAYMENT_LINK_URL: present('STRIPE_PAYMENT_LINK_URL'),
        SUPABASE_SERVICE_ROLE_KEY: present('SUPABASE_SERVICE_ROLE_KEY'),
        N8N_WEBHOOK_URL: present('N8N_WEBHOOK_URL'),
      },
      serviceRoleWorks,
      // The host the Payment Link sends people back to. A link built for
      // another host pays fine and then strands the user there. Only the host
      // is reported - the link id is the rest of that URL.
      paymentLinkReturnsTo: await returnHost(),
    },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
}
