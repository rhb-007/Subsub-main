-- Who owns a building, as distinct from who runs it.
--
-- `properties.account_id` has always meant both at once, and for a property
-- manager's portfolio that is correct: they typed the building in, they run it,
-- it is theirs. But the owner of that building is a GUEST on the account
-- managing it -- so when they fire their manager they lose the building, its
-- job history, its certificates and their own view of all three. They cannot
-- even let themselves out: the person they are leaving holds the only button.
--
-- That is the wrong answer to "what happens to my building if I change agent",
-- and it is the same question a property manager asks before putting a
-- portfolio in here.
--
-- So the two meanings are separated:
--
--   account_id        the account that OPERATES it day to day. Every existing
--                     query keeps working untouched, because for a managed
--                     building this is still the manager.
--   owner_account_id  the account that OWNS it, and may move it.
--
-- For every row that exists today the two are the same, which is the truthful
-- backfill: a manager who typed a building in owns the record of it until an
-- owner arrives and is handed it.
--
-- WHAT DOES NOT MOVE IS THE POINT. `jobs.account_id` stays with whoever ran
-- the job. A handover moves the building and leaves the work where it
-- happened, so the outgoing manager keeps their record without anything being
-- copied, and the owner can read the whole history of their building across
-- however many managers it has had. Nothing is duplicated and nothing is
-- deleted to satisfy a departing client -- which matters, because a job the
-- manager ran may be a job the manager is later asked to account for.
--
--   npx wrangler d1 execute subsub-db --config=wrangler.toml --remote \
--     --file=./worker/migrations/039_building_handover.sql
--
-- The ALTER is first and cannot run twice; everything after it is repeatable.
-- Run this paste on its own.
ALTER TABLE properties ADD COLUMN owner_account_id TEXT REFERENCES accounts(id);

-- Today's truth: whoever holds a building owns it until it is handed over.
UPDATE properties SET owner_account_id = account_id WHERE owner_account_id IS NULL;

CREATE INDEX IF NOT EXISTS ix_properties_owner ON properties (owner_account_id);

-- A handover in flight. Two-party: one side asks, the other agrees, and
-- neither can move a building alone.
--
-- `direction` records who asked, because the two are different conversations.
-- An owner asking to be given their building is a client leaving; a manager
-- offering to hand it back is a manager resigning the instruction. Both end in
-- the same place and the audit should not have to guess which happened.
CREATE TABLE IF NOT EXISTS property_transfers (
  id                TEXT PRIMARY KEY,
  property_id       TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  -- The account operating it when the request was raised.
  from_account_id   TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- Where it is going. For a handover to an owner this is their own account,
  -- which must exist first -- an owner cannot be handed a building they have
  -- nowhere to put.
  to_account_id     TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- WHICH ACCOUNT ASKED. The two-party rule is "the side that asked has
  -- already agreed, so the other side decides", and that needs to be a fact on
  -- the row rather than something inferred from `direction`.
  --
  -- Inferring it does not survive both kinds. On a handover the owner is the
  -- `to` side; on an appointment the owner is the `from` side. A rule written
  -- in terms of owner/manager therefore points at the requester for one of
  -- them -- which lets one party move a building alone, the single thing this
  -- table exists to prevent.
  requested_by_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- Kept for the audit: an owner taking a building back and a manager resigning
  -- an instruction end in the same place and should not read the same.
  direction         TEXT NOT NULL CHECK (direction IN ('owner_requested','manager_offered')),
  kind              TEXT NOT NULL DEFAULT 'handover'
                      CHECK (kind IN ('handover','appointment')),
  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','accepted','declined','cancelled')),
  note              TEXT,
  requested_by      TEXT REFERENCES users(id),
  decided_by        TEXT REFERENCES users(id),
  created_at        TEXT DEFAULT CURRENT_TIMESTAMP,
  decided_at        TEXT
);
CREATE INDEX IF NOT EXISTS ix_ptransfer_property ON property_transfers (property_id, status);
CREATE INDEX IF NOT EXISTS ix_ptransfer_from ON property_transfers (from_account_id, status);
CREATE INDEX IF NOT EXISTS ix_ptransfer_to ON property_transfers (to_account_id, status);
-- One live request per building. Two open handovers would mean two people
-- each believing they were about to receive the same property.
CREATE UNIQUE INDEX IF NOT EXISTS ux_ptransfer_open
  ON property_transfers (property_id) WHERE status = 'pending';
