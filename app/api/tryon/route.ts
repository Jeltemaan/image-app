import { NextResponse } from 'next/server';
import { MAX_REQUESTS, clientKey, rateLimit } from '@/lib/rate-limit';
import { createClient } from '@/lib/supabase/server';
import { getSubscription, hasActiveAccess } from '@/lib/billing';
import {
  ALLOWED_RESPONSE_TYPES,
  MAX_TOTAL_BYTES,
  checkImage,
} from '@/lib/upload-guard';

/**
 * Server-side proxy to the n8n webhook.
 *
 * The browser cannot call n8n directly: n8n sends no Access-Control-Allow-Origin
 * header by default, so the request dies in CORS preflight. Forwarding it from the
 * server sidesteps that and keeps the webhook URL out of the client bundle.
 *
 * Every call costs an image generation upstream, so this route is treated as a paid
 * endpoint: authenticated, subscribed, rate limited, same-origin only, and strict
 * about what it accepts and what it passes back.
 */

// The generation takes 10-30 seconds, well past Vercel's default function limit.
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const UPSTREAM_TIMEOUT_MS = 55_000;

function textError(
  message: string,
  status: number,
  headers: Record<string, string> = {},
) {
  return new NextResponse(message, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers,
    },
  });
}

/**
 * Rejects cross-site browser calls. Requests without an Origin (curl, server to
 * server) are allowed through to the rate limiter: this stops a page on another
 * domain from spending the quota, it is not authentication.
 */
function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try {
    return new URL(origin).host === request.headers.get('host');
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  const webhookUrl = process.env.N8N_WEBHOOK_URL;

  if (!webhookUrl) {
    // Deliberately vague to the caller; the detail goes to the server log.
    console.error('[tryon] N8N_WEBHOOK_URL is not set');
    return textError('The service is not configured. Please try again later.', 503);
  }

  if (!isSameOrigin(request)) {
    return textError('Cross-origin requests are not allowed.', 403);
  }

  // Signed-in callers only. This is the primary cost control - the rate limiter
  // below is the second layer. It runs before formData() so an anonymous caller is
  // refused without the body ever being buffered, and after the same-origin check
  // so the CSRF ordering is unchanged.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return textError('Please sign in to generate an image.', 401);
  }

  // Paying callers only. This is the real cost control - every call below spends
  // an image generation upstream. It sits here, immediately after the identity
  // check and still before formData(), so an unpaid caller is refused without
  // the body ever being buffered. The message is shown to the user verbatim.
  const subscription = await getSubscription(supabase, user.id);
  if (!hasActiveAccess(subscription)) {
    return textError(
      'Your subscription is not active. Open your account page to subscribe.',
      402,
    );
  }

  const limit = rateLimit(clientKey(request));
  if (!limit.allowed) {
    return textError(
      'Too many requests. Please wait a moment and try again.',
      429,
      {
        'Retry-After': String(limit.retryAfterSeconds),
        'X-RateLimit-Limit': String(MAX_REQUESTS),
        'X-RateLimit-Remaining': '0',
      },
    );
  }

  // Reject an oversized body before buffering it into memory.
  const declaredLength = Number(request.headers.get('content-length') ?? 0);
  if (declaredLength > MAX_TOTAL_BYTES) {
    return textError('Those images are too large.', 413);
  }

  let incoming: FormData;
  try {
    incoming = await request.formData();
  } catch {
    return textError('Could not read the uploaded files.', 400);
  }

  const image1 = incoming.get('image1');
  const image2 = incoming.get('image2');

  if (!(image1 instanceof File) || !(image2 instanceof File)) {
    return textError('Both image1 and image2 are required.', 400);
  }

  if (image1.size + image2.size > MAX_TOTAL_BYTES) {
    return textError('Those images are too large.', 413);
  }

  // Verify the actual bytes, not the client's claimed content type.
  const checked = await Promise.all([
    checkImage(image1, 'image1'),
    checkImage(image2, 'image2'),
  ]);
  const failure = checked.find((result) => !result.ok);
  if (failure && !failure.ok) {
    return textError(failure.error, 400);
  }
  const [first, second] = checked.flatMap((result) =>
    result.ok ? [result.value] : [],
  );

  // Only the two expected fields are forwarded, with server-chosen filenames.
  // No Content-Type header is set: fetch derives it, including the boundary.
  const outgoing = new FormData();
  outgoing.append('image1', first.blob, first.filename);
  outgoing.append('image2', second.blob, second.filename);

  let upstream: Response;
  try {
    upstream = await fetch(webhookUrl, {
      method: 'POST',
      body: outgoing,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      cache: 'no-store',
      redirect: 'error',
    });
  } catch (caught) {
    if (caught instanceof DOMException && caught.name === 'TimeoutError') {
      return textError(
        'The workflow did not respond in time. It may still be running - try again in a moment.',
        504,
      );
    }
    console.error('[tryon] upstream fetch failed:', caught);
    return textError('Could not reach the workflow. Please try again.', 502);
  }

  const contentType = (upstream.headers.get('content-type') ?? '')
    .split(';')[0]
    .trim()
    .toLowerCase();

  if (!upstream.ok) {
    // Upstream bodies can carry workflow internals, so they are logged, never returned.
    const detail = (await upstream.text().catch(() => '')).slice(0, 1000);
    console.error(`[tryon] upstream ${upstream.status}: ${detail}`);

    // A 404 means the webhook path is not registered, for one of two reasons.
    if (upstream.status === 404) {
      return textError(
        webhookUrl.includes('/webhook-test/')
          ? 'The n8n test webhook is not registered. Open the workflow and click "Listen for test event", then try again. Once the workflow is active, change the URL from /webhook-test/ to /webhook/.'
          : 'The n8n workflow is not active. Open it and switch on Active, then try again. (While testing without activating, use the /webhook-test/ URL with "Listen for test event".)',
        502,
      );
    }

    return textError(
      'The workflow could not produce an image. Please try again.',
      502,
    );
  }

  // Allowlist, not a prefix test: "image/svg+xml" is scriptable XML and must never
  // reach the browser from this route.
  if (!ALLOWED_RESPONSE_TYPES.includes(contentType)) {
    const detail = (await upstream.text().catch(() => '')).slice(0, 1000);
    console.error(
      `[tryon] unexpected upstream content-type "${contentType}": ${detail}`,
    );
    return textError(
      'The workflow did not return a JPEG, PNG or WEBP image. Make sure its final node responds with the binary file.',
      502,
    );
  }

  // Stream the image through, pinned to the verified type so nothing sniffs it
  // into something executable.
  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': 'inline; filename="tryon-result"',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    },
  });
}

export function GET() {
  return textError('Use POST with image1 and image2 as multipart/form-data.', 405);
}
