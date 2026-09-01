# Virtual Try-On

Single-page app: upload a photo of a person and a garment, post both to an n8n
webhook as `multipart/form-data`, and render the binary image the workflow returns.

Next.js 15 (App Router) + TypeScript + Tailwind CSS v4 + lucide-react.

## Run locally

```bash
npm install
cp .env.example .env.local   # then put your real webhook URL in it
npm run dev
```

Open **http://localhost:3001** — the dev script is pinned to `-p 3001`.

`.env.local` is gitignored, so a fresh clone will not have one. Without
`N8N_WEBHOOK_URL` set, the page loads but Generate returns a 503.

There is no test suite. Verify changes with `npm run build` (which also runs lint and
typecheck) or `npx tsc --noEmit`. Avoid `npm run lint` — it invokes the deprecated
`next lint`, which prompts interactively and will hang a non-interactive shell.

## The webhook

`N8N_WEBHOOK_URL` in `.env.local` points at the n8n webhook. The client never sees
it: the browser posts to `/api/tryon`, and that route handler forwards the multipart
body server-side. This is deliberate — n8n does not send CORS headers, so a direct
browser call would fail with an opaque CORS error.

`.env.local` points at the **production** webhook (`/webhook/...`). That path requires
the workflow to be switched **Active** in n8n. If you see "The n8n workflow is not
active", that is what happened.

To test without activating the workflow, swap the path to `/webhook-test/...` and arm
"Listen for test event" in the editor. That variant only serves requests while the
editor is open, one per arming.

The workflow must respond with the image as a **binary file**, not JSON. The route
accepts only `image/jpeg`, `image/png` and `image/webp` back; anything else, JSON
included, is refused with an explanation.

## Deploy to Vercel

```bash
npx vercel
```

Set `N8N_WEBHOOK_URL` as an environment variable in the Vercel project settings
(Production, Preview and Development).

## Security

`N8N_WEBHOOK_URL` is a server-only env var, so it never reaches the browser. Treat it
as a credential: anyone holding that URL can trigger your workflow and spend image
generations. `.env.example` contains a placeholder only.

Because `/api/tryon` costs money per call, it is rate limited to 6 requests per minute
per IP, restricted to same-origin browser requests, capped at 6 MB per request, and
validates uploads by magic bytes rather than by the client's declared type. Responses
are allowlisted to JPEG/PNG/WEBP — an `image/svg+xml` reply is refused, since SVG can
carry script. Upstream error bodies are logged server-side and never returned to the
caller. Security headers including a CSP are set in `next.config.ts`.

The rate limiter is in-process, so on Vercel it applies per instance and resets on cold
start — enough for casual abuse, not a determined one. Use a shared store (Upstash,
Redis) if this goes anywhere public with real traffic.

## Uploads

JPEG, JPG, PNG and WEBP are accepted. Vercel caps serverless request bodies at
~4.5 MB, so `lib/image.ts` gives each file a 2 MB budget: anything larger is
downscaled in the browser (1600 px long edge, stepping JPEG quality down) rather than
rejected, since phone photos are routinely 3–8 MB. That conversion flattens onto white,
because JPEG has no alpha channel and a transparent PNG would otherwise go to black.

`maxDuration = 60` is set on the route so a 10–30 second generation is not cut short.

## Files

| Path | Purpose |
| --- | --- |
| `app/page.tsx` | Page shell: utility bar, header, nav, hero, tips footer |
| `components/TryOnStudio.tsx` | All state, the fetch call, and the output panel |
| `components/UploadTile.tsx` | Drag & drop / click upload tile, preview, validation |
| `app/api/tryon/route.ts` | POST proxy to n8n, with all request guards |
| `lib/image.ts` | Client-side type validation and downscaling |
| `lib/upload-guard.ts` | Server-side magic-byte validation and size limits |
| `lib/rate-limit.ts` | In-process rate limiter for the route |
| `app/globals.css` | Tailwind import and design tokens |
| `next.config.ts` | Security headers and CSP |
| `CLAUDE.md` | Working notes for Claude Code, incl. non-obvious constraints |

## Troubleshooting

**`next dev` exits right after "Starting…"** with `readlink EINVAL` on
`.next/server/middleware-build-manifest.js`. This happens when a `next build` ran
first. Fix: `rm -rf .next`. The project sits in a OneDrive-synced folder, which is a
recurring source of this kind of file-locking error.

**Port 3001 already in use, or the server is serving stale code.** A stopped dev
server can leave an orphaned Node process holding the port. Kill it by port:

```powershell
Get-NetTCPConnection -State Listen -LocalPort 3001 | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

**Repeated `429` responses while testing.** The route allows 6 requests per minute and
counts rejected ones too. Wait out the window.

**A warning about `@next/swc-win32-x64-msvc` on every build.** The native compiler
binary is blocked by a Windows application-control policy, so Next falls back to the
slower WASM build. Harmless locally; Vercel's Linux builders are unaffected.
