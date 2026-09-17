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
- **Verified four ways.** `scripts/e2e-smoke.mjs` drives a real headless
  browser through the actual UI — sign in, create a job, **reload the page**,
  confirm the session AND the job survive — then a direct D1 query confirms
  the row is really there, not a client-side illusion. `scripts/e2e-upload-smoke.mjs`
  does the same for a real document: signs in as a contractor with one
  missing, uploads a real file through the actual `<input type=file>`,
  reloads, confirms it still shows as under review — then a direct R2 + D1
  check confirms the bytes and the record are both really there.
  `scripts/e2e-logo-smoke.mjs` does the same for account branding: signs in
  as a Scale-plan admin, uploads a logo, reloads, and confirms the persisted
  `<img>` actually loads from the public `/api/logo/:accountId` endpoint (not
  a cached local blob). Underneath all three, the API itself was curl-tested
  for auth/role enforcement, the `splitPatch` field-routing, the
  documents-incomplete gate blocking work-order assignment, and the
  cross-account document-review reset on re-upload.
- Run them yourself: start both dev servers (see "Local development" below),
  then any of `node scripts/e2e-smoke.mjs`, `node scripts/e2e-upload-smoke.mjs`,
  `node scripts/e2e-logo-smoke.mjs` from `app/`.
- **Three real bugs caught while building this, all fixed:** the "Switch
  user" dev menu assumed `user.role` existed directly on the (now-global,
  correctly normalized) user record — it crashed the whole app the moment
  you opened the user menu as a real hydrated user, since role actually
  lives on the membership now. The original upload endpoint called
  `R2Bucket.createPresignedUrl()`, which isn't a real method — see below.
  And `POST /api/subs` only ever persisted a new company's identity fields
  (name, contact, license, ...) — crews, coverage, insurance/bond/contract/w9
  and categories typed into the same "add a sub" form were silently dropped
  on the server, even though they displayed fine locally until the next
  reload wiped them. Fixed by extracting the same field-routing logic the
  PATCH endpoint already used into a shared `applySubPatch()`, applied on
  creation too — but **only** for a genuinely new company; verified with
  curl that inviting an *existing* (deduped, shared) company with a blank
  form does NOT wipe out that company's real profile, since only categories/
  caps (this account's own view of them) get written in that case.

### Persistence wiring — what's covered, what isn't

Covered (write-through: the existing local `useState` update still runs for
instant UI feedback, and the same action also calls the API): jobs (create/
complete/reopen/notes/measurement docs on an EXISTING job), work orders
(assign/unassign/respond/rate/crew/signed-file — signed-file is a real
upload), companies & engagements (add, edit, WA L&I verify, document review,
**real file upload** — a genuine binary PUT through the Worker into R2, not
a filename placeholder, including the cross-account review reset), account
users (add/edit/remove), account branding/plan/billing (name, plan, billing,
**and now a real logo upload**, served publicly from `/api/logo/:accountId`
since the login screen needs to show it before anyone's authenticated),
uniform orders (submit/approve/deny), and service calls (raise/confirm/resolve).

Note on how uploads work: `R2Bucket` has no `createPresignedUrl()` — real S3-
style presigned URLs on R2 need the S3-compatible API signed with an R2 API
token, not the Workers binding. `PUT /api/uploads/:kind/:fileName` instead
streams the upload straight through the Worker into R2 with the binding's
own `put()`. Simpler, and fine for compliance-doc- and logo-sized files; if
upload volume ever justifies taking the Worker out of the data path, swap it
for real presigned URLs via `aws4fetch` + an R2 API token.

Not yet covered — genuinely local-only, will not survive a reload:
- **Measurement docs when creating a NEW job, and the admin "edit sub" doc
  fields** (`SubForm`) are still filename-only — real upload is wired for
  the two paths that actually matter for the compliance workflow
  (contractor document self-service and signed work orders), not yet these
  two secondary ones. (Measurement docs on an already-existing job persist
  fine — it's specifically the new-job form, before the job has an id in a
  way the UI's current flow makes convenient, that's still local-only.)
- **New company/user ids drift locally until the next reload.** `addSub`/
  `addUser` optimistically assign a `Date.now()`-based id client-side; the
  server assigns its own (or reuses an existing company on license/email
  match). They reconcile on the next hydrate (reload or account switch),
  but a same-session reference to a brand-new id before that point is
  using the local one, not the server's.

Fixed along the way: `w9` used to be seeded on the flat sub object without
ever being added to `COMPANY_FIELDS`, so `splitSeed`/`splitPatch` silently
dropped it on every round-trip (a pre-existing gap in the prototype itself).
Added `w9` to `COMPANY_FIELDS` and a matching `companies.w9` column —
verified it now round-trips through the API the same as insurance/bond/contract.

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
