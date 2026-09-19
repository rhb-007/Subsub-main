-- Migration 003 — account type.
--
-- Who an account is, as opposed to what a user may do inside it. A general
-- contractor subs out trades job by job and has no building list; a property
-- manager, building owner or commercial portfolio manager keeps a standing
-- portfolio and scopes vendors to specific properties. The Properties tab is
-- gated on this.
--
--   npx wrangler d1 execute subsub-db --config=wrangler.toml \
--     --file=./worker/migrations/003_account_kind.sql
--
-- SQLite cannot make ADD COLUMN conditional, so a second run stops with
-- "duplicate column name: kind". That error is safe to ignore.
--
-- Existing accounts default to general_contractor, which is the no-Properties
-- shape they already had, so nothing changes for them until someone sets it.
-- The CHECK constraint is deliberately omitted: adding one to an existing
-- table needs a full table rebuild, and the API validates the value anyway.

ALTER TABLE accounts ADD COLUMN kind TEXT NOT NULL DEFAULT 'general_contractor';
