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
   - **The "Switch user" menu disappears** once `supabaseEnabled` is true.
     Letting anyone become anyone else with a menu click makes no sense
     next to a real auth system, so the code hides it rather than leaving
     it reachable.
3. **Set `CRON_SECRET`** (`wrangler secret put CRON_SECRET`) before the
   nightly license-sweep endpoint (`/api/cron/license-sweep`) is usable.
4. **Connect this repo to a new Cloudflare Pages/Workers project** for
   `app.subsub.work`, same pattern as `subsub-main` — but with **root
   directory set to `/app`**, build command `npm run build`, output
   directory `dist`.

5. **Give the API Worker its own Workers Build.** `worker/index.js` is a
   separate deploy from the frontend, and for a long time it had no
   automated one at all: it was deployed by hand with `wrangler deploy`,
   so every push left the app live and the API a commit behind, with no
   button anywhere to fix it. In the Cloudflare dashboard, open the
   `subsub-api` Worker → Settings → Build, connect this repository, and set:

   | Setting | Value |
   |---|---|
   | Root directory | `app` |
   | Build command | `npm ci --include=dev` |
   | Deploy command | `npx wrangler deploy --config=wrangler.toml` |
   | Version command | `npx wrangler versions upload --config=wrangler.toml` |
   | Production branch | the repository's only branch |

   The **build command is not `npm run build`**, which the dashboard offers by
   default. That is `vite build`, the frontend, and it has nothing to do with
   this Worker: it deploys the same either way, but a frontend that fails to
   build would then block an API deploy that never needed it.

   The **version command needs `--config` as much as the deploy command
   does.** It runs for non-production branches once Worker Previews are on,
   and without it uploads a version of the wrong project.

   **`--config` is not optional, on any wrangler command run from `app/`.**
   Wrangler looks for its config in the working directory and then walks *up*,
   and the repository root holds `wrangler.jsonc` — the marketing site, whose
   assets directory is the whole repo. A bare `npx wrangler deploy` from
   `app/` finds that one, not this one, and deploys the wrong project.
   Locally it fails loudly, on a 126 MiB file in `node_modules`; with
   credentials in hand it can succeed at the wrong thing. Same reason the
   console Worker's deploy command names `wrangler.admin.toml`.

   This is not only about deploys. `npm run db:migrate:local` sat broken for
   the same reason — the root config declares no D1 binding, so it failed
   with "Couldn't find a D1 DB with the name or binding 'subsub-db'". Every
   script in `package.json` now names the file.

   **`--include=dev` is not optional either.** `hono` and `wrangler` are both
   devDependencies, so a build environment with `NODE_ENV=production` would
   install neither and fail with a missing module.

   Deploys leave dashboard variables alone — see `keep_vars` in
   `wrangler.toml`. D1 migrations are **not** run by this and stay manual.

   **Which migrations has a database actually had?** Paste
   `worker/migrations/CHECK.sql` into the D1 console. One row, one column per
   migration, 1 for applied and 0 for not. There is no migrations table to
   consult, so it asks the schema itself, which cannot be wrong about it.
   "Did I run that one?" comes up after nearly every round and the honest
   answer from a chat thread is a guess.

   **Run one migration per paste.** D1 stops a multi-statement script at the
   first statement that errors and never runs the rest — it does not roll the
   earlier ones back either, so a half-applied script is a normal outcome.
   Pasting 023, 024 and 025 as one block when 023 was already applied means
   the first line fails on "duplicate column name", the other five statements
   never run, and the console shows one error that reads like one problem.
   That is not hypothetical: it left `jobs.updated_at` missing in production,
   and the jobs list — which ordered by it — failed for every signed-in
   person. Paste one file, then re-run `CHECK.sql`, then paste the next.

   The app now survives that particular gap (`/api/jobs` falls back to
   ordering by `created_at`, and anything that genuinely cannot work names
   the migration file on screen), which is what `npm run test:migration-gap`
   holds in place. It is a safety net, not a reason to skip the check.

   `.github/workflows/deploy-api.yml` does the same job from GitHub Actions,
   for anyone who would rather not use Workers Builds. It only uploads when
   `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are set as repository
   secrets; without them it still lints and builds the Worker on every push,
   which is worth having either way. **Do not set those secrets while Workers
   Builds is connected** — two deployers on the same push is a race with no
   winner.

   The frontend calls the API at whatever URL that Worker gets — update the
   `/api` proxy target accordingly (currently only configured for local dev
   in `vite.config.js`).

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

## Trades, white-label colors, and the public application form

- **Trades**: `CATEGORIES`/`CAP_LIBRARY` in `src/App.tsx` cover 29 trades
  across exterior/structure/MEP/interior finishes/outdoor/specialty — no
  schema change, since a company's/job's trades were always a free-form
  JSON array.
- **White-label colors**: an account's own subdomain (`outerhome.subsub.work`)
  can be recolored — page/card background, text, button color, button text
  — via a 5-swatch picker in Account → Company, with a live WCAG contrast
  warning and a themed preview. Stored as `accounts.theme` (JSON), validated
  server-side against `^#[0-9a-fA-F]{6}$` before it's ever written (these
  values become CSS custom properties on a public page, so an unvalidated
  string is a stylesheet-injection vector). Applies to exactly two pages —
  the sign-in screen and the application form below — never the app itself.
