import { NextResponse } from 'next/server';

/**
 * Server-side proxy to the n8n webhook.
 *
 * The browser cannot call n8n directly: n8n sends no Access-Control-Allow-Origin
 * header by default, so the request dies in CORS preflight. Forwarding it from the
 * server sidesteps that entirely and keeps the webhook URL out of the client bundle.
 */

// The generation takes 10-30 seconds, well past Vercel's default function limit.
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const UPSTREAM_TIMEOUT_MS = 55_000;

function textError(message: string, status: number) {
  return new NextResponse(message, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

export async function POST(request: Request) {
  const webhookUrl = process.env.N8N_WEBHOOK_URL;

  if (!webhookUrl) {
    return textError(
      'The server is missing N8N_WEBHOOK_URL. Add it to .env.local (or the Vercel project settings) and restart.',
      500,
    );
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

  // Rebuild the body so only the two expected fields are forwarded. No
  // Content-Type header is set: fetch derives it, including the boundary.
  const outgoing = new FormData();
  outgoing.append('image1', image1, image1.name || 'image1.jpg');
  outgoing.append('image2', image2, image2.name || 'image2.jpg');

  let upstream: Response;
  try {
    upstream = await fetch(webhookUrl, {
      method: 'POST',
      body: outgoing,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      cache: 'no-store',
    });
  } catch (caught) {
    if (caught instanceof DOMException && caught.name === 'TimeoutError') {
      return textError(
        'The workflow did not respond in time. It may still be running - try again in a moment.',
        504,
      );
    }
    return textError('Could not reach the workflow. Check your connection.', 502);
  }

  const contentType = upstream.headers.get('content-type') ?? '';

  if (!upstream.ok) {
    const detail = (await upstream.text().catch(() => '')).slice(0, 400);

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
      `The workflow returned status ${upstream.status}.${detail ? ` ${detail}` : ''}`,
      502,
    );
  }

  if (!contentType.startsWith('image/')) {
    const detail = (await upstream.text().catch(() => '')).slice(0, 400);
    return textError(
      `The workflow answered with ${contentType || 'an unknown type'} instead of an image. Make sure the final node responds with the binary file.${
        detail ? ` It said: ${detail}` : ''
      }`,
      502,
    );
  }

  // Stream the image straight through to the browser.
  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'no-store',
    },
  });
}

export function GET() {
  return textError('Use POST with image1 and image2 as multipart/form-data.', 405);
}
