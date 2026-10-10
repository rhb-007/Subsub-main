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

## 077 — The Sub Passport: a free public page a sub hands out

Every company that can be hired (a subcontractor account, a general contractor,
and every contractor seat's company) now has a **Passport** at
`app.subsub.work/p/<name>-<5 random characters>`: the business name, trades,
where they work, years in business, photos of their work, the license and its
check, the insurer and when the certificate runs out, and whether a W-9 is on
file (**yes or no only**). The sub edits it under **Account → Passport** (a
contractor seat: **Passport** in its own menu) and nothing is public until they
press **Publish**.

- **The address can be read but not guessed.** The random suffix means nobody
  can find a sub by typing names, and every page, every API reply and every
  photo says `noindex`, so search engines do not turn Passports into a
  directory.
- **"SubSub Verified" claims only what was checked**, and the line under it
  says what. The license counts when Washington L&I says ACTIVE (the one
  register SubSub reads), **or** when the state issues no contractor license
  for that work (Texas roofing yes; plumbing, electrical and HVAC are
  state-licensed even there, so not). The insurance counts when a certificate
  is on file with an expiry date that has not passed. A number typed in that
  SubSub cannot check never earns it, and neither does a failed check.
- **The certificate and the W-9 open only with the sub's yes.** A signed-in
  admin or project manager of a hiring account presses *Ask to see the files*;
  the sub is emailed and answers in one press; approved, those two files open
  for that account only, the current version only, until the sub stops sharing.
  The bond and the agreement are not part of it.
- **"Manage your whole sub network like this"** on the page goes to
  `subsub.work/gc?ref=<the sub's code>&via=passport`, so a GC who signs up is
  credited to the sub through 075's referrals, on the `passport` channel.
- **Reminders:** the certificate's emails now go at **30, 14, 7, 3 and 0** days
  (7 is new). The license gets its own at **30, 7 and 0** days, off the state
  register's own date -- so today, Washington licenses only.

### 1. Paste migration 077

`npm run paste 077` prints it. It is four `CREATE TABLE IF NOT EXISTS` and
three indexes, no `ALTER TABLE`, so it is one paste and safe to run twice.

It differs from the schema shown before building in one place: there is **no
`passport_referrals` table**. 075's referral codes already record who referred
whom, with `passport` as one of their channels, and a second table holding the
same fact would be the one that went stale.

### 2. Run CHECK.sql

`npm run paste check`. Statement 1 gains five rows (`m077_passports`,
`m077_passport_photos`, `m077_passport_access`, `m077_license_reminders`,
`m077_access_live_unique`), statement 2 two invariants that must read 0:
`m077_inv_guessable_slug` (a Passport address with no random suffix) and
`m077_inv_decided_undated` (an answered request with no date).

### 3. Nothing to configure

No new settings. The license reminders run in the existing nightly cron
(`license-reminders`), and by hand at `GET /api/cron/license-reminders` with the
cron secret.

### Not verified here

- A live Passport photo upload into R2 and back out (the suite stubs the
  bucket).
- How a real iPhone's share sheet draws the Share button.

### Tests

`npm run test:passport` (the rules and every route, 104) and
`npm run test:passportui` (the public page at phone width, asking for the
files, and the sub's own screen, 33).

---

## 075 — Referrals: a code for every sub and GC, and what referring earns

Every subcontractor company and every hiring account (general contractor,
property manager, building owner, portfolio manager) now has a **referral code
and link** (`subsub.work/gc?ref=CODE`). Signups are credited to whoever brought
them in, **last touch wins**, by link, typed code, work-order claim or (once it
exists) a Passport view.

- **A sub refers a GC who starts paying:** the sub earns **$100**, recorded in a
  rewards ledger as *pending*, and the **Preferred Sub** badge on every roster
  they are on. A person approves and pays the $100 by hand in the console.
- **A GC refers a GC:** when the referred account starts paying, **both** get a
  month of Scale free, applied automatically as a Stripe customer-balance
  credit on their next invoice.

"Starts paying" means the referred account's **first paid invoice with money
in it**. Signing up earns nothing, so twenty free accounts from one kitchen
table earn nothing either.

### 1. Paste migration 075

`worker/migrations/075_referrals.sql`, one paste. Five tables, no `ALTER TABLE`,
safe to paste twice:

| Table | One row per | What it holds |
|---|---|---|
| `referral_codes` | sub company, or hiring account | The 8-character code. Minted the first time somebody opens their referral screen. |
| `referral_touches` | arrival | A link opened, a code typed, a claim, a Passport view. A count, nothing about the visitor. |
| `referral_attributions` | signed-up account (or claimed company) | Which code brought them in, by which channel. Written once, at signup. |
| `referral_rewards` | reward | The ledger: `sub_cash` ($100) pending → approved → paid, or `gc_credit` (a month) pending → applied. Either can be voided with a reason. Unique per referred account, kind and side, so a webhook delivered twice cannot pay twice. |
| `referral_invites` | invitation sent | For the daily limit (25) and to stop the same address being emailed twice in 30 days. Emails keep the address; texts keep nothing, because they go from the sub's own phone. |

Then run `CHECK.sql`. New rows: five did-I-run-it checks (`m075_…`) and three
invariants that must read 0:

- `m075_inv_reward_unattributed`: a reward whose account was not brought in on that code.
- `m075_inv_paid_unreferenced`: a $100 marked paid with no reference saying how.
- `m075_inv_credit_unrecorded`: a month-free marked applied with no Stripe transaction behind it.

Until 075 is pasted nothing breaks. Signups go through with no referrer
recorded, the paid-invoice webhook earns nothing (the nightly sweep catches up
once it is pasted), and the referral screens say which migration is missing.

### 2. Stripe: nothing new to configure

The month-free credit uses the existing `STRIPE_SECRET_KEY` and is triggered by
the existing webhook's `invoice.paid` event, which the endpoint already
receives. It is a **negative customer-balance transaction**
(`POST /v1/customers/:id/balance_transactions`), which Stripe takes off the
next invoice on either billing cycle. It is not a coupon and it does not
expire.

- A month is the account's own cycle: $99 monthly, $82.50 on annual.
- An account with no Stripe customer yet (still on Basic) keeps its credit
  **pending**. The nightly sweep applies it the night after they subscribe, and
  their referral screen says it is waiting.
- `GET /api/cron/referrals` (with the cron secret) runs that sweep by hand.

### 3. Paying a sub's $100 (manual)

Console → **Referrals** (any staff member can see it; moving money needs
**finance** access):

1. A pending $100 shows the sub's company, their email and the account they
   brought in. Check it is not a self-referral: the same person, the same
   address or an account that paid one invoice and cancelled.
2. **Approve**, or **Void** with a reason.
3. Pay them however you like (check, transfer), then **Mark paid** and type the
   reference. It refuses without one.

Paid money is never voided from here. Undoing a payment is a refund, not a
status.

The same screen shows **new GCs acquired per existing GC**, by week and by
metro, split into referred-by-a-GC and referred-by-a-sub. A metro is the town
and state on the account's company record (or its commonest building), not a
census metro area. Accounts with neither read *Unknown*.

### Where people find it

- **Subs** (a contractor seat, or a subcontractor account's own team): **Get your
  GCs on SubSub** in the nav. It shows the code, the link and a QR code, plus a
  pre-written invite. Emails are sent by SubSub under the sub's name, with
  their address to reply to. Texts open the sub's own messages app, so SubSub
  never texts anybody. **Pick from contacts** appears only where the browser
  supports it (Chrome on Android); Safari on an iPad does not, and the box
  takes typed or pasted numbers and addresses instead.
- **Hiring accounts:** Account → **Refer a GC**, admins only.
- **The badge:** *Preferred Sub* on the roster card, from the ledger, so voiding
  the reward takes it away.
- **Signup:** `get-started.html` sends the referral cookie and has an optional
  **Referral code** box (see the site README).

### Not verified here

- A live Stripe customer-balance credit. The request is Stripe's documented
  shape and the suite asserts it at `fetch`; the first real referral is the
  real test. Check the referred account's next invoice shows the credit.

### Tests

`npm run test:referral` (server, 85), `npm run test:referralui` (the sub's and
the GC's screens, 22) and `npm run test:referralconsole` (the ledger, 16).

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
