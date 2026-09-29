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
takes possession of customer money**. The GC pays into an account the partner
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

## 6. What migration 050 adds

Small, because the ledger is already right. Every statement `IF NOT EXISTS`,
no `ALTER TABLE`, one paste — the 048 rule.

**`wo_funding`** — money in. One row per funding event against a work order,
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

**`payout_accounts`** — the subcontractor's verified payout destination, per
company. Holds the partner's account id and KYC state, **never a bank
number**: account and routing numbers live with the partner, and a table we
hold is a table we have to protect.

```
company_id, processor, processor_account_id,
kyc_status     'none' | 'pending' | 'verified' | 'rejected'
instant_ready  whether a fast rail is available at all
```

**On `wo_releases`** — no new table, and these are additive columns, so they
go in a paste of their own:

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

## 10. Build order

1. Partner chosen, counsel engaged, sandbox account.
2. Migration 050 and `app/shared/pay.js` — the rules module, so the route,
   the screen and the tests cannot hold three opinions. The house pattern.
3. Sub onboarding to the partner (KYC), because it is the long pole and the
   thing most likely to be abandoned half-built.
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
