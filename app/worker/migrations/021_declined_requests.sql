-- Migration 021 — a request the manager turned down.
--
-- A tenant's or an owner's request sat under "Asked for by owners and
-- tenants" until somebody approved it, and there was no way to say no. It
-- stayed there forever and the person who asked was never told.
--
-- Like approval and withdrawal, this is a timestamp and a note rather than a
-- status: jobs.status has a CHECK on it and widening one in SQLite means
-- rebuilding the table. A reason is always written, because "declined" with
-- no explanation is the thing that generates the phone call this product
-- exists to prevent.
--
--   npx wrangler d1 execute subsub-db --config=wrangler.toml \
--     --file=./worker/migrations/021_declined_requests.sql
--
-- Re-running stops with "duplicate column name", which is safe to ignore.
ALTER TABLE jobs ADD COLUMN declined_at TEXT;
ALTER TABLE jobs ADD COLUMN declined_note TEXT;