- **Public application form**: "Apply to work with {name}" on a real
  subdomain's login screen opens a 3-step, unauthenticated form
  (`SubSignup` → `POST /api/apply/:subdomain`) — company info, trades,
  warranty/notification prefs. It creates a bare company profile
  (documents incomplete, same starting state as an admin's own minimal
  "add a sub"), an `invited` engagement, and an internal `users` row with
  `auth_id` left null — so when that person later signs up for real via
  "Already invited? Create your password" on the login page,
  `resolveSupabaseUser()`'s existing by-email linking picks it up with no
  further wiring. Dedupes on license number exactly like the admin's own
  invite flow, so a contractor already on SubSub for another GC doesn't
  get a duplicate profile. This fully replaces the narrower self-signup
  mechanism from earlier (which needed a Supabase account to already
  exist) — it's public and unauthenticated by design, matching
  `DEPLOYMENT.pdf`'s own description of this as "the only unauthenticated
  endpoint in the product."
  - **Not yet built**: rate limiting, a CAPTCHA, and not-confirming
    whether an email/license already exists in the response — all
    explicitly called out in `DEPLOYMENT.pdf` as needed before this is
    genuinely public-internet-safe. Fine for now since nothing links to
    it publicly yet, but do this before a real GC puts this URL on their
    website.

## The platform console's dashboard

Two periods and one picture, all derived from the same walk of the
append-only `subscription_events` log — MRR and the paying-account count are
cumulative, so computing them twice is how a dashboard ends up showing two
numbers for the same thing.

- **This month** is fixed. **Range** is scoped by a picker that sits above
  everything it controls, so the chart and the tiles under it are always the
  same window. Both render through the same `PeriodStats`, which is what
  makes them comparable: new accounts, free → paid (count and rate), churn
  (count and rate), net new MRR, ARR contribution, GMV, SMS.
- **Rates carry their denominator on the tile.** Free → paid is conversions
  over signups *in the same window*, not a cohort rate — somebody who signed
  up in March can convert in April — so it says "of N signups" rather than
  implying otherwise. Churn divides by who was paying when the window
  opened; dividing by today's count flatters every month in which anyone
  joined.
- **The chart** toggles between MRR and paying accounts and projects the rest
  of the month with a least-squares line over the drawn window. It is drawn
  dashed, labelled "projected", never given the weight of the measured part,
  and clamped at zero — nobody has minus two customers. It is a straight line
  through what happened, not a forecast, and the caption says so.
- **`right now`** keeps the four cards that are also the way into each
  screen. A level (MRR) and a change (net new MRR) are not redundant; the
  all-time tile row that restated those cards was, and is gone.

SMS usage reads from `sms_log` (migration 011). Nothing writes to it yet —
SMS is not wired up — so the tile reads zero and starts being true the moment
the first message is sent, with no further console work. It records
`cost_cents` (what the carrier charges) separately from `billed_cents` (what
the account is charged), because the margin between them is the only reason
to record either.

## Branded hostnames (`outerhome.subsub.work`) — provisioned automatically

A Scale account is sold its own address, and it used to be a dead link until
somebody opened Cloudflare, added a custom domain to the Pages project and
waited for a certificate. One manual step per customer is one step nobody
does on a Friday, and the customer meets a certificate warning on the thing
they just paid for. `worker/hostnames.js` does it instead.

**What happens, and when.** Reaching Scale — signing up on it, upgrading
through Stripe, being created or comped from the console — triggers two
idempotent Cloudflare calls: a *proxied* CNAME in the zone pointing the
subdomain at `<project>.pages.dev`, and the hostname registered as a custom
domain on the Pages project so a certificate is issued. Dropping off Scale,
or deleting the account, removes both. Nothing else needs doing.

