# Easy Pay

How a general contractor pays a subcontractor through SubSub, what has to
exist before that can happen, and which parts are product decisions rather
than engineering.

Nothing here is built. This is the map, written against the code that is
already in the repository so the plan and the ledger agree from the start.

---

## 1. Most of this already exists, and that is the point

The ledger was written for a processor that does not exist yet. Reading it
back, the shape is already right:

- **`wo_milestones`** is two-party and append-only. The subcontractor marks a
  milestone `reached`; an admin or PM `verified`s it; `same_person` refuses
  when they are the same human. Nothing is owed until both have happened.
- **`POST /api/milestones/:id/verify`** is what creates money owed. It writes
  one **`wo_releases`** row with `gross_cents`, `retainage_cents`,
  `fee_bps`/`fee_cents` and `net_cents`, all computed by
  `releaseAmounts()` in `app/shared/money.js` — cumulatively, so three
  milestones of $333.33 hold exactly 5% of $1,000 and not a cent less.
- **`ux_wo_release_milestone`** makes paying the same milestone twice
  impossible as a constraint rather than as a check somebody remembers.
- **`POST /api/releases/:id/settle`** is gated on the lien waiver chain and
  refuses with `waiver_outstanding`. The override exists, needs a written
  reason, and is recorded as its own event — so "we always override it" is a
  visible fact.
- **`method` and `reference`** are the seam. Today `manual` and a cheque
  number typed in. A processor becomes another value in `method` and a
  transfer id in `reference`, **and nothing else about that table changes.**
- **`fee_bps` is stamped onto each release** at the moment it is made, so
  changing the rate next year cannot rewrite what was charged last year.
  `PLATFORM_FEE_BPS` is `0` (`app/worker/index.js:173`), which is the point
  of having had the column since the first row.

So the question "what do we need to implement Easy Pay" is much smaller than
it looks. **The accounting is done. What does not exist is money.**

## 2. The one thing missing: there is no funded side

Every number above describes what is *owed*. Nothing anywhere describes what
has been *paid in*. There is no balance, no funded pot, no record of the
general contractor putting money anywhere, and no payout rail.

`status = 'paid'` today means *a person pressed a button saying they sent a
cheque*. That is a useful record and it is not a payment.

Everything below is about closing that gap.

---

## 3. The legal shape, which decides the architecture

This is the decision that everything else hangs off, and it has to be made
before a line is written.

**Holding somebody else's money and passing it on is money transmission.** In
the US that is licensed state by state — roughly fifty jurisdictions, each
with its own application, surety bond, minimum net worth, audits and exam
cycle — plus registration as an MSB with FinCEN. It is a multi-year,
multi-million-dollar undertaking and it is not what SubSub is.

There are three ways through it.

### (a) Own trust account — no

Open a trust or escrow account, take the GC's money into it, pay subs out of
it. This is the thing the phrase "goes into a trust" describes, and it is the
option to rule out first, because it is the one that sounds simplest and is
the one that requires the licences. Do not build this.

### (b) A licensed partner holds the funds — yes

Use a payments platform whose own licences cover the flow, so **SubSub never
takes possession of customer money** — a claim §10.3 qualifies once escrow is
actually required, and the qualification is the thing to take to counsel. The GC pays into an account the partner
holds in the GC's or the subcontractor's name; SubSub sends instructions; the
partner moves the money and is the party regulated for doing so.

Candidates, all of which support platform/marketplace flows with sub-accounts
and held balances:

| Partner | Shape | Notes |
|---|---|---|
| **Stripe Connect** | Custom/Express connected accounts, held balances, `transfer_group` | Best documented, fastest to a working demo, has instant payouts to debit cards built in. Strongest default. |
| **Dwolla** | ACH-first, balance accounts | Cheaper per-transaction at volume, no cards, less hand-holding. |
| **Moov / Increase / Unit** | Programmable accounts, RTP/FedNow | More control, more compliance work on our side. |
| **Adyen for Platforms** | Enterprise | Overkill now. |

**Recommendation: Stripe Connect.** Not because it is cheapest — it is not —
but because the KYC/KYB onboarding for every subcontractor is the part that
actually kills this kind of feature, and it is the part Stripe does best.
Every sub has to be identity-verified before they can be paid, and that is a
flow with documents, rejections and retries that somebody has to build and
support either way.

