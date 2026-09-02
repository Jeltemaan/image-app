import type { NextConfig } from 'next';

const isDev = process.env.NODE_ENV === 'development';

/**
 * Origin of the Supabase project, taken from the same env var the app reads so the
 * two can never drift. Empty when unset, which only happens in a misconfigured
 * build that would fail on its first Supabase call anyway.
 */
const SUPABASE_ORIGIN = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';

/**
 * Content Security Policy.
 *
 * - img-src needs blob: because previews and the result are Object URLs.
 * - connect-src is 'self' plus the Supabase project: the browser never talks to n8n
 *   directly, but the Supabase auth client does call the project from the page.
 *   Leaving that origin out fails silently - login just never completes.
 * - script-src carries 'unsafe-inline' because Next's hydration bootstrap is an
 *   inline script; removing it needs per-request nonces via middleware. This app
 *   renders no user-supplied HTML and has no dangerouslySetInnerHTML, so the
 *   residual XSS surface is small, but tighten this first if that ever changes.
 * - Dev additionally needs 'unsafe-eval' and ws: for hot reload.
 */
const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "img-src 'self' blob: data:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  isDev
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
    : "script-src 'self' 'unsafe-inline'",
  isDev
    ? `connect-src 'self' ws: ${SUPABASE_ORIGIN}`
    : `connect-src 'self' ${SUPABASE_ORIGIN}`,
  'upgrade-insecure-requests',
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=()',
  },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains',
  },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Do not advertise the framework version to scanners.
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