Provisioning never fails the request that triggered it. Signing up, or
paying, does not depend on Cloudflare's API answering this second: the
account's `hostname_status` records where it got to, and the sweep in the
Worker's `scheduled` handler retries every ten minutes until it is `active`.
Both the sweep and the "Set it up now" button in the console re-run the same
idempotent calls, so a blind retry is always safe.

**The console shows it.** Account detail has a Branded address panel with
the live status, Cloudflare's own error text when there is one, and a
re-check button; the accounts list flags any Scale account whose address is
not live, because that is the one failure a customer notices before we do.

**Setup — four values on the `subsub-api` Worker**, then this runs by
itself. Until they are set, provisioning is a no-op and nothing breaks.

| Name | Where to find it | Kind |
|---|---|---|
| `CF_API_TOKEN` | dash.cloudflare.com → My Profile → API Tokens → Create Token → Custom | **Secret** |
| `CF_ACCOUNT_ID` | Cloudflare dashboard → Workers & Pages → right-hand sidebar | Variable |
| `CF_ZONE_ID` | Cloudflare dashboard → `subsub.work` → Overview → right-hand sidebar | Variable |
| `CF_PAGES_PROJECT` | the Pages project name serving the app — `subsub-app` | Variable |

`APP_DOMAIN` is optional and defaults to `subsub.work`.

The token needs exactly two permissions, and no more — it can create DNS
records in a live zone, so scope it tightly:

- **Zone → DNS → Edit**, restricted to the `subsub.work` zone
- **Account → Cloudflare Pages → Edit**, restricted to this account

**Run the migration first**: `worker/migrations/010_branded_hostnames.sql`
adds `hostname_status`, `hostname_error` and `hostname_checked_at` to
`accounts`.

**Guardrails.** `hostnames.js` re-checks the reserved-subdomain list itself
rather than trusting the stored row — it is the code that can actually point
a hostname somewhere, and a stored subdomain of `api` would take
`api.subsub.work` away from the API. Deprovisioning only ever deletes DNS
records carrying this code's own comment, so a record somebody added by hand
is left alone. `scripts/hostnames-test.mjs` (`npm run test:hostnames`) covers
both, plus retry-safety and each failure mode, against a stand-in for
Cloudflare's API.

## Licence verifiers, behind the states' own registries

Six states and DC are wired directly to their own open data. That is free and
authoritative and always wins. The other forty-three have never been
checkable at all, which is what the two commercial verifiers are for — and
they also stand behind the wired states when one of those is down.

**The order is the point.**

1. The state's own registry, where there is one. If it answers — found, or
   genuinely not found — that is the answer.
2. Otherwise each configured provider in turn; first definite answer wins.
3. Otherwise, honestly unsupported.

A paid aggregator saying "active" over a state registry saying "no such
licence" is worse than having no aggregator, so step 2 never runs when step 1
produced an answer. Only a failed call or an unsupported state falls through.

**Worker secrets** (not plain variables — these are keys):

| Variable | Provider |
|---|---|
| `STATELICENSE_API_KEY` | StateLicense.io |
| `TRADESAPI_API_KEY` | TradesAPI |

Unset, the wired states answer as before and everywhere else reports
`UNSUPPORTED_STATE`, which is the honest answer rather than a silent pass.

### A status is never inferred

Both clients were written **without ever having seen a real response** —
neither vendor was reachable from the environment they were built in. So
`readVerify()` reads field *names* in the two or three spellings a verifier
of this kind uses (`status`, `license_status`, `licenseStatus` all
unambiguously mean the same thing) and, if none of them is present, reports a
check that did not complete and logs the body whole. It never decides a
licence is active because a payload did not say otherwise.

That matters more here than anywhere else in this codebase. A licence wrongly
shown as active is how somebody uninsured ends up on a roof. Provider results
therefore always carry `fieldMappingVerified: false`, the same flag the five
unchecked state mappings carry.

A `404` is treated the same way. From outside it cannot be told apart from a
guessed endpoint that does not exist, and "this contractor has no licence" is
a sentence with consequences.

### Pinning the real shapes

`GET /api/platform/license-probe?state=CA&license=1078456` — staff only. It
asks every configured provider the same question and returns each one's HTTP
status, the first 2KB of its answer, and whether `readVerify()` recognised
it. The keys never leave the Worker.

That is the shortest path from "we think this works" to "we watched it work",
and it needs a browser rather than a terminal. Run it once against a licence
you can check by hand, and the mappings stop being guesses.

**TradesAPI's request shape is itself a guess.** No documentation for it was
available when it was wired, so `PROVIDERS` marks it `unverifiedRequest:
true` and the probe reports that alongside the answer. Expect to correct the
path.

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