### (c) Agent-of-payee — a legal opinion, not a setting

Some states exempt a party collecting money **as the agent of the payee**
from money transmission. It is a real route and some construction payment
companies rely on it. It is also a state-by-state analysis that needs a
written opinion from counsel, and it does not remove the need for a payments
partner to actually move the money. Treat it as something that might reduce
partner cost later, never as the thing that lets us skip (b).

### One thing that cuts our way

In several states a contractor's funds for work already performed are
**already statutory trust funds** — New York's Lien Law Article 3-A and
Texas's construction trust fund statute are the well-known examples, and
several other states have their own. Where that applies, a GC diverting money
owed to a sub is not merely a late payment.

That is a genuine reason a GC would route payment through here — a system
that holds the money against a verified milestone and a signed waiver is
evidence they handled it properly. **It is also why getting this wrong is
serious**, and it is squarely a question for counsel rather than one to
reason our way through.

---

## 4. The flow, end to end

Written as states, because the useful object is the ledger entry and not the
transfer.

```
GC funds the work order
        │  money leaves the GC, lands in a partner-held balance
        ▼
   ┌──────────┐   milestone reached (sub)  ┌──────────┐
   │  funded  │ ─────────────────────────▶ │ reached  │
   └──────────┘                            └──────────┘
                                                 │ verified (GC, different person)
                                                 ▼
                                          wo_releases row
                                          status = 'due'
                                                 │
                                    ┌────────────┴────────────┐
                            waiver clear?              waiver outstanding
                                    │                        │
                                    ▼                        ▼
                             payable                 blocked, or overridden
                                    │                 with a written reason
                    ┌───────────────┴───────────────┐
                    ▼                               ▼
            standard payout                   fast payout
            ACH, 1–3 days, free               instant rail, fee
                    └───────────────┬───────────────┘
                                    ▼
                          status = 'paid'
                          method = 'ach' | 'instant'
                          reference = transfer id
```

Four things about that diagram are decisions, not drawing:

**Funding is per work order, not per account.** A pot of money attached to
the account is a float somebody has to reconcile and a number that means
nothing to either party. Money funded against a work order can be shown to
the subcontractor as *the money for this job is already in* — which is the
single most valuable sentence in this entire feature, and the reason a sub
would push their GC onto SubSub.

**Verification still creates the release.** Funding does not. A funded work
order with nothing verified owes nobody anything, and the two-party rule is
untouched: the side paying cannot mark the work done, and the side doing the
work cannot release the money.

**The waiver gate stays exactly where it is.** It already works and it is the
reason to route payment through here at all.

**The GC can always see what is funded and unspent**, and get it back when a
job ends early. Money that goes in and cannot come out is not escrow, it is a
deposit, and no general contractor will fund a second job.

---

## 5. What "instant" is actually selling

This is the part to get right, because there are two completely different
products behind the same word and only one of them is a payout-speed fee.

### The honest version: a different, faster rail

SubSub (via the partner) is holding the money. The milestone is verified and
the waiver is clear, so the subcontractor is owed it **now**. What they are
waiting for is settlement:

- **Standard — ACH.** One to three business days. Costs cents. **Free to the
  sub.**
- **Fast — push-to-debit (Visa Direct / Mastercard Send) or RTP/FedNow.**
  Minutes. Costs roughly 1–1.5% on the card rails. **Fee to the sub,** because
  it genuinely costs that.

That fee is defensible because it buys a real thing: a more expensive rail.
Roughly 1% to the sub against a rail cost near that leaves thin margin — the
money in this feature is the platform fee on the release, not the speed fee.

### The trap, stated plainly

**If we are already holding the money and the milestone is verified, any wait
we impose is a wait we invented.** Charging to remove it is a fee for
nothing, and it is exactly the kind of thing this product refuses everywhere
else. So:

- Standard payout must be genuinely free and genuinely prompt — same day into
  the ACH batch, not "we hold it a week unless you pay".
- The fast option must name what it is buying: *arrives in minutes instead of
  1–3 working days, because it goes on the card rails*.
- A sub who never pays a fee must never be worse off than they are today
  being paid by cheque. If they are, we have built a toll booth.

### The other version: paying before we hold the money

If a sub wants paid when the GC has **not** funded, or before verification,
that is not a speed fee. That is an **advance against a receivable** —
lending or factoring. It means state lending licences, usury caps,
disclosure rules, and SubSub carrying credit risk on a GC it cannot
underwrite.

