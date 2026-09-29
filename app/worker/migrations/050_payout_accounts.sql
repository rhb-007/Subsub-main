-- 050: where a subcontractor's money goes, which is not a thing we hold.
--
-- ONE PASTE and no ALTER TABLE: every statement is IF NOT EXISTS, so running
-- it again does nothing. Same rule as 048 and 049.
--
-- This is onboarding only. A company connects a Stripe account, Stripe does
-- the identity checking, and this table remembers which account is theirs and
-- whether Stripe will let money move. Funding a work order and releasing
-- against a milestone are a later migration -- a table nothing reads yet is a
-- table nobody can tell is wrong.

CREATE TABLE IF NOT EXISTS payout_accounts (
  id                   TEXT PRIMARY KEY,
  -- Per COMPANY, not per account. A company is one payee however many
  -- rosters it sits on, and `companies` is the row every hiring account
  -- already shares.
  company_id           TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  processor            TEXT NOT NULL DEFAULT 'stripe',
  -- Stripe's `acct_...`. THE ONLY THING ABOUT THEIR BANK THAT IS STORED
  -- HERE: account and routing numbers are Stripe's to hold, and a table we
  -- keep is a table we have to protect. Nothing in this file is a bank
  -- detail and nothing added to it should be.
  processor_account_id TEXT NOT NULL,
  -- Mirrors Stripe rather than latching. An account that was payable last
  -- month can stop being payable when Stripe asks for more as volume grows,
  -- so every one of these is re-derived from a fresh account object and none
  -- of them is remembered once it was true.
  kyc_status           TEXT NOT NULL DEFAULT 'none'
                         CHECK (kyc_status IN ('none','pending','verified','rejected')),
  -- Two capabilities, because they fail separately. `transfers_active` is
  -- money reaching their Stripe balance; `payouts_enabled` is money leaving
  -- it for their bank. Somebody with the first and not the second looks paid
  -- from our side and looks unpaid from theirs.
  transfers_active     INTEGER NOT NULL DEFAULT 0,
  payouts_enabled      INTEGER NOT NULL DEFAULT 0,
  -- JSON array of Stripe's own requirement keys, so the screen can say what
  -- is being asked for instead of "not verified".
  requirements         TEXT NOT NULL DEFAULT '[]',
  disabled_reason      TEXT,
  created_at           TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at           TEXT
);

-- One connected account per company. Two would be two places the money could
-- go with nothing saying which, and the failure is silent until somebody is
-- paid into an account they have forgotten about. The create path also sends
-- Stripe an idempotency key for the same reason -- this is the half that
-- holds when two requests arrive at once, which a pre-check cannot cover.
CREATE UNIQUE INDEX IF NOT EXISTS ux_payout_account_company
  ON payout_accounts (company_id, processor);

-- And one company per connected account. The webhook arrives naming an
-- `acct_...` and nothing else, so this is the column it looks up by; two
-- rows carrying one id would make that answer ambiguous at exactly the
-- moment money is involved.
CREATE UNIQUE INDEX IF NOT EXISTS ux_payout_account_processor
  ON payout_accounts (processor, processor_account_id);
