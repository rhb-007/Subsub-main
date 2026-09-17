# SubSub app (app.subsub.work)

The product itself — subcontractor onboarding, compliance verification,
scheduling and work orders — as distinct from the marketing site at
`subsub.work` (that's the repo root, this is `/app`).

## Status: Phase 1 (persistence) — backend built and tested, not yet wired into the UI

- `src/App.tsx` is the original prototype, unchanged. It still runs entirely
  on `useState` and seed data — reload and it resets. This is the known,
  working baseline.
- `worker/` is a real Cloudflare Worker (Hono) API over D1 + R2, implementing
  the production data model the prototype's own `COMPANY_FIELDS` /
  `ENGAGEMENT_FIELDS` / `splitPatch()` / `composeSub()` already describe:
  **companies** (a business, global, deduped on WA L&I license) ×
  **accounts** (a hiring company's workspace) × **engagements** (the
  relationship between them, where per-GC rating/docs/auto-schedule live).
- `src/lib/api.js` is a fetch client for that API, ready to use, not yet
  called from `App.tsx`.
- **What's tested:** schema applied and seeded locally; auth headers, role
  enforcement (contractor blocked from admin actions), the `splitPatch`
  field-routing (a patch with both a company field and an engagement field
  lands in both tables correctly), job creation, work-order issuance
  (including the documents-incomplete gate blocking assignment), and
  license-check storage — all verified against a local D1 instance with
  `wrangler dev`.
- **What's not done yet:** `App.tsx` still doesn't call the API. Wiring it in
  — replacing each relevant `useState` with a fetch, keeping the same props
  every child component already expects — is the next chunk of work.

## Before this can go live, you need to:

1. **Create the real D1 database and R2 bucket** (from a real computer, or
   via the Cloudflare dashboard — this sandbox can't reach `api.cloudflare.com`):
   ```
   wrangler d1 create subsub-db        # copy the returned database_id into wrangler.toml
   wrangler d1 execute subsub-db --remote --file=./worker/schema.sql
   wrangler r2 bucket create subsub-files
   ```
2. **Decide on auth.** `worker/index.js`'s auth middleware is a dev stub —
   it trusts `X-User-Id`/`X-Account-Id` headers with zero verification. Fine
   for local testing, not safe on the internet. Clerk or Supabase Auth are
   the recommended options (see DEPLOYMENT.pdf) — either needs an account
   only you can create, same as the Cal.com/Formspree signups for the
   marketing site.
3. **Set `CRON_SECRET`** (`wrangler secret put CRON_SECRET`) before the
   nightly license-sweep endpoint (`/api/cron/license-sweep`) is usable.
4. **Connect this repo to a new Cloudflare Pages/Workers project** for
   `app.subsub.work`, same pattern as `subsub-main` — but with **root
   directory set to `/app`**, build command `npm run build`, output
   directory `dist`. The Worker API (`worker/index.js`) deploys separately
   via `wrangler deploy` (or its own Workers Build), and the frontend calls
   it at whatever URL that Worker gets — update the `/api` proxy target
   accordingly (currently only configured for local dev in `vite.config.js`).

## Local development

```
npm install
npx wrangler d1 execute subsub-db --local --file=./worker/schema.sql --config=./wrangler.toml
npx wrangler d1 execute subsub-db --local --file=./worker/seed.sql --config=./wrangler.toml
npx wrangler dev --config=./wrangler.toml --local --port 8787   # API on :8787
npm run dev                                                      # Vite dev server, proxies /api to :8787
```

Note the `--config=./wrangler.toml` — the repo root has its own
`wrangler.jsonc` for the marketing site, and wrangler will pick that one up
instead of this directory's config unless told otherwise.

## Data model

See `worker/schema.sql` for the full schema and inline comments, and
`DEPLOYMENT.pdf` for the reasoning behind it (the identity model, WA L&I
license verification, work-order immutability, suggested phased rollout).
