-- Money actually moves.
--
-- 033 wrote this ledger for a processor that did not exist: `wo_releases.method`
-- and `.reference` were left as the seam a payment rail drops into, and
-- `fee_bps` has been stamped onto every release since the first row so that
-- changing the rate cannot rewrite history. Everything about releasing money
-- was there except the money. `settle` set `status = 'paid'` and recorded a
-- cheque number, which is a note about a payment that happened elsewhere.
--
-- These two tables are the funded side. See shared/escrow.js for the rules and
-- EASY-PAY.md §10.3 for the legal shape, which is the part that decided all of
-- it: separate charges and transfers is the only arrangement that holds money
-- between funding and release, and it puts the funds in a balance attributed to
-- the platform with SubSub as merchant of record.
--
-- WHY TWO TABLES RATHER THAN COLUMNS ON `wo_releases`.
--
-- The seam says a processor becomes another value in `method` and a transfer id
-- in `reference`, and that is still true and still what a paid release records.
-- What it has nowhere to put is an ATTEMPT: a transfer can be refused, retried,
-- and reversed weeks later, and each of those is a fact somebody will be asked
-- about. Writing failures onto the release would mean either losing them or
-- marking a release paid that was not. So attempts live here and the release
-- goes on recording the one that worked.
--
-- ONE PASTE, NO `ALTER TABLE`, every statement `IF NOT EXISTS`, so running this
-- file twice does nothing. D1 stops a script at the first failing statement and
-- does not undo what ran before it, and ADD COLUMN is the one statement that
-- cannot be repeated -- there is none here.

-- ---------------------------------------------------------------------------
-- Money in. What the hiring account has put behind a work order.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wo_funding (
  id             TEXT PRIMARY KEY,
  work_order_id  TEXT NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  -- Denormalised for the same reason every other table here does it: every
  -- read is scoped to one account and a three-table join to prove it is how a
  -- scoping bug gets written.
  account_id     TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  amount_cents   INTEGER NOT NULL,
  currency       TEXT NOT NULL DEFAULT 'usd',

  processor      TEXT NOT NULL DEFAULT 'stripe',
  -- The PaymentIntent. Its id is what a refund, a dispute and a reconciliation
  -- are all keyed by, so it is the row's real identity.
  processor_intent_id TEXT,
  -- And the charge underneath it, which is a DIFFERENT id and is the one a
  -- transfer names as its `source_transaction`. Holding only the intent would
  -- mean fetching Stripe again at the moment money goes out.
  processor_charge_id TEXT,

  status         TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','funded','failed','refunded')),
  -- Stripe's own words when it refuses, kept so a screen can say what is wrong
  -- rather than "payment failed".
  error          TEXT,

  refunded_cents INTEGER NOT NULL DEFAULT 0,
  created_by     TEXT REFERENCES users(id),
  created_at     TEXT DEFAULT CURRENT_TIMESTAMP,
  funded_at      TEXT
);
-- One row per PaymentIntent. The pre-check in the route makes an ordinary
-- double-press cheap; this is what is correct when the webhook and the browser
-- confirm the same intent at the same moment, which a pre-check cannot cover.
CREATE UNIQUE INDEX IF NOT EXISTS ux_wo_funding_intent
  ON wo_funding (processor, processor_intent_id) WHERE processor_intent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_wo_funding_wo ON wo_funding (work_order_id, status);
CREATE INDEX IF NOT EXISTS ix_wo_funding_acct ON wo_funding (account_id, status);

-- ---------------------------------------------------------------------------
-- Money out. One row per attempt to pay a release.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wo_transfers (
  id             TEXT PRIMARY KEY,
  release_id     TEXT NOT NULL REFERENCES wo_releases(id) ON DELETE CASCADE,
  work_order_id  TEXT NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  account_id     TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- Who was paid. Copied rather than joined through the release, for the reason
  -- the release copies it off the work order: a company can be replaced on a
  -- job, and who was paid in March has to stay March's answer.
  company_id     TEXT NOT NULL REFERENCES companies(id),
  amount_cents   INTEGER NOT NULL,
  currency       TEXT NOT NULL DEFAULT 'usd',

  processor      TEXT NOT NULL DEFAULT 'stripe',
  processor_transfer_id TEXT,
  -- The connected account the money went to. Stored as well as derivable,
  -- because `payout_accounts` can be re-pointed and this row must keep saying
  -- where this money actually went.
  processor_destination TEXT,

  status         TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','paid','failed','reversed')),
  error          TEXT,

  created_by     TEXT REFERENCES users(id),
  created_at     TEXT DEFAULT CURRENT_TIMESTAMP,
  paid_at        TEXT,
  reversed_at    TEXT
);
-- ONE LIVE TRANSFER PER RELEASE. Paying the same milestone twice is the failure
-- the whole ledger exists to make impossible, and this is the half of it that
-- holds under a race. It is partial on purpose: a FAILED attempt must be
-- retryable, so a bare unique index on release_id would leave somebody unable
-- to be paid because a card was declined once.
CREATE UNIQUE INDEX IF NOT EXISTS ux_wo_transfer_live
  ON wo_transfers (release_id) WHERE status <> 'failed';
CREATE UNIQUE INDEX IF NOT EXISTS ux_wo_transfer_processor
  ON wo_transfers (processor, processor_transfer_id) WHERE processor_transfer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_wo_transfer_wo ON wo_transfers (work_order_id, status);
CREATE INDEX IF NOT EXISTS ix_wo_transfer_company ON wo_transfers (company_id, status);
