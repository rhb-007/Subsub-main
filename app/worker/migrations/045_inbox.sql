-- 045 — one page for every pack a person has been sent.
--
-- A general contractor asked three subcontractors for their paperwork and got
-- three unrelated links, each expiring on its own schedule. The value of those
-- links grows with every new one and nothing was adding them up.
--
-- This is the demand side of the growth loop, and the only part of it that
-- pulls rather than pushes: the subcontractors do the data entry, the recipient
-- accumulates a roster they did not build, and claiming it lands them in an
-- account that is already populated. Cold start, solved by the people who
-- wanted to be on it.
--
-- WHY THIS TABLE EXISTS AT ALL, rather than the pack token simply linking
-- through. A share token proves somebody holds one link that was emailed to an
-- address. It does not prove they control that address *now* -- a forwarded
-- certificate would otherwise open every pack ever sent to the person who
-- forwarded it. So reaching the inbox costs a second email to the address on
-- the share, and nothing in the request may name an address.
--
-- Safe to run twice: every statement is IF NOT EXISTS.
--
--   npx wrangler d1 execute subsub-db --config=wrangler.toml \
--     --file=./worker/migrations/045_inbox.sql

CREATE TABLE IF NOT EXISTS doc_inboxes (
  id          TEXT PRIMARY KEY,
  -- The secret in the link. Same shape as a share token and just as random:
  -- 32 bytes, never derived from the address or the clock.
  token       TEXT NOT NULL UNIQUE,
  -- Lowercased, matching doc_shares, or the join misses.
  to_email    TEXT NOT NULL,
  created_at  TEXT DEFAULT CURRENT_TIMESTAMP,
  -- Shorter than a share. A share is a document somebody was sent; this is a
  -- key to everything they were ever sent, so it earns a tighter window.
  expires_at  TEXT NOT NULL,
  revoked_at  TEXT,
  last_used_at TEXT,
  -- Set when they turn it into an account, so the same link cannot be used to
  -- populate a second one, and so "where did this roster come from" has an
  -- answer later.
  claimed_at         TEXT,
  claimed_account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS ix_inbox_email ON doc_inboxes (to_email, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_inbox_token ON doc_inboxes (token);