It is a real business and several companies do it. **It is a different
company from this one**, and it should not be smuggled in behind the word
"instant". Decide it separately or not at all.

---

## 6. What the migrations add

**050 is built and is onboarding only** — `payout_accounts`, below. Funding
and releases move to 051, because a table nothing reads yet is a table nobody
can tell is wrong.

Small, because the ledger is already right. Every statement `IF NOT EXISTS`,
no `ALTER TABLE`, one paste — the 048 rule.

**`wo_funding`** (051, not yet built) — money in. One row per funding event against a work order,
never a mutable balance: a balance is a number two writes can disagree about,
and "where did the money come from" has to be answerable later.

```
id, work_order_id, account_id,
amount_cents,
status         'pending' | 'settled' | 'returned' | 'failed'
method         'ach' | 'card' | 'wire'
processor      'stripe'
processor_ref  the payment intent / transfer id
created_at, settled_at, returned_at
```

Funded-and-unspent is then `SUM(settled funding) − SUM(non-void releases)`,
derived rather than stored, for the reason `net_cents` is derived: two numbers
that should agree eventually will not.

**`payout_accounts`** (050, **built**) — the subcontractor's verified payout
destination, per company. Holds the partner's account id and KYC state, **never a bank
number**: account and routing numbers live with the partner, and a table we
hold is a table we have to protect.

```
company_id, processor, processor_account_id,
kyc_status     'none' | 'pending' | 'verified' | 'rejected'
instant_ready  whether a fast rail is available at all
```

**On `wo_releases`** (051, not yet built) — additive columns, so they go in a
paste of their own:

```
payout_speed    'standard' | 'instant'
speed_fee_cents the fee charged for the fast rail, stamped like fee_bps
payout_ref      the partner's transfer id
```

`method` already exists and takes `'ach'` or `'instant'` without changing
shape, which is what it was put there for.

**`CHECK.sql`** gets a line per column, and one invariant that must read
zero: **a release marked paid with no `payout_ref` and a non-manual method**
— money reported as sent with nothing saying where it went.

---

## 7. The gates, including one that is missing

`settle` currently checks the waiver chain and nothing else.

CLAUDE.md lists, as a reason a GC would route payment through SubSub,
*"refusing to pay a subcontractor whose insurance lapsed"*. **That is not
implemented.** The settle route does not look at `docStatus` at all.

It belongs in this work, because it is the one gate that is worth real money
to a GC and it is the one this product is uniquely able to enforce — we hold
the certificate and its live expiry. The rule should follow the one already
settled for assignment: **the date that matters is the work's, not today's.**
A certificate that lapsed *after* the milestone was verified does not make
that work uninsured, so it must not block that payment — it raises an urgent
request for a replacement, exactly as an expiry under a scheduled job does.

Three gates on payment, then:

1. **Waiver chain clear** — exists, keep.
2. **Cover in force on the work's date** — to build.
3. **Payee KYC verified** — new, and a hard stop rather than an override:
   the partner will refuse the transfer anyway, so a screen that offers the
   button is a screen that lies.

Gates 1 and 2 take an override with a written reason. Gate 3 cannot.

---

## 8. The economics, roughly

- **Platform fee on the release** — `fee_bps`, stamped per release, the real
  revenue. A point on construction payment volume is a large number. Sits
  beside the $99 subscription rather than replacing it.
- **Instant payout fee** — passes through a card-rail cost near 1%. Thin.
  Price it as a service, not a margin.
- **Funding cost** — ACH in is cents; card in is ~2.9% and should probably
  not be offered at these ticket sizes.

The order to think about them: the platform fee is the business, the instant
fee is a convenience that must not become a toll, and card funding is a way
to lose money at scale.

---

## 9. What has to be decided before anything is built

These are yours, not engineering's:

1. **Partner.** Stripe Connect unless there is a reason not to. Everything
   below depends on it.
2. **Counsel, early.** Money transmission exposure, whether agent-of-payee
   helps, and the construction trust fund statutes in the states we operate
   in. This is the lien-waiver-wording decision again: a lawyer attached,
   and not something to reason our way through.
3. **Is the platform fee live at launch, or zero like today?** Launching at
   zero and turning it on later is easy — `fee_bps` is stamped per release,
   so old releases keep their old rate by construction.
