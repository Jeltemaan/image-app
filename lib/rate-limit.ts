/**
 * Minimal fixed-window rate limiter.
 *
 * The route it guards spends real money on every call (a Gemini image generation
 * per request), and the endpoint is public, so an unmetered proxy is the main
 * abuse risk in this app.
 *
 * Limitation worth knowing: this state lives in the process. On Vercel each
 * serverless instance keeps its own counter, so the effective limit is per
 * instance, not global, and it resets on cold start. It stops casual hammering,
 * not a distributed attacker. Move to a shared store (Upstash/Redis) if this is
 * ever exposed to real traffic.
 */

type Window = { count: number; resetAt: number };

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 6;
/** Bound the map so a spray of unique IPs cannot grow it without limit. */
const MAX_TRACKED_KEYS = 5_000;

const windows = new Map<string, Window>();

function sweep(now: number) {
  for (const [key, window] of windows) {
    if (window.resetAt <= now) windows.delete(key);
  }
}

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

export function rateLimit(key: string): RateLimitResult {
  const now = Date.now();
  const existing = windows.get(key);

  if (!existing || existing.resetAt <= now) {
    if (windows.size >= MAX_TRACKED_KEYS) sweep(now);
    windows.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return {
      allowed: true,
      remaining: MAX_REQUESTS - 1,
      retryAfterSeconds: 0,
    };
  }

  existing.count += 1;
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((existing.resetAt - now) / 1000),
  );

  return {
    allowed: existing.count <= MAX_REQUESTS,
    remaining: Math.max(0, MAX_REQUESTS - existing.count),
    retryAfterSeconds,
  };
}

/**
 * Best-effort client identity. On Vercel x-forwarded-for is set by the platform;
 * only the first hop is trusted, and the rest is ignored because a client can
 * append to that header itself.
 */
export function clientKey(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim();
  return first || request.headers.get('x-real-ip') || 'unknown';
}

export { MAX_REQUESTS, WINDOW_MS };
