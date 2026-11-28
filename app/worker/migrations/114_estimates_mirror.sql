-- 114. Estimates (the CRM's proposals, renamed on screen) grow the parts a
-- sales estimate carries: project details, a proposed production schedule,
-- the office's own tasks, the cost behind the price, and a logo of its own.
-- And a market can be kept in step with Where you work.
--
-- Three tables, no ALTER TABLE, so this is one paste and safe to run twice.
-- shared/estimate.js holds the rules for the first two.

-- What a sales estimate says beyond its line items. One row per estimate;
-- no row is an estimate with none of these, which is what every estimate
-- written before 114 is.
CREATE TABLE IF NOT EXISTS sales_estimate_extras (
  proposal_id   TEXT PRIMARY KEY REFERENCES sales_proposals(id) ON DELETE CASCADE,
  account_id    TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  project_type  TEXT,
  target_start  TEXT,
  details       TEXT NOT NULL DEFAULT '[]',
  schedule      TEXT NOT NULL DEFAULT '[]',
  tasks         TEXT NOT NULL DEFAULT '[]',
  cost_cents    INTEGER,
  show_logo     INTEGER NOT NULL DEFAULT 1,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_estimate_extras_account ON sales_estimate_extras(account_id);

-- The logo an estimate wears. Its own, so an account on Basic (where the
-- Branding logo is not offered) can still put its mark on what it sends.
CREATE TABLE IF NOT EXISTS estimate_branding (
  account_id  TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  logo_key    TEXT,
  updated_at  TEXT NOT NULL
);

-- "We sell in the same places we work": on, one market is kept in step with
-- Where you work. on_at NULL is off; the market stays, it just stops moving.
CREATE TABLE IF NOT EXISTS market_mirror (
  account_id  TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  market_id   TEXT REFERENCES sales_markets(id) ON DELETE SET NULL,
  on_at       TEXT,
  updated_at  TEXT NOT NULL
);
