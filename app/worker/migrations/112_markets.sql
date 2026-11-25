-- 112. Markets: the places an account sells in, and the services it offers
-- in each. app/shared/markets.js holds the rules.
--
-- One table and no ALTER TABLE, so this is one paste and safe to run twice.
-- A lead's market is worked out from its ZIP (or town) when it is read, not
-- stored on the lead, so there is no column on sales_leads to keep in step.
CREATE TABLE IF NOT EXISTS sales_markets (
  id          TEXT PRIMARY KEY,
  account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  zips        TEXT NOT NULL DEFAULT '[]',
  cities      TEXT NOT NULL DEFAULT '[]',
  services    TEXT NOT NULL DEFAULT '[]',
  active      INTEGER NOT NULL DEFAULT 1,
  created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_sales_markets_account ON sales_markets(account_id);
