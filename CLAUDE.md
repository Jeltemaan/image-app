# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install
npm run dev          # pinned to port 3001 (see "Ports" below)
npm run build        # also runs lint + typecheck
npx tsc --noEmit     # typecheck alone
```

There is no test suite and no test runner installed. `npm run lint` invokes the
deprecated `next lint`, which prompts interactively for ESLint setup and will hang a
non-interactive shell — use `npm run build` or `npx tsc --noEmit` to verify changes.

Verify behaviour end-to-end by POSTing through the proxy route rather than by
clicking, since the generation itself takes 10–30 s:

```bash
curl -X POST -F "image1=@person.jpg" -F "image2=@garment.png" \
  -o out.bin -w "[%{http_code}] %{content_type} %{size_download}\n" \
  --max-time 120 http://localhost:3001/api/tryon
```

A `200` with `image/jpeg` and a few hundred KB is success. Any failure comes back as
**plain text** intended for direct display to the user, not JSON.

Two things to keep in mind while testing that route:

- It is rate limited to **6 requests per minute** per client, and rejected requests
  count too. A burst of curl tests will start returning `429`; wait out the window
  rather than assuming a regression.
- Every successful call spends a real image generation upstream. Exercise validation
  and error paths with deliberately invalid payloads, which are refused before the
  upstream fetch and therefore cost nothing.

## Architecture

Next.js 15 App Router + TypeScript + Tailwind v4 + lucide-react. Single page, no
database, no auth. Deployed on Vercel.

The whole app is one pipeline: two local files → an n8n webhook → one binary image.

```
UploadTile ×2  →  TryOnStudio  →  POST /api/tryon  →  n8n webhook  →  blob → <img>
(validate,        (state,           (server-side       (Gemini image
 downscale)        fetch)            forward)           generation)
