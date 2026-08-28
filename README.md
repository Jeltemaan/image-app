# Virtual Try-On

Single-page app: upload a photo of a person and a garment, post both to an n8n
webhook as `multipart/form-data`, and render the binary image the workflow returns.

Next.js 15 (App Router) + TypeScript + Tailwind CSS v4 + lucide-react.

## Run locally

```bash
npm install
cp .env.example .env.local   # already done; edit if your webhook URL changes
npm run dev
```

Open http://localhost:3000

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
handler rejects anything whose `Content-Type` is not `image/*` and explains why.

## Deploy to Vercel

```bash
npx vercel
```

Set `N8N_WEBHOOK_URL` as an environment variable in the Vercel project settings
(Production, Preview and Development).

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
| `app/api/tryon/route.ts` | POST proxy to n8n |
| `app/globals.css` | Tailwind import and design tokens |