4. **Do we offer advances at all?** Recommend no, and say so out loud, so
   "instant" never quietly becomes lending.
5. **Does funding become mandatory for Easy Pay work orders**, or can a GC
   use the milestone ledger without funding? Recommend optional: the ledger
   is useful on its own and making it conditional on money moving would take
   away what already works.

## 10. Stripe Connect, concretely

**This is not a new integration.** `app/worker/billing.js` already talks to
Stripe over plain `fetch`, because the Node SDK wants Node's `crypto` and
`http` and a Worker has neither. The two primitives Connect needs are both
already written and already in production for subscription billing:

- **`stripeCall(env, path, { method, params, idempotencyKey })`** — form
  encoding including nested params, bearer auth, an `Idempotency-Key` header,
  and errors that carry Stripe's own code.
- **`verifyStripeWebhook(raw, sigHeader, secret)`** — HMAC over the exact
  bytes via SubtleCrypto, a 300-second replay window, constant-time compare.

`POST /api/stripe/webhook` exists, is already on the public-route exemption
list, and already dedupes by event id against `stripe_events` — insert the id,
and a failed insert *is* the duplicate check.

So Connect adds **paths and event types**, not infrastructure. What genuinely
has to be built is below.

### 10.1 The three changes to what exists

**`stripeCall` needs to be able to act as a connected account.** Calls made on
behalf of one carry `Stripe-Account: acct_...`. Today the headers are fixed.
One option — `account` — sets that header, and it is the only change to
`billing.js`.

**A second webhook route and a second secret.** Connect events are delivered
to their own endpoint with its own signing secret, and they carry an `account`
field naming whose they are. Keep them apart: `/api/stripe/connect-webhook`
with `STRIPE_CONNECT_WEBHOOK_SECRET`, added to the exemption list beside the
first. One endpoint for both would make every handler ask *is this ours or a
connected account's* — two records in one switch, which is the shape this
repository keeps recording.

**`stripe_events` is reused as-is.** Event ids are unique across both
endpoints, so the same dedupe table covers both with no migration.

### 10.2 Onboarding a subcontractor, which is the long pole

1. `POST /v1/accounts` with `controller` properties — the current form of what
   used to be `type: "express"`: Stripe collects the identity data, hosts the
   onboarding UI, and takes the losses. Store the returned `acct_...` on
   `payout_accounts.processor_account_id`.
2. `POST /v1/account_links` with `type: "account_onboarding"` and a
   `refresh_url` / `return_url` pointing back into the app. Send the sub to
   the URL it returns. Stripe collects legal name, date of birth, SSN last
   four, business details and a bank account.
3. `account.updated` arrives on the Connect webhook. Read `charges_enabled`,
   `payouts_enabled` and `requirements` and write `kyc_status`.

**The trap: an account link is single-use and expires in minutes.** Storing
one and rendering it as a button gives somebody a dead link with nothing
saying why. *Resume setup* must mint a fresh link on every press.

**The second trap: `payouts_enabled` can go false again.** Stripe asks for more
documents as volume grows, so a sub who was payable last month may not be
today. `requirements.currently_due` is the list, and the screen has to be able
to say what is being asked for rather than just refusing.

### 10.3 Funding, and the shape that actually does escrow

**Separate charges and transfers.** The GC pays into the *platform* account:
`POST /v1/payment_intents` with `transfer_group` set to the work order id and
`payment_method_types: ["us_bank_account"]` for ACH. The money sits in the
platform's Stripe balance. When a milestone is verified, a transfer moves the
net to the sub's connected account.

This is the only one of Stripe's three shapes that does escrow, and it is
worth saying why the other two do not. A **destination charge** pays the sub at
the moment the GC pays, so there is nothing held. **Destination with manual
payouts** puts the money in the *sub's* balance immediately — so the GC cannot
get it back if the job goes wrong, and the sub holds money for work nobody has
verified.

**This partly revises §3, and the correction matters.** Saying SubSub "never
holds the funds" is true of its bank account and not of this arrangement: in
separate charges and transfers, the funds sit in a Stripe-held balance
attributed to the platform, and SubSub is merchant of record. Stripe and its
bank partners remain the regulated movers of money, which is most of the
benefit — but the clean claim does not survive contact with the escrow
requirement. **The tension between "hold the money" and "never hold the money"
is the legal question**, not a detail underneath it, and it is the first thing
to put to counsel.

