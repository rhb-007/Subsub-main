-- 080: the ledger for "waiting on you" reminder emails.
--
-- The nightly sweep works out who every open job is waiting on -- the crew to
-- reply, to say when they can come or to confirm a time; the hiring side to
-- approve a time or put somebody on an approved request; the tenant to
-- confirm -- and emails them on a schedule (day 1, 2, 4, 7, 11 and 15) that
-- stops by itself once the move is made. See app/shared/remind.js.
--
-- One row per item, party and step, written BEFORE the email goes, so a night
-- that dies halfway never sends the same reminder twice. `item_key` carries
-- when the wait started, so a new proposal or a declined window restarts the
-- sequence rather than continuing the old one's count.
--
-- No ALTER TABLE, so it is one paste and safe to run twice.

CREATE TABLE IF NOT EXISTS action_reminders (
  id          TEXT PRIMARY KEY,
  account_id  TEXT NOT NULL,
  job_id      TEXT NOT NULL,
  item_key    TEXT NOT NULL,
  party       TEXT NOT NULL CHECK (party IN ('contractor', 'manager', 'tenant')),
  step        INTEGER NOT NULL CHECK (step BETWEEN 1 AND 6),
  emailed     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_action_reminder ON action_reminders(item_key, party, step);
CREATE INDEX IF NOT EXISTS ix_action_reminders_job ON action_reminders(job_id);
