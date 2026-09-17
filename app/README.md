# SubSub app (app.subsub.work)

The product itself — subcontractor onboarding, compliance verification,
scheduling and work orders — as distinct from the marketing site at
`subsub.work` (that's the repo root, this is `/app`).

## Status: Phase 1 (persistence) — built, wired into the UI, and verified end-to-end

- `worker/` is a real Cloudflare Worker (Hono) API over D1 + R2, implementing
  the production data model the prototype's own `COMPANY_FIELDS` /
  `ENGAGEMENT_FIELDS` / `splitPatch()` / `composeSub()` already describe:
  **companies** (a business, global, deduped on WA L&I license) ×
  **accounts** (a hiring company's workspace) × **engagements** (the
  relationship between them, where per-GC rating/docs/auto-schedule live).
- `src/App.tsx` still holds all its original `useState`, but every mutator
  now also writes through to the API (`src/lib/api.js`), and login/reload
  hydrate real state from D1 instead of seed data — see "Persistence
  wiring" below for exactly what's covered and what's a known rough edge.
- **Verified two ways:** `scripts/e2e-smoke.mjs` drives a real headless
  browser through the actual UI — sign in, create a job, **reload the page**,
  confirm the session AND the job survive — then a direct D1 query confirms
  the row is really there, not a client-side illusion. Underneath that, the
  API itself was curl-tested for auth/role enforcement, the `splitPatch`
  field-routing, the documents-incomplete gate blocking work-order
  assignment, and the cross-account document-review reset on re-upload.
- Run it yourself: start both dev servers (see "Local development" below),
  then `node scripts/e2e-smoke.mjs` from `app/`.

### Persistence wiring — what's covered, what isn't

Covered (write-through: the existing local `useState` update still runs for
instant UI feedback, and the same action also calls the API): jobs (create/
complete/reopen/notes/measurement docs), work orders (assign/unassign/
respond/rate/crew/signed-file), companies & engagements (add, edit, WA L&I
verify, document review, document upload — including the cross-account
review reset), account users (add/edit/remove), account branding/plan/
billing (name and plan/billing persist; logo does not, see below), uniform
orders (submit/approve/deny), and service calls (raise/confirm/resolve).

Not yet covered — genuinely local-only, will not survive a reload:
- **Real file uploads.** Documents are still filenames only, same as the
  original prototype — `api.uploadDocument` is called with a placeholder
  key. Wiring an actual `<input type=file>` to the presigned R2 flow
  (`api.signUpload`) is straightforward but not done.
- **Account logo.** `useDefaultMark`/name persist; the logo image itself
  doesn't have an upload flow yet, same reason as above.
- **New company/user ids drift locally until the next reload.** `addSub`/
  `addUser` optimistically assign a `Date.now()`-based id client-side; the
  server assigns its own (or reuses an existing company on license/email
  match). They reconcile on the next hydrate (reload or account switch),
  but a same-session reference to a brand-new id before that point is
  using the local one, not the server's.

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
