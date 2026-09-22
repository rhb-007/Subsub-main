-- Migration 020 — a report the tenant took back.
--
-- It fixed itself, or it was never really a problem: the person who
-- reported it can withdraw it. jobs.status has a CHECK on it and widening
-- one means rebuilding the table, so this is a timestamp and a reason on
-- the row, the way approval is. Withdrawn jobs drop out of everything
-- live: their work orders are voided, their open visit superseded.
--
--   npx wrangler d1 execute subsub-db --config=wrangler.toml \
--     --file=./worker/migrations/020_withdrawn_reports.sql
--
-- Re-running stops with "duplicate column name", which is safe to ignore.
ALTER TABLE jobs ADD COLUMN withdrawn_at TEXT;
ALTER TABLE jobs ADD COLUMN withdrawn_note TEXT;
