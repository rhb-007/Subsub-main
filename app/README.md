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
2. **Auth: built, needs your anon key + a live-network check.** Real auth
   (Supabase) is wired end to end — sign in/sign up/forgot password on the
   frontend, JWT verification against Supabase on the Worker, auto-linking
   a Supabase login to an existing internal `users` row by email on first
   sign-in. It activates automatically wherever both are configured, and
   falls back to the `X-User-Id` dev stub wherever they aren't — same code,
   two modes, chosen by whether the env vars below are set. To turn it on:
   - **Frontend**: copy `app/.env.example` to `app/.env`, fill in
     `VITE_SUPABASE_ANON_KEY` from Project Settings → API → "anon public" in
     your Supabase dashboard (the URL is already filled in).
   - **Worker**: set `SUPABASE_URL` and `SUPABASE_ANON_KEY` the same way —
     in the Cloudflare dashboard (Worker → Settings → Variables) for the
     deployed Worker, or in a local `app/.dev.vars` (gitignored) if testing
     from a machine that can actually reach Supabase.
   - **What I could NOT verify from this environment**: this sandbox's
     network policy blocks `*.supabase.co` the same way it blocks
     `data.wa.gov` and the Census geocoder — confirmed by watching the
     Worker's own log show `SUPABASE_URL`/`SUPABASE_ANON_KEY` correctly
     loaded from a test `.dev.vars`, correctly rejecting the old dev-stub
     header once real-auth mode was active, and correctly attempting (then
     network-failing) the real Supabase verification call. That proves the
     branching logic is sound; it does NOT prove a real login round-trips
     successfully. **Test one real sign-up + sign-in once you have the anon
     key and either deploy or run locally on a machine with real network
     access** before relying on this.
   - **Inviting people**: adding someone via Users → Add only creates the
     internal `users`/`membership` rows (unchanged from before) — it does
     NOT create their Supabase login. They create that themselves via
     "New here? Create an account" on the login screen using the same
     email you invited; `resolveSupabaseUser()` in `worker/index.js` links
     the two by email automatically on their first sign-in. No service_role
     key needed for this. (A service_role key would let an admin provision
     + email-invite someone directly from the Worker instead of them
     self-registering — not built, since the self-serve path above covers
     the same need without a second secret to manage.)
   - **Each account's own subdomain is a real, self-serve contractor
     application page**, not just a login form. Visiting
     `outerhome.subsub.work` shows Outerhome's own name/logo (see
     `GET /api/account-by-subdomain/:subdomain`, public, exists only to
     supply that pre-login branding) instead of generic branding, and
     "New here? Apply to work with Outerhome" creates a real, bare-bones
     contractor membership in Outerhome specifically — a company profile
     with "documents incomplete", same starting state as an admin's
     minimal add-a-sub — via `POST /api/self-signup`, landing them straight
     in the app afterward. This only activates when a real subdomain is
     detected (`detectSubdomain()` in `src/App.tsx`); the generic
     `app.subsub.work` entry point has no company to attach to, so sign-up
     there still falls back to the invite-only behavior above. Getting a
     real company onto its own subdomain requires two things beyond what's
     described here: a real `accounts` row with that `subdomain` value, and
     adding e.g. `outerhome.subsub.work` as an *additional* custom domain
     on the same Pages project `app.subsub.work` already uses (they all
     serve the same frontend build; the hostname alone decides the
     branding and sign-up behavior at runtime).
   - **The demo-account picker and "Switch user" menu disappear** once
     `supabaseEnabled` is true — they were always dev-only conveniences,
     and letting anyone become anyone else with a menu click makes no
     sense next to a real auth system, so the code hides both rather than
     leaving them reachable.
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

## Expanding license verification beyond Washington

`STATE_LICENSING_APIS.md` surveys all 49 other states + DC for the same
thing the WA integration already does: open contractor-license data, a
public lookup tool if not, or a commercial aggregator shortcut. Short
version — **Oregon** is the closest match to WA's pattern (one Socrata
dataset with license + bond + insurance together); Connecticut, Iowa,
Illinois, Texas, and DC have real open APIs but each with real scope
caveats (wrong trade, missing fields, or no GC license in that state at
all — read the doc before trusting any of them); most states (~30) have
only a public lookup tool with no API; and roughly 11 states have no
state-level GC licensing at all. Every claim in that doc is flagged
"reported, not verified" — the research session hit the same network block
this one does (blocked from `data.wa.gov`-equivalent hosts in every other
state too), so it's built from search results, not live fetches.

**Now actually wired up (`worker/index.js`), not just researched:**
`POST /api/subs/:companyId/verify-license` and the nightly
`GET /api/cron/license-sweep` both dispatch on the company's own `state`
column (falling back to `WA`) through `verifyLicenseForState()` — WA,
Oregon, Connecticut, Iowa, Illinois, and Texas via a shared
`verifySocrataState()` (config-driven per state: base URL, license-number
field, dataset ids, a response `map()`), DC via its own `verifyDC()`
(ArcGIS, not Socrata), and anything else returns a clean
`{status:"UNSUPPORTED_STATE", supportedStates:[...]}` rather than an error.
Every `license_checks` row now records which `state` it checked and a
`field_mapping_verified` flag — **`1` only for WA**, whose field names come
from confirmed dataset knowledge; every other state's `map()` is a
best-effort guess from search results, same caveat as the doc above. The
full raw response is always stored alongside the mapped fields, so a wrong
guess is recoverable without re-querying the source.

**What's verified vs. not:** the dispatch logic, the per-state config
shape, and the DB writes are all confirmed correct — end-to-end, including
against the actual local D1 (`state` and `field_mapping_verified` columns
populate correctly, `UNSUPPORTED_STATE` returns cleanly for an unhandled
code, the cron sweep only flags real status changes). What's **not**
verified is any live state dataset's actual field names beyond WA's,
because this sandbox can't reach `data.oregon.gov`, `data.ct.gov`, or any
other state's open-data host any more than it could reach `data.wa.gov`.
Fixed a real bug found while confirming this: `verifySocrataState()` and
`verifyDC()` used to call `.json()` directly on the fetch response, so any
non-JSON reply (a block page, a rate-limit response, an outage page —
exactly what this sandbox's own network policy returns) threw an unhandled
`SyntaxError` and 500'd the whole request. Both now go through a shared
`fetchJsonSafe()` and degrade to a `{status:"CHECK_FAILED", error}` result
instead — confirmed locally by watching a real `data.wa.gov` call get
blocked by this sandbox and come back as a clean `CHECK_FAILED` response,
not a crash. Also fixed: `GET /api/cron/license-sweep` was unreachable
outright — the global `/api/*` auth middleware ran before its own
`CRON_SECRET` bearer check and always 401'd first, so the cron target has
never actually worked. It's now exempted from that middleware like
`/api/logo/:accountId` already was, and a local `.dev.vars`-based test with
a real `CRON_SECRET` confirms it now correctly rejects a wrong secret and
runs the real sweep with the right one.

**Do the same WA-style sanity check** (curl each dataset's `.json`
endpoint, confirm field names against what `map()` assumes) before
trusting any non-WA state's `field_mapping_verified: false` result in
production — the `raw` column on every `license_checks` row has exactly
what you need to compare against.