```

- `components/TryOnStudio.tsx` — the only stateful component. Holds both selections,
  a single `status` union (`idle | loading | success | error`), the result Object URL,
  and the fetch. Every UI state derives from `status`.
- `components/UploadTile.tsx` — one upload tile, used twice. Owns its own validation
  error and "preparing" state; reports upward only the finished `File`.
- `lib/image.ts` — client-side file-type validation and downscaling. Pure except for
  the canvas work.
- `app/api/tryon/route.ts` — the server-side forward to n8n, plus every guard listed
  under "Security model".
- `lib/upload-guard.ts` — server-side magic-byte validation and size limits.
- `lib/rate-limit.ts` — in-process fixed-window limiter for the route.
- `app/page.tsx` — static shell (utility bar, header, nav, tips footer). Server
  component; no logic.
- `next.config.ts` — security headers and the CSP.

Note the deliberate duplication: `lib/image.ts` (client) and `lib/upload-guard.ts`
(server) both validate types. The client copy is UX, the server copy is the actual
boundary. Changing one does not change the other.

### Why the request is proxied

The brief this was built from called for `fetch`ing the n8n webhook directly from the
browser. **Do not change it back.** n8n sends no `Access-Control-Allow-Origin` header
on webhook responses (verified against the live endpoint, including the OPTIONS
preflight), so a direct browser call dies in CORS with an error indistinguishable from
a network failure. The route handler forwards it server-side, which also keeps the
webhook URL out of the client bundle.

On both hops, never set `Content-Type` manually on a `FormData` body — the boundary
must be derived by the browser and by `undici` respectively.

### Webhook contract

`N8N_WEBHOOK_URL` (`.env.local`, and a Vercel env var per environment) must accept
`image1` and `image2` as `multipart/form-data` and respond with the image as a
**binary file**, not JSON. The route returns only `image/jpeg`, `image/png` or
`image/webp` (see the allowlist under "Security model"); anything else, including
JSON, is refused with an explanation.

Two n8n paths, and the route's 404 handler distinguishes them:

- `/webhook/<id>` — production. Requires the workflow switched **Active**.
- `/webhook-test/<id>` — only serves while the editor is open with "Listen for test
  event" armed, one request per arming.

Known open issue: sending two 1×1 pixel JPEGs still returns a fully-composed photo,
which means the workflow is likely not binding the received binaries to its image node
and is falling back to static test data. The frontend side is confirmed correct.

### Security model

`/api/tryon` is a **public endpoint that spends money** — one Gemini image
generation per call — so it is treated as a paid resource, not a convenience proxy.
In order, every request passes: same-origin check → rate limit → body size cap →
`formData()` → magic-byte validation → upstream fetch → response-type allowlist.

Invariants to preserve when editing that route:

- **Never echo an upstream response body to the client.** n8n error payloads carry
  workflow internals and node names. They go to `console.error` only; the caller
  gets a fixed message.
- **The response type is an allowlist, not `startsWith('image/')`.** `image/svg+xml`
  is scriptable XML; served from the app's own origin it is stored XSS.
- **Client-declared MIME types are ignored.** `lib/upload-guard.ts` sniffs magic
  bytes and rebuilds each blob with a server-chosen type and filename. Original
  filenames are discarded, not sanitised — nothing downstream needs them.
- The rate limiter (`lib/rate-limit.ts`) is in-process, so on Vercel it is per
  instance and resets on cold start. It stops casual hammering, not a distributed
  attacker; swap in a shared store if this gets real traffic.
- The same-origin check is CSRF defence, **not authentication** — requests with no
  `Origin` header (curl, server-to-server) pass through to the rate limiter. There is
  deliberately no auth: the page is meant to be publicly usable.

`N8N_WEBHOOK_URL` is server-only (never `NEXT_PUBLIC_`), so it stays out of the
client bundle. `.env.example` holds a placeholder; the real URL lives only in the
gitignored `.env.local` and in Vercel env vars. Treat that URL as a credential —
anyone holding it can invoke the workflow.

Security headers, including the CSP, are in `next.config.ts`. `script-src` still
needs `'unsafe-inline'` for Next's hydration bootstrap; removing it requires
per-request nonces via middleware, which is the first thing to tighten if the app
ever renders user-supplied content.

### Auth

Email + password accounts via Supabase, project `htpiluwvhvqjwaqkfnms`. The whole app
is behind the login: `middleware.ts` redirects any signed-out request to `/login`,
`/login` and `/signup` being the only public paths.

- `lib/supabase/env.ts` — the two `NEXT_PUBLIC_` values, validated once. They must be
  written as literal `process.env.NEXT_PUBLIC_X` member reads; Next only inlines that
  exact expression into the client bundle, so `process.env[name]` silently yields
  `undefined` in the browser.
- `lib/supabase/client.ts` / `server.ts` — the browser and cookie-backed server
  clients from `@supabase/ssr`. Sessions live in cookies, not localStorage, so the
  middleware, server components and the route handler all see the same session.
- `app/auth/actions.ts` — `signUp`, `signIn`, `signOut` server actions.
- `components/AuthForm.tsx` — one client form, `mode` prop switches login/signup.

Invariants:

- **Always `getUser()`, never `getSession()`.** `getSession` trusts the cookie as-is;
  `getUser` revalidates the JWT with the auth server. Every gate in this app uses
  `getUser`.
- **`/api/tryon` guards itself and returns `401`, not a redirect.** `/api/*` is
  excluded from the middleware matcher so an API caller gets a readable plain-text
  message rather than a `302` to HTML. The check sits after the same-origin check and
  before `formData()`.
- **Login is the cost control**, the rate limiter is the second layer. A curl without
  cookies no longer reaches n8n.
- **Email confirmation is deliberately off** (Authentication > Sign In / Providers >
  Email in the dashboard). `signUp` still handles the confirmation-on case explicitly:
  Supabase returns a user with no session, and without that branch the user would be
  redirected to `/` and bounced straight back to `/login`.
- **`connect-src` in `next.config.ts` must include the Supabase origin.** It is derived
  from `NEXT_PUBLIC_SUPABASE_URL` so the two cannot drift. Omitting it fails silently —
  login simply never completes, with only a CSP violation in the console.

`public.profiles` mirrors `id`, `full_name` and `email` from `auth.users`, written by
the `on_auth_user_created` trigger reading `raw_user_meta_data->>'full_name'`. RLS is
on with select/update policies scoped to `auth.uid() = id`; there is no insert policy
because rows only ever arrive via the trigger, whose `EXECUTE` is revoked from `anon`
and `authenticated` so it is not callable over `/rest/v1/rpc`. App code never queries
`auth.users`.

Both `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` must also be
set in the Vercel project for every environment. They are public by design — RLS is the
boundary — but the service-role key must never enter this repo.

### Image size budget

Vercel caps serverless request bodies at ~4.5 MB, so `lib/image.ts` gives each file a
2 MB budget. Oversized files are **downscaled, not rejected** (1600 px long edge,
stepping JPEG quality down) — phone photos are routinely 3–8 MB and refusing them
dead-ends the user. That conversion flattens onto white first, because JPEG has no
alpha channel and a transparent PNG cutout would otherwise render on black.

Accepted types: JPEG, JPG, PNG, WEBP. Changing this list means touching three places —
`ACCEPTED_MIME`/`ACCEPTED_EXT` in `lib/image.ts`, the `accept` attribute in
`UploadTile.tsx`, and the user-facing copy in `app/page.tsx`.

### Object URL discipline

Previews and results are `URL.createObjectURL` blobs. `TryOnStudio` tracks every URL
it creates in a ref-held `Set` and revokes on replace, on reset, and on unmount. New
code that creates an Object URL must register it the same way.

### File inputs

The hidden `<input type="file">` in `UploadTile` is deliberately a **sibling** of the
clickable `<div role="button">`, not a child. As a child, `input.click()` dispatches a
bubbling click that re-triggers the wrapper's `onClick` and recurses; Chrome then
suppresses the picker with "File chooser dialog can only be shown with a user
activation" and no file is ever delivered. This was a real bug — do not nest it.

Likewise the hover overlay on a filled tile is `pointer-events-none` until hover, or it
silently swallows clicks while invisible.

## Design reference

`Schermafbeelding 2026-08-28 093335.png` in the repo root is the Zalando homepage,
used as a *design language* reference only — layout skeleton, bold tight typography,
`#FF6900` accent, black pill buttons, softly rounded image panels. Branding is
deliberately neutral (no Zalando logo or name). Colour tokens live in
`app/globals.css` under Tailwind v4's `@theme` (`accent`, `ink`, `hairline`, `bar`,
`muted`), so use `bg-bar` / `border-hairline` / `text-muted` rather than raw greys.

## Environment quirks on this machine

- **`next dev` crashes after "Starting…"** with `readlink EINVAL` on
  `.next/server/middleware-build-manifest.js` when a `next build` ran first. Fix:
  `rm -rf .next`. The project lives in a OneDrive-synced folder, a recurring source of
  this class of file-locking error.
- **Ports:** 3000 is occupied by an unrelated project, so `dev` is pinned to `-p 3001`.
  A stopped dev-server task can leave an orphaned `node` process still holding the
  port and serving stale code. Kill by port, not by task:
  ```powershell
  Get-NetTCPConnection -State Listen -LocalPort 3001 | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
  ```
- **SWC:** the native `@next/swc-win32-x64-msvc` binary is blocked by a Windows
  application-control policy, so builds fall back to the slower WASM compiler and emit
  a warning on every run. Harmless; Vercel's Linux builders are unaffected.
- `npm audit` flags PostCSS advisories inside Next 15's own dependency tree. Build-time
  only; the only fix is a breaking upgrade to Next 16.
