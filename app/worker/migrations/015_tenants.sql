-- Migration 015 — tenants.
--
-- The people who actually live with the problem. Until now a leak in a flat
-- reached SubSub only when somebody phoned the managing agent and the agent
-- typed it in. A tenant can now report it themselves, from the same branded
-- address their building already uses, and watch what happens to it.
--
-- A tenant is a scoped seat like a building owner, but narrower still: they
-- see their own reports and nothing else -- not the building's other work,
-- not who else lives there, and not a penny of what anything costs.
--
--   npx wrangler d1 execute subsub-db --config=wrangler.toml \
--     --file=./worker/migrations/015_tenants.sql
--
-- Safe to re-run except where noted: the ADD COLUMN stops with "duplicate
-- column name", which can be ignored.

-- Which flat, door or unit. Free text, because "4B", "Flat 2, rear" and
-- "Shop 3" are all real answers and none of them parse.
ALTER TABLE memberships ADD COLUMN unit TEXT;

-- An invitation to become a tenant of a building.
--
-- Deliberately not a row in sub_invites with a flag. That table's invite is
-- accepted by filling in a company, a licence and a trade list; this one is
-- accepted by naming a building and setting a password. Sharing a table would
-- mean every read of either growing a branch, to save one table.
CREATE TABLE IF NOT EXISTS tenant_invites (
  id           TEXT PRIMARY KEY,
  account_id   TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- The building, when whoever sent it already knows. Left NULL, the tenant
  -- chooses from the account's list when they accept -- which is how a
  -- managing agent with one link and a noticeboard would use it.
  property_id  TEXT REFERENCES properties(id) ON DELETE CASCADE,
  token        TEXT UNIQUE NOT NULL,
  -- Who it was meant for: "Flat 4B" or a name. For reading the list back,
  -- not enforced against anything.
  label        TEXT,
  created_by   TEXT REFERENCES users(id),
  created_at   TEXT DEFAULT CURRENT_TIMESTAMP,
  expires_at   TEXT NOT NULL,
  -- Kept after use rather than deleted, so the list can say "accepted"
  -- instead of going quiet.
  used_at      TEXT,
  user_id      TEXT REFERENCES users(id),
  revoked_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_tenant_invites_account ON tenant_invites(account_id);
