/**
 * The two Supabase values the app needs, read once and validated.
 *
 * Both are public by design: the publishable key carries no privileges of its
 * own, row level security on the database is the actual boundary. The
 * service-role key must never appear in this project.
 *
 * These must be written as literal `process.env.NEXT_PUBLIC_...` member reads.
 * Next inlines that exact expression into the client bundle at build time; a
 * dynamic lookup like `process.env[name]` is not substituted and comes back
 * undefined in the browser.
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

export const SUPABASE_URL = required(
  'NEXT_PUBLIC_SUPABASE_URL',
  process.env.NEXT_PUBLIC_SUPABASE_URL,
);

export const SUPABASE_KEY = required(
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
);
