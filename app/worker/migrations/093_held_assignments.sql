-- 093. A job held for a contractor who is not on SubSub yet.
--
-- A work order can only go to a company somebody can sign in as: nobody else
-- can accept it, so it would sit until it expired. Assigning one to a
-- contractor with no login now records the intention here and invites them.
-- When they accept the invite the work order is issued through the ordinary
-- assign route, so every check runs again and their response window starts
-- then, and they accept or decline it like any other.
--
-- `payload` is the assign request as it was sent (price, crew, scope,
-- response window). One open hold per job and trade, held by the index.
-- A release that the assign route refused is closed with its reason, so the
-- slot frees and the hiring side is told.
--
-- Its own table, so the paste can be run twice.
CREATE TABLE IF NOT EXISTS held_assignments (
  id            TEXT PRIMARY KEY,
  account_id    TEXT NOT NULL,
  job_id        TEXT NOT NULL,
  trade         TEXT NOT NULL,
  company_id    TEXT NOT NULL,
  payload       TEXT NOT NULL DEFAULT '{}',
  created_by    TEXT,
  created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  released_at   TEXT,
  work_order_id TEXT,
  release_error TEXT,
  cancelled_at  TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_held_open
  ON held_assignments(job_id, trade) WHERE released_at IS NULL AND cancelled_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_held_company ON held_assignments(account_id, company_id);