---

## Properties, change orders, and the platform console

The app now builds from one source in two shapes, chosen at build time:

```
VITE_BUILD=tenant   npm run build    # app.subsub.work and each GC's subdomain
VITE_BUILD=platform npm run build    # admin.subsub.work, SubSub's own console
```

Vite substitutes the literal, so in a tenant build every `BUILD ===
"platform"` branch folds to false and the console is dropped by the
minifier. Checked against the built bundles: the tenant bundle contains no
`Superadmin`, `Revenue`, `Health` or impersonation code and is about 24 KB
smaller. That is what keeps the console off the customer domain — the two
hostnames are two builds of this one repo, not one bundle that hides a tab.

### Database changes

`schema.sql` is the full picture for a **fresh** database. It is not
re-runnable against a live one, because its `CREATE TABLE`s have no `IF NOT
EXISTS`. For a database that already has the earlier schema, apply the
migration instead:

```
npx wrangler d1 execute subsub-db --config=wrangler.toml \
  --file=./worker/migrations/002_properties_change_orders_platform.sql
```

It adds `properties`, `engagement_properties`, `change_orders`, the
`work_order_revised` view, and the console's `superadmins`, `activity`,
`subscription_events`, `invoices` and `platform_daily_stats`, plus
`jobs.property_id`. Every statement is guarded except that one `ALTER`,
which SQLite cannot make conditional — on a second run it stops with
`duplicate column name: property_id`, which is safe to ignore. Both paths
were checked against real SQLite: fresh `schema.sql` builds 20 tables and
the view, and the migration takes a pre-migration database from 12 tables
to the same 20.

### What is wired to the database

**Properties are fully wired.** `GET/POST/PATCH/DELETE /api/properties`,
plus `PUT /api/subs/:companyId/properties` for the per-account vendor
scoping (it lives in a join table, not a column, so `patchSub` routes
`propertyIds` to it rather than putting it in the generic PATCH body).
`hydrateAccount` loads properties on sign-in. Verified in Chromium against
the local worker and D1: a property added through the UI survives a full
page reload because it comes back from the database.

**Change orders are fully wired.** `GET/POST /api/change-orders`,
`POST /api/change-orders/:id/respond`, and
`GET /api/work-orders/:id/revised`. The revised value is derived by the
`work_order_revised` view and never stored on the work order. Guardrails,
each exercised against the running worker:

| Attempt | Result |
|---|---|
| Change order against a work order that was never accepted | 409, reissue instead |
| The side that raised it tries to accept it | 403 |
| A contractor from another company answers it | 403 |
| Answering one that is already resolved | 409 |
| A status other than accepted/declined | 400 |

Sequence numbers are per work order, `origin` is derived from the caller's
role rather than trusted from the body, and the arithmetic was checked:
$12,400 + $1,800 − $400 = $13,800.

Account isolation was tested directly, not assumed: a second account sees
none of the first account's properties, its writes against a foreign
property id affect zero rows, and a foreign property id passed to the
vendor-scoping endpoint is dropped rather than trusted.

### The platform console

It now has a backend, and the gate is the point of it.

**Nothing reaches a platform route without real staff credentials.** Every
`/api/platform/*` handler calls the same check first. With no Supabase
configured it returns 501 and the console cannot be signed into by anyone —
verified, including that the tenant dev-stub headers do not open it. With
Supabase configured it verifies the session and then re-reads the
`superadmins` table on every request: a valid customer login gets 403, an
absent or bogus token gets 401.

**Role enforcement is server-side, not cosmetic.** A standard staff user
gets 403 from the revenue and health routes, and the account list and the
console bootstrap simply omit the money — `mrrCents` is not in the payload,
and subscription history comes back empty. Verified with a real subscription
event present, so the empty array means withheld rather than absent.

**Impersonation is audited before the session is handed over.** The endpoint
re-checks the flag, picks the account's admin server-side, and writes both an
`activity` row and an `events` row in one batch. The banner in the interface
is not the record. A standard user is refused.

**The activity stream is real.** The app writes a rendered sentence at the
moment each thing happens — account created, subcontractor added, job created
and completed, work order issued, document verified or rejected, property
added, change order raised and answered, callback raised. The console reads
them back attributed to the user who acted. A logging failure never fails the
request that caused it.

The console's screens render this data through one `/api/platform/bootstrap`
call, in the shapes the screens already derive from. That call returns the
whole platform, which is fine now and will not be: past a few thousand
accounts it needs pagination, and the per-account rollups belong in
`platform_daily_stats` rather than being recomputed in the browser.

