# Deploying SubSub — running notes

`DEPLOYMENT.pdf` beside this file is the original write-up of the identity
model, licence verification and the phased rollout. It is a PDF and cannot be
kept current in a commit, so what changes per release lives here instead,
newest first.

The standing rules, from `CLAUDE.md`:

- **Migrations are pasted by hand** in the D1 console, in order, from
  `worker/migrations/`. `npm run paste <n>` prints one comment-stripped.
- **`npm run paste check`** prints `CHECK.sql` as two pasteable statements.
  Statement 1 answers *did I run that one?*, statement 2 lists invariants that
  must read zero. Every row should say `ok`; the problems sort to the top.
- **Four things deploy, each a button in the Actions tab**: `deploy-api.yml`
  (the `subsub-api` Worker), `deploy-admin.yml` (the console), `deploy-app.yml`
  (the `subsub-app` Pages project — `app.subsub.work` and every customer
  subdomain) and `deploy-site.yml` (subsub.work). All four run on push.

---

## 074 — "Sent via SubSub" on every work order, and subs claiming a free login

Every work order a hiring account sends now carries a footer reading
**Sent via SubSub. SubSub is free for subcontractors, forever.** and a link,
`https://app.subsub.work/claim/<token>`. It is on the email, the text message,
the work order drawn in the app and its downloaded copy. The link opens a
mobile page showing that work order and a free login by mobile number and a
texted code. The account that sent it is credited with bringing the sub in.

The footer is **not** a setting. No plan, flag or column removes it — a Scale
account's branding changes colours, never this line. `test:claim` pins that.

### 1. Paste migration 074

`worker/migrations/074_wo_claims.sql`, one paste. Two tables, no `ALTER TABLE`,
so it is safe to paste twice:

| Table | One row per | What it holds |
|---|---|---|
| `wo_claim_links` | work order | The claim token (32 random bytes, hex), the sending `account_id` and the `company_id` it went to — stamped at issue. `first_opened_at`, `last_opened_at`, `open_count`; `claimed_at` and `claimed_user_id` once used. A row per work order is what **"work orders sent"** counts. |
| `sub_attributions` | company | Which account brought this sub onto SubSub, from which work order and token, and the login made. The **first claim wins** and is never overwritten; a company that already had a login anywhere is never credited. |

Then run `CHECK.sql`. Three new rows: `m074_wo_claim_links` and
`m074_sub_attributions` (did-I-run-it) and `m074_inv_claim_unattributed`, an
invariant that must read 0 — a claimed link whose company nobody was credited
with.

Until 074 is pasted nothing breaks: work orders go out with the footer and no
link, and the claim routes and console panel answer `migration_needed`
naming `074_wo_claims`.

### 2. Put the code in Supabase's emails (the default way in)

The claim page signs people in with an **emailed code** through Supabase's own
email auth — the Worker calls `/auth/v1/otp` and `/auth/v1/verify` with the
**anon** key, and no service-role key is involved. Email needs no SMS
provider, which is why it is the default.

Supabase's stock emails carry a **link**, not a code, so add the code to them:

1. **Authentication → Emails → Templates → Magic Link**: add a line such as
   `Your SubSub code: {{ .Token }}` above the link. Keep the link.
2. Do the same in **Confirm signup**. A brand-new address gets that template
   the first time, an existing one gets Magic Link.

Supabase's built-in sender is heavily rate-limited (a handful an hour). Before
real volume, set **Authentication → Emails → SMTP Settings** to a real sender
(Resend, which the app already uses, works).

Until Supabase answers, the page says claiming is not open yet and offers the
account's own sign-in link (`email_login_unavailable`, a 501).

### 2b. Later: a texted code as well (needs an SMS provider)

`GET /api/claim/:token` reads Supabase's `/auth/v1/settings` and offers
**Text me a code instead** only when `external.phone` is on — so nothing
appears until it can actually send. To turn it on:

1. **Authentication → Sign In / Providers → Phone**: enable it.
2. Choose an SMS provider and enter that provider's credentials there.
   Supabase sends the code; the Worker never sees it.

An unreadable settings answer offers email alone, never a guess at phone. If a
texted code is refused anyway (`phone_login_unavailable`), the page falls back
to email.

### 3. Nothing to configure for the link itself

`/claim/<token>` is a path on `app.subsub.work`. The `subsub-app` Pages
project has no `404.html`, so Pages serves `index.html` for any path it holds
no file for, and the app reads the token off the path. No `_redirects` entry is
needed.

### What the claim does, and refuses

- **The code goes to the address (or mobile) on record.** When the sending
  account holds an email for the company, only that address can claim by email,
  and the same for a mobile by text — a forwarded link is not enough. The check
  that matters is on what Supabase *verified*, not what was typed. With nothing
  on record, any real address (or US mobile) may claim.
- **A company already on SubSub** (a contractor seat with a login anywhere, or
  an account's own company row) is a sign-in, not a recruitment: the page sends
  them to sign in and nothing is credited.
- **What is made**: a `users` row (by email, the existing row holding that
  address with no login, if any; else the company's unclaimed seat holder;
  else new, named for the contact, on the address they proved or the
  company's, when nobody else holds it), and a **contractor seat** on the account that sent the
  work order, so the work order they just read is the first thing they can
  answer. A contractor seat is free on every plan.
- **Rate limits**: 120 page opens an hour per address, 20 codes an hour per
  address and 5 per link, 10 verify attempts an hour per link.

### Where to see it

The staff console, on each account's window: **Subs brought in** — work orders
sent, links opened (and the rate), profiles claimed (and the rate), and the subs
by name with the work order that brought each in. `GET /api/platform/attribution`
answers the same for every account at once.

### Not verified here

- A live Supabase round trip, by email or by phone. The request shapes are
  Supabase's documented `otp`, `verify` and `settings` bodies and the suite
  asserts them at `fetch`; the first real code to a real inbox is the real test.
- There is no PDF of a work order — it is drawn in the app and downloaded as
  text. The footer is on both.

### Tests

`npm run test:claim` (server, 104) and `npm run test:claimui` (the page at
390px, 43). `test:woaccess` and `test:feetermsui` cover the work-order footer
and the console panel.
