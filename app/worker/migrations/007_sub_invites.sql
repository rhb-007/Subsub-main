-- One-time invite links a customer generates and sends themselves.
--
-- The public application form at a customer's own subdomain is a Scale
-- feature: it is always on and a contractor can find it unprompted. This is
-- the Basic equivalent and deliberately weaker -- the customer has to hand
-- out each link, one contractor at a time -- so the two do not collapse into
-- the same thing.
--
-- The token is the credential. It is the only thing standing between a
-- stranger and a row in someone's contractor list, so it is generated from
-- crypto.getRandomValues, expires, and is spent on first use.
CREATE TABLE sub_invites (
  id          TEXT PRIMARY KEY,
  account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  token       TEXT UNIQUE NOT NULL,
  -- Who it was meant for, so a list of outstanding links is readable. Not
  -- enforced against what the applicant then types: a link passed on to the
  -- right person at the wrong company is still a real application.
  label       TEXT,
  created_by  TEXT REFERENCES users(id),
  created_at  TEXT DEFAULT CURRENT_TIMESTAMP,
  expires_at  TEXT NOT NULL,
  -- Set on use. A spent invite is kept rather than deleted: the customer's
  -- list should be able to say "accepted", not just go quiet.
  used_at     TEXT,
  company_id  TEXT REFERENCES companies(id),
  revoked_at  TEXT
);
CREATE INDEX idx_sub_invites_account ON sub_invites(account_id, created_at DESC);