### Staff sign-in: Google Workspace

Staff sign in with Google, and the API enforces it. A password on the same
address is refused with `sso_required`, so suspending someone in Workspace
actually locks them out of the console rather than leaving a second door open.

`amr` in the access token is what gets checked, because it is scoped to the
session. `app_metadata.providers` is scoped to the account and only says a
Google identity is linked, not that this session used it; it is a fallback for
tokens issued without `amr`.

The Workspace domain is checked server-side too. The `hd` parameter sent to
Google is an account-chooser hint and nothing more — anyone with any Google
account can complete the flow, so `STAFF_EMAIL_DOMAIN` is what actually holds.

### Cloudflare Access is the way in

Access sits in front of `admin.subsub.work` and refuses to pass a request
through until Google Workspace has vouched for the person. It then adds a
signed `Cf-Access-Jwt-Assertion` header naming them, which `access.js`
verifies against Cloudflare's published keys.

This is better than the Supabase OAuth route below in the way that matters:
an unauthenticated stranger never receives the console at all, rather than
receiving it and being turned away after it loads. There is also no OAuth
client to register, no redirect URIs and no client secret in the Worker.

The header is verified, never merely read. It is only meaningful because
Access signed it — the same header on a request to a hostname Access does not
cover is just a claim, which is why the audience and issuer are checked too:
every Access application in an account is signed by the same keys, so without
the `aud` check a token minted for any other app would pass.

**Access covers the hostname, not the account.** So `requireStaff` still reads
`superadmins` and still enforces `STAFF_EMAIL_DOMAIN`. Being let through the
door is not the same as being staff, and an Access policy can be widened by
mistake.

**Setting it up:**

1. **Zero Trust → Access → Applications** — add a self-hosted application for
   `admin.subsub.work`, covering all paths. Identity provider: Google
   Workspace. Policy: allow emails ending `@subsub.work`.
2. **Nothing to route.** `worker-admin.js` forwards `/api/*` to the API over
   a service binding, so everything the console does happens on
   `admin.subsub.work` and Access covers all of it.
