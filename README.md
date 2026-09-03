# Virtual Try-On

Single-page app behind a login: sign up with a name, an email address and a password,
then upload a photo of a person and a garment, post both to an n8n webhook as
`multipart/form-data`, and render the binary image the workflow returns.

Next.js 15 (App Router) + TypeScript + Tailwind CSS v4 + lucide-react, with Supabase
for authentication.

## Run locally

```bash
npm install
cp .env.example .env.local   # then fill in the webhook URL and Supabase keys
npm run dev
```

Open **http://localhost:3001** — the dev script is pinned to `-p 3001`. You land on
`/login`; there is a link to `/signup` if you do not have an account yet.

`.env.local` is gitignored, so a fresh clone will not have one. All three variables
are needed: without the two `NEXT_PUBLIC_SUPABASE_*` values the app throws on its
first Supabase call, and without `N8N_WEBHOOK_URL` you can sign in but Generate
returns a 503.

There is no test suite. Verify changes with `npm run build` (which also runs lint and
typecheck) or `npx tsc --noEmit`. Avoid `npm run lint` — it invokes the deprecated
`next lint`, which prompts interactively and will hang a non-interactive shell.

## Auth

Email and password accounts, via Supabase. Sign up takes a name, an email address and
a password; the name is stored on the account and mirrored into a `public.profiles`
row by a database trigger.

The whole app is behind the login. `middleware.ts` refreshes the session on every
request and redirects signed-out visitors to `/login`, with `/login` and `/signup`
the only public paths. `/api/tryon` guards itself and answers `401` rather than
redirecting, so an API caller gets a readable message instead of HTML.

This is not decoration: every call to that route spends a real image generation, so an
account is the primary cost control and the rate limiter is the second layer.

Two setup steps that are **not** in the code, and that the app cannot do for you:

1. **Set the two Supabase variables** in `.env.local` (and in Vercel — see below).
   Both are `NEXT_PUBLIC_` and safe to expose; row level security is the real
   boundary. Never put the service-role key in this project.
2. **Turn off "Confirm email"** in the Supabase dashboard, under
   *Authentication → Sign In / Providers → Email*, and press Save. The app is built
   for instant login after signup. Leave it on and Supabase tries to send a
   confirmation mail through its built-in mailer, which is capped at a couple of
   messages per hour — signups then fail with `email rate limit exceeded`.

Supabase's *URL Configuration* (Site URL, Redirect URLs) does not apply here. Those
matter for email links, magic links and OAuth, none of which this flow uses.

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

Set all three environment variables in the Vercel project settings, for Production,
Preview and Development:

| Variable | Notes |
| --- | --- |
| `N8N_WEBHOOK_URL` | Server-only. Treat as a credential. |
| `NEXT_PUBLIC_SUPABASE_URL` | Public by design. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Public by design. Not the service-role key. |

**Add them before the build, and redeploy after adding them.** The two
`NEXT_PUBLIC_` values are baked in at build time, not read at runtime, and
`next.config.ts` also derives the CSP's `connect-src` from
`NEXT_PUBLIC_SUPABASE_URL` during the build. A build that ran without them ships a
CSP with no Supabase origin, and the browser then blocks every auth request
**silently** — the login form just spins, with nothing in the server logs and only a
CSP violation in the browser console. Redeploying is what fixes it; promoting an
existing deployment is not enough.

## Security

`N8N_WEBHOOK_URL` is a server-only env var, so it never reaches the browser. Treat it
as a credential: anyone holding that URL can trigger your workflow and spend image
generations. `.env.example` contains a placeholder only.

Because `/api/tryon` costs money per call, it requires a signed-in session, is rate
limited to 6 requests per minute per IP, restricted to same-origin browser requests,
capped at 6 MB per request, and
validates uploads by magic bytes rather than by the client's declared type. Responses
are allowlisted to JPEG/PNG/WEBP — an `image/svg+xml` reply is refused, since SVG can
carry script. Upstream error bodies are logged server-side and never returned to the
caller. Security headers including a CSP are set in `next.config.ts`.

The rate limiter is in-process, so on Vercel it applies per instance and resets on cold
start — enough for casual abuse, not a determined one. Use a shared store (Upstash,
Redis) if this goes anywhere public with real traffic.

On the auth side: sessions are cookie-backed, so the middleware, server components and
the route handler all see the same session. Every gate calls `getUser()` rather than
`getSession()` — the latter trusts the cookie as-is, the former revalidates the JWT
with Supabase. Failed logins return one generic message, so the form cannot be used to
find out which addresses are registered. `public.profiles` has row level security
scoped to `auth.uid() = id` and no insert policy, because rows arrive only via the
signup trigger.

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
| `middleware.ts` | Session refresh and the redirect for signed-out visitors |
| `app/login/page.tsx`, `app/signup/page.tsx` | The two public pages |
| `app/auth/actions.ts` | `signUp`, `signIn` and `signOut` server actions |
| `components/AuthForm.tsx` | One form for both modes; `AuthShell.tsx` frames it |
| `lib/supabase/` | Validated env plus the browser and server clients |
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

**Signup fails with "Too many attempts".** The server log shows the real cause,
`email rate limit exceeded`. That error only occurs when Supabase is trying to send a
confirmation email, which means "Confirm email" is still switched on — see **Auth**
above. Waiting does not really help: the quota refills, but you land back in the
confirmation flow.

**The login form spins forever and nothing appears in the logs.** Almost always the
CSP: `connect-src` is missing the Supabase origin, so the browser blocks the auth
request before it leaves the page. Check the browser console for a CSP violation, then
confirm `NEXT_PUBLIC_SUPABASE_URL` was set **at build time** and redeploy.

**A warning about `@next/swc-win32-x64-msvc` on every build.** The native compiler
binary is blocked by a Windows application-control policy, so Next falls back to the
slower WASM build. Harmless locally; Vercel's Linux builders are unaffected.
