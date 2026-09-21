-- Every SMS SubSub sends, what it cost and what it was billed at.
--
-- Nothing writes to this yet -- SMS is not wired up. It exists now because
-- the platform console reports SMS usage and revenue, and a dashboard metric
-- backed by a number typed into the interface is a number that will still be
-- wrong the day it starts mattering. Backed by this, the tile reads zero
-- today and starts being true the moment the first message is sent, with no
-- further console work.
--
-- Two money columns, deliberately:
--
--   cost_cents    what the carrier charges us. A cost, not revenue.
--   billed_cents  what the account is charged for it. Zero while messages
--                 are included in a plan; the margin between the two is the
--                 whole reason to record both rather than inferring one.
CREATE TABLE IF NOT EXISTS sms_log (
  id           TEXT PRIMARY KEY,
  account_id   TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  company_id   TEXT REFERENCES companies(id) ON DELETE SET NULL,
  to_phone     TEXT NOT NULL,
  kind         TEXT NOT NULL,                   -- wo_issued | doc_request | reminder | …
  -- Carriers bill per 160-character segment, not per message, so a long
  -- message is several. Counting messages would understate the bill.
  segments     INTEGER NOT NULL DEFAULT 1,
  cost_cents   INTEGER NOT NULL DEFAULT 0,
  billed_cents INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL,                   -- sent | failed
  provider_id  TEXT,
  error        TEXT,
  at           TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_sms_log_at ON sms_log(at);
CREATE INDEX IF NOT EXISTS idx_sms_log_account_at ON sms_log(account_id, at DESC);