3. **Worker variables**: `ACCESS_TEAM_DOMAIN` (e.g. `subsub.cloudflareaccess.com`)
   and `ACCESS_AUD` (the application's Audience tag, shown on its overview).
4. **Console deploy**: its own Worker, from this same repository.

   Cloudflare Pages allows one project per repository and `subsub-app` has
   it, so the console is a Worker with static assets instead — which is where
   Cloudflare is pointing new projects anyway.

   | Setting | Value |
   |---|---|
   | Root directory | `app` |
   | Build command | `npm run build` |
   | Deploy command | `npx wrangler deploy -c wrangler.admin.toml` |
   | Variable | `VITE_BUILD` = `platform` |

   `VITE_API_BASE` is deliberately left unset: `worker-admin.js` forwards
   `/api/*` to the API over a service binding, so the console calls its own
   origin and the default relative base is correct. That is what keeps the
   Access assertion attached — a cross-origin call to `api.subsub.work` would
   arrive anonymous however tightly Access guarded the page.

Then add the first staff row by hand, as below. `STAFF_ALLOW_PASSWORD` should
stay unset: Access removes the reason for it.

### Supabase OAuth (the older route)

Kept for a console reached at a hostname Access does not cover — local
development, mainly.

1. **Google Cloud Console** — create an OAuth 2.0 Client ID (Web application)
   in the project for your Workspace. Authorised redirect URI:
   `https://<your-project>.supabase.co/auth/v1/callback`.
2. **Supabase** — Authentication → Providers → Google, on, with that client ID
   and secret. Add the console's own origin to the allowed redirect URLs.
3. **Worker variables** (Cloudflare dashboard, or `wrangler secret put`):

   | Variable | Value |
   |---|---|
   | `STAFF_EMAIL_DOMAIN` | `subsub.work` |
   | `STAFF_ALLOW_PASSWORD` | unset, except for break-glass |

4. **Console build**: `VITE_BUILD=platform VITE_STAFF_EMAIL_DOMAIN=subsub.work npm run build`.
5. **Add the first staff row by hand**, since nothing in the interface can
   create one:

   ```sql
   INSERT INTO users (id, name, email) VALUES ('sa1', 'Your Name', 'you@subsub.work');
   INSERT INTO superadmins (user_id, role, finance, impersonate)
     VALUES ('sa1', 'superadmin', 1, 1);
   ```

   The `users` row is matched on `auth_id` or, on first sign-in, on email.

**Break-glass.** Setting `STAFF_ALLOW_PASSWORD=1` re-enables password sign-in
for staff. It does not relax the domain check. Use it only if Google is down
and you need in, and unset it afterwards. The console's password form is
hidden behind a toggle for exactly this and nothing else.

**Still to do before `admin.subsub.work` exists:**

- **Consider a second factor.** Google carries it if Workspace enforces 2FA,
  which is worth confirming rather than assuming.
- **Revenue is derived from plan state, not from money collected.** Stripe
  has to be the source of truth: mirror invoices from webhooks, reconcile
  nightly, alert on drift. Comped, dunning and failed payments all break a
  figure derived from the accounts table.
- **`platform_daily_stats` is never populated.** Nothing writes the nightly
  rollup yet, so MRR over time is computed live.

## Account type

An account is now one of four kinds, matching the four audiences the marketing
site sells to:

| Type | Properties tab |
|---|---|
| General contractor | no |
| Property manager | yes |
| Building owner | yes |
| Commercial portfolio manager | yes |

The distinction is the building list. A general contractor subs out trades job
by job and has no standing portfolio, so Properties is theirs to not have. The
other three keep a portfolio and scope vendors to specific buildings.

`accounts.kind` defaults to `general_contractor`, so every existing account
keeps exactly the shape it had. An admin changes it under **My account →
Company → Account type**; the server validates the value and returns 400
`invalid_kind` for anything else, and only an admin may set it.

Gating is two checks, not one: `ROLES[role].can` says what a user may do, and
the account type says what the account has at all. `can("properties")` requires
both. If an account changes type while someone is sitting on the Properties
tab, they fall back to the dashboard rather than seeing an empty page.

The header badge now reads the account type with the role after it —
"General contractor (admin)", "Commercial portfolio manager (admin)" — rather
than a bare "Admin". A subcontractor signing into someone else's portal still
reads "Contractor", because the account type is the hiring side's identity,
not theirs.

Vendors attach to a property from either direction: from the vendor's own
record ("Properties they cover" on the contractor form), or from the building
via **Assign vendors** on the property card. Both write the same
`engagement_properties` rows. A vendor scoped to nothing is available at every
property on the account, which is how a general contractor's vendors behave by
default.

Apply `worker/migrations/003_account_kind.sql` to a live database. SQLite
cannot make `ADD COLUMN` conditional, so a second run stops with
`duplicate column name: kind`, which is safe to ignore.

## Signing in

Both sign-in screens are real and only real. There is no demo account list on
either, in any build: the customer app takes an email and password through
Supabase, and the console takes Google Workspace.

`POST /api/auth/dev-login` still exists for local work, where it takes an email
and returns that user's identity with no credential. **It refuses with 404
whenever `SUPABASE_URL` and `SUPABASE_ANON_KEY` are set**, which is every
deployed environment. Without that guard it would be an unauthenticated
disclosure endpoint: hand it a guessed address and it returns the person's
name, phone, and every account they belong to with its plan and subdomain.

**This means local development needs Supabase env vars**, the same as
production. Put them in `app/.env` for the frontend and `app/.dev.vars` for the
worker; both are gitignored. Running without them leaves you with a sign-in
form that has nothing to talk to, which is the correct behavior rather than a
gap to fill with a shortcut.

### Continue with Google, on a customer's sign-in page

The button is on every customer sign-in screen, branded ones included, above
the email box. It is dark until Google is turned on in Supabase — pressing it
before that returns an error from Supabase rather than doing nothing, but
nobody should see it in that state, so turn it on before the first customer
does.

1. **Google Cloud Console → APIs & Services → Credentials** — an OAuth 2.0
   Client ID, type *Web application*. Its one authorised redirect URI is
   Supabase's, not ours: `https://<project>.supabase.co/auth/v1/callback`.
2. **Supabase → Authentication → Providers → Google** — on, with that client
   ID and secret.
3. **Supabase → Authentication → URL Configuration → Redirect URLs** — add
   both `https://app.subsub.work/**` **and** `https://*.subsub.work/**`.

**Step 3 is the one that breaks quietly.** The button asks to come back to
`window.location.origin`, which on a customer's own address is
`https://theircompany.subsub.work`. If that is not in the allowed list,
Supabase does not refuse — it sends them to the project's Site URL instead.
So somebody signs in at their own company's page and lands on SubSub's
generic one, which looks like the button sending people to the wrong company
rather than like a missing line in a settings box. The wildcard covers every
customer, including ones who do not exist yet.

**The consent screen has a lead time.** While the OAuth app is unverified,
Google caps it at 100 users and shows a warning before the account chooser.
Verification wants a privacy policy URL, a terms URL, a logo and a verified
domain, and takes days to weeks. Start it before it is needed.

**Two cases worth knowing about.** Somebody who already has a password on the
same address is the same person to SubSub either way:
`resolveSupabaseUser()` matches the internal `users` row on `auth_id` and,
failing that, on email — so whichever identity Supabase hands over lands on
the same row. And somebody invited at an address that is not their Google
one gets a session with no membership; the sign-in screen says so, says that
an invite to a different address will not recognise this one, and offers to
forget the Google account rather than leaving them stuck with a refusal that
survives every reload.

Held by `npm run test:google`, including the part that has no button in it:
a provider sign-in comes back with a session and no form submit, so the app
has to notice it on load. Without that it draws the sign-in screen at
somebody who has just authenticated.

## Adding somebody who works at the account

Users → Add sends them an invite. They choose a password from the link and
they are in, in the seat the admin already gave them.

Before this it wrote a `users` row and a membership and **sent nothing at
all** — no email, no link. Whoever was added found out by being told, and got
in by noticing "Already invited? Create your password" on the sign-in screen
and working out that it meant them. The roster looked identical whether
somebody had signed in a hundred times or had never heard of SubSub, so
nobody could see it happening either.

The roster now says. Anybody without a login carries a line — *"Hasn't set a
password yet · invite sent 3 days ago"* — with **Send again** next to it.
Somebody who already has a login is never offered one: a "choose a password"
mail to a person who has one is a phishing lesson in reverse.

The invite carries no role. The membership is written when the admin adds
them, so the link proves an address and sets a password and cannot widen
anything. Migration **028** adds the table; without it people can still be
added and the Worker logs that no invite was sent rather than refusing.

### "Already invited? Create your password" is gone

That line used to sit at the bottom of every sign-in screen in the product,
and it was not a convenience — it was the only way in for anybody an account
had added, because none of the three invites sent anything. A line that reads
like an edge case was carrying the whole flow.

All three send now — tenants, subcontractors, and the people who work at the
account — and every one of them ends on a screen that takes a password. The
public application form takes one too, which is the last case that used to
need it: applying already creates that person a contractor membership, so
choosing a password there grants nothing the application did not.

Somebody whose invite expired asks whoever added them for another. That is a
person, not a link on a sign-in box explaining a flow to somebody who is
looking at a sign-in box.

## Inviting a subcontractor

The account types in an email address and SubSub sends the invite. The link
opens the application form part-filled — company, contact and address as the
account typed them — and the last step takes a password, so the contractor is
in as soon as they finish.

Before this it was a link the account copied out of SubSub and pasted into
their own mail client, which put the step that decides whether anybody is
invited outside the product: nothing here knew who a link was for, whether it
was ever sent, or whether it bounced. And the old flow created the company,
the engagement and a `users` row without ever creating a **login** — the
contractor had to notice "Already invited? Create your password" on the
sign-in screen and work out that it meant them.

**Both routes go.** Email and text, from the same invite, and either link
finishes it — whichever they pick up first. Email is not how this trade
answers: a roofer reads a text on a ladder and opens email on Sunday night,
if at all. Each route is reported separately, because an invite that claims
to have gone by text when texting is not switched on is a message somebody
waits on. Until SMS credentials exist the panel says exactly that, and does
not blame the number.

**A link with no address still works.** Leave the email blank and you get one
to hand over yourself, in a text thread or in person. `sent_at` stays null for
those, and the list says "Link to send yourself" rather than claiming a
message went out — created and sent are different facts, and an account that
confuses them waits on a contractor who was never asked.

**A failed send is said out loud.** The invite still exists and the link still
works, so the panel says the email did not go and copies the link for you.

Needs `RESEND_API_KEY` and `MAIL_FROM`, the same as every other message.
Migration **027** stores who an invite went to; without it a link can still be
made, and the Worker logs that the recipient was not recorded rather than
refusing to invite anybody.

`npm run test:subinvite` drives the whole journey, including the one that was
a live bug rather than a missing feature: "Submit application" used to set the
thank-you screen without waiting for the server, so a spent link or a refusal
showed "Thanks — we've got it" just the same.

## Book a demo (Cal)

The form at `book-a-demo.html` used to show eight fixed hours on every
weekday, take the details, and print "You're booked. We've sent a calendar
invite to you@company.com." It sent nothing — no request, no form action, not
even a mailto. Everybody who used it went away believing a meeting existed.

It now reads real availability and creates a real booking, and the
confirmation screen appears if and only if the server said one was made.

**Set up:**

1. **Cal.com** — an event type for the demo (30 minutes), with your calendar
   connected so availability is real, and a video location (Cal Video or
   Google Meet) so the invite carries a link.
2. **Settings → Developer → API keys** — create one.
3. **Worker variables** on `subsub-api`:

   | Variable | Value |
   |---|---|
   | `CAL_API_KEY` | the key (a **secret**, not plain text) |
   | `CAL_EVENT_TYPE_ID` | the event type's numeric id, from its URL |

4. **`window.SUBSUB_API` in `book-a-demo.html`** must be the API Worker's own
   address. The marketing site is static and has no build step, so that line
   is the only place it is written down. Get it wrong and the page says it
   cannot load times and offers an email address — which is the right failure,
   but it is still a failure.

**Unset is a supported state.** With no key the endpoints answer
`503 not_configured`, the page says booking is not switched on yet and gives
an email address, and no time is ever offered. That matters more than it
sounds: "no times available" would be the same lie as before in a quieter
voice, and would send a prospect away thinking SubSub has no availability for
six weeks.

**The API version is assumed, not verified.** `worker/demo.js` was written
from Cal's documentation rather than against a live key — there was none at
the time, and that sandbox could not reach cal.com. Two things are therefore
believed rather than known: the `cal-api-version` each endpoint wants, and the
shape of the slots payload (the parser accepts both documented arrangements,
and logs anything else in full rather than guessing).

So confirm it once, when the key exists:

```
CAL_API_KEY=cal_live_... CAL_EVENT_TYPE_ID=123 npm run cal:check
```

It makes one real slots request, prints what arrived against what `demo.js`
expects, and says which line to change if they differ. Add
`-- --book you@example.com` to check the booking half too — that creates a
real booking, so cancel it afterwards. The key is read from the environment
and never printed.

`npm run test:bookdemo` drives the real page against a Cal stand-in, including
the two failures that matter: a slot taken while the form was being filled in,
and no key configured at all. Neither may reach the confirmation screen.

## Email (Resend)

The compliance loop depends on telling a subcontractor to upload something.
That is now a real send rather than a screen that said "Notification sent" and
did nothing.

**The server composes every message.** The alternative, a client posting a body
for the server to relay, would let any signed-in user send arbitrary text from
your sending domain. It also keeps the admin's preview honest: the preview
endpoint and the send endpoint call the same template function, so the text
that was reviewed is the text that goes out. `worker/mail.js` owns the
templates; the client no longer has a copy.

**Three messages exist:**

| Trigger | To | Kind |
|---|---|---|
| Admin presses "Request docs" | the subcontractor | `doc_request` |
| A work order is issued | the subcontractor | `wo_issued` |
| Someone applies through the public form | the applicant | `application_received` |

The two automatic ones never fail their action. A work order is still issued
and an application still succeeds if the mail fails; the failure is recorded
instead.

**Every attempt is logged**, successes and failures, in `email_log`: recipient,
kind, subject, status, Resend's id, and the error. "Did they get it?" is the
first thing support asks, and a send that quietly failed is worse than one that
visibly did. Bodies are not stored — they are reconstructible from the
template, and keeping a copy of every notice means keeping personal data with
no expiry story.

**Setup:**

1. Verify your sending domain in Resend and create an API key.
2. Set two Worker variables:

   | Variable | Value |
   |---|---|
   | `RESEND_API_KEY` | `re_...`, via `wrangler secret put` |
   | `MAIL_FROM` | `SubSub <notifications@subsub.work>` |

3. Apply `worker/migrations/005_email_log.sql`.

With either variable unset, the preview says so, the send button is disabled,
and the API returns `mail_not_configured` rather than pretending. Verified.

`RESEND_API_BASE` overrides the endpoint and exists so this path can be tested
against a local stand-in. Leave it unset in production.

**SMS is still not wired.** The text-message option composes a preview and
sends nothing, and the interface now says so instead of claiming it sent.
Twilio is the intended provider.

## Where the app finds the API

Locally the app fetches `/api/...` relatively and Vite proxies it to the
worker. In production the app is served by Pages and the API is a Worker on its
own hostname, so a relative path would hit the static site and 404.

**Every deployed build must set `VITE_API_BASE`**, for example
`https://api.subsub.work/api`. Unset, it falls back to `/api`, which is correct
for local development and wrong everywhere else. The worker already sends CORS
headers for `/api/*`, and identity travels in an Authorization header rather
than a cookie, so a cross-origin base needs nothing further.

This covers logo images too, which are `<img src>` values pointing at
`/api/logo/:accountId` and would have 404'd the same way.