**The ACH trap, which is the expensive one.** `payment_intent.succeeded` on an
ACH debit does **not** mean the money is irreversibly ours. A debit can be
returned days later — insufficient funds, a closed account, a disputed
authorisation — and the return arrives as `charge.failed` or a dispute long
after the intent read as succeeded. Pay a sub out of funds that later reverse
and the loss is real and ours.

So `wo_funding.status` must go to `settled` off the right signal and not the
optimistic one, and the product has a decision to make: hold releases until
funds are genuinely settled (slower, safe), or release on succeeded and carry
the risk (faster, and a real cost line). Card funding settles far faster and
costs about 2.9%, which at these ticket sizes is a way to lose money at scale.

### 10.4 Releasing, which the ledger already computes

On `POST /api/milestones/:id/verify`, after the `wo_releases` row is written:

```
POST /v1/transfers
  amount       = net_cents        ← already computed by releaseAmounts()
  currency     = usd
  destination  = acct_...
  transfer_group = <work order id>
  Idempotency-Key: rel_<releaseId>
```

Two things fall out for free. **There is no `application_fee_amount`** — that
belongs to destination charges. With separate charges and transfers the fee is
simply what does not leave: the GC paid `gross`, the sub receives `net`, and
`retainage + fee` stays in the platform balance. `releaseAmounts()` already
returns exactly those four numbers.

And **the idempotency key is already modelled**. `wo_releases.idem_key` exists
with a unique index, and the verify route already writes `rel:<milestoneId>`
into it. Passing the same value to Stripe means a double-tapped verify cannot
produce two transfers, on both sides of the wire, by construction.

### 10.5 Payouts, and the honest instant fee

Money in the sub's connected balance still has to reach their bank.

- **Standard** — leave `payouts.schedule` on automatic. Stripe sweeps to their
  bank on its own, one to two business days, **no fee**.
- **Instant** — `POST /v1/payouts` with `method: "instant"` and
  `Stripe-Account: acct_...`. Minutes, to an eligible debit card or bank.
  Stripe charges about 1% with a minimum.

**This is the §5 design falling straight out of the rails rather than being
invented on top of them.** The free option is genuinely free and genuinely
prompt because Stripe sweeps automatically; the fast option costs about what
we would charge for it. Nobody is being charged to remove a wait we imposed.

One gate: instant is only available against `instant_available` balance and an
eligible destination. Read the balance and offer the button only when Stripe
would honour it — a screen offering what the server will refuse is the lie
QuickSend's W-9 line already exists to avoid.

### 10.6 The events that matter

On the Connect endpoint: `account.updated` (KYC state), `transfer.created`,
`transfer.reversed`, `payout.paid`, `payout.failed`.

On the existing endpoint: `payment_intent.succeeded`,
`payment_intent.payment_failed`, and the ACH reversal events above.

`payout.failed` is the one worth naming: it means the money went out and came
back, the sub has not been paid, and **nobody finds out unless something
says so.** Same class as the two-party handshake whose second side had no
screen.

### 10.7 It can be tested, and the seam is already there and unused

`billing.js` reads `STRIPE_API_BASE`, overridable "for the same reason
`RESEND_API_BASE` is: without it the only way to find out how this behaves
when Stripe refuses something is to make Stripe refuse something."

**Nothing uses it.** There is no test suite for the Stripe integration at all —
the seam was built and never spent. Connect should be stubbed through it from
the first route, and the existing billing paths are owed the same.

## 11. Build order

1. Partner chosen (Stripe), counsel engaged, sandbox account. **Counsel is
   still owed** — see §10.3, the escrow shape is the question.
2. ~~Migration 050 and `app/shared/pay.js`~~ — **done.**
3. ~~Sub onboarding to the partner (KYC)~~ — **done.** Account → Company,
   *Getting paid*. `test:payouts` and `test:payoutsui`.
4. Funding a work order, and showing the sub that it is funded. **This is the
   first thing with standalone value** — it is worth shipping even before
   payouts work.
5. Standard payout on verify-and-clear.
6. The insurance gate.
7. Instant payout, last, because it is an option on a thing that must already
   work.

Steps 1–4 are most of the value. A subcontractor who can see the money for
their job is already in has been given something no other system in this
trade gives them.
