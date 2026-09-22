-- Migration 019 — a proposed time for a repair, confirmed by the tenant.
--
-- A report used to go from "contractor assigned" to "done" with the person
-- who lives there told nothing about when anybody would turn up. A visit is
-- the manager's (or the contractor's) proposed date and window, which the
-- tenant confirms or declines in the app. Only a confirmed visit puts a
-- date on the job and reads as "Scheduled" to the tenant.
--
-- One live visit per job: proposing again supersedes whatever was there.
--
--   npx wrangler d1 execute subsub-db --config=wrangler.toml \
--     --file=./worker/migrations/019_visits.sql
--
-- Safe to re-run.
CREATE TABLE IF NOT EXISTS visits (
  id            TEXT PRIMARY KEY,
  account_id    TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  job_id        TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  proposed_by   TEXT REFERENCES users(id),
  date          TEXT NOT NULL,           -- YYYY-MM-DD
  start_time    TEXT,                    -- HH:MM, 24h
  end_time      TEXT,
  note          TEXT,                    -- from whoever proposed it
  -- proposed | confirmed | declined | superseded
  status        TEXT NOT NULL DEFAULT 'proposed',
  tenant_note   TEXT,                    -- why it doesn't work, when it doesn't
  created_at    TEXT DEFAULT CURRENT_TIMESTAMP,
  responded_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_visits_job ON visits(job_id);
CREATE INDEX IF NOT EXISTS idx_visits_account ON visits(account_id);
