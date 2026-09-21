-- Migration 014 — building owners, scoped to their own properties.
--
-- Until now every user in an account saw the whole account. That is right for
-- a general contractor, whose staff all work the same book of jobs, and wrong
-- for anyone managing buildings: the owner of one building has no business
-- seeing another owner's, and a property manager cannot hand out a login
-- without handing over the portfolio.
--
-- Run it with:
--   npx wrangler d1 execute subsub-db --config=wrangler.toml \
--     --file=./worker/migrations/014_building_owners.sql
--
-- Three parts. The last two are ordinary ADD COLUMNs and re-running them
-- stops with "duplicate column name", which is safe to ignore. The first is a
-- table rebuild and is NOT safe to run twice -- see the note on it.

-- ---------------------------------------------------------------------------
-- 1. Let a membership carry the 'owner' role.
--
-- memberships.role has a CHECK constraint, and SQLite cannot widen one in
-- place: the table has to be rebuilt. The constraint is dropped rather than
-- widened on the way through, matching migration 003 -- the API validates the
-- role on every write, and a constraint that needs a table rebuild each time a
-- role is added is a constraint that will be wrong the next time.
--
-- Rebuilding copies every row and then swaps the tables, so run it ONCE. If it
-- is interrupted, `memberships_new` will be left behind; drop that and start
-- again rather than re-running blind.
CREATE TABLE memberships_new (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id     TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  role           TEXT NOT NULL,
  company_id     TEXT REFERENCES companies(id),
  created_at     TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, account_id)
);
INSERT INTO memberships_new (id, user_id, account_id, role, company_id, created_at)
  SELECT id, user_id, account_id, role, company_id, created_at FROM memberships;
DROP TABLE memberships;
ALTER TABLE memberships_new RENAME TO memberships;
CREATE INDEX idx_memberships_account ON memberships(account_id);
CREATE INDEX idx_memberships_user ON memberships(user_id);

-- ---------------------------------------------------------------------------
-- 2. Which properties a membership can see.
--
-- A join table rather than a list on the membership, mirroring
-- engagement_properties: deleting a property should take its grants with it,
-- and a foreign key does that without anything having to remember to.
--
-- No rows means no restriction. That is what every existing membership has, so
-- admins and project managers keep seeing the whole account, and it is only
-- the owner role that is refused when the list is empty -- see the API, which
-- treats "owner with no properties" as access to nothing rather than to all.
CREATE TABLE IF NOT EXISTS membership_properties (
  membership_id  TEXT NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
  property_id    TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  PRIMARY KEY (membership_id, property_id)
);
CREATE INDEX IF NOT EXISTS idx_mp_membership ON membership_properties(membership_id);
CREATE INDEX IF NOT EXISTS idx_mp_property ON membership_properties(property_id);

-- ---------------------------------------------------------------------------
-- 3. A job an owner asked for, which is not yet a job.
--
-- An owner can raise work on their own building, but it must not reach a
-- subcontractor until somebody running the account has priced it and agreed
-- to it. Rather than add a status -- jobs.status has a CHECK on it too, and
-- rebuilding a table this size to add one word is not worth it -- a request
-- is a job that names who asked and has not yet been approved.
--
--   requested_by IS NULL                     an ordinary job, as before
--   requested_by SET, approved_at NULL       a request, awaiting approval
--   requested_by SET, approved_at SET        approved; behaves as a job
--
-- Every existing job has requested_by NULL and so is unaffected.
ALTER TABLE jobs ADD COLUMN requested_by TEXT REFERENCES users(id);
ALTER TABLE jobs ADD COLUMN approved_at TEXT;
