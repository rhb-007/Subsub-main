-- "Send my documents to a contractor."
--
-- Every subcontractor on SubSub is asked for the same four things several
-- times a month -- certificate of insurance, surety bond, signed agreement,
-- W-9 -- by general contractors who mostly are not on SubSub. Today they
-- answer by attaching PDFs to an email, one contractor at a time, and every
-- copy starts going stale the moment it is sent.
--
-- This is the same act, done once and kept current. The subcontractor types
-- the address of somebody who just asked them for paperwork; that person gets
-- a page showing what is on file, with the carrier, the policy number, the
-- coverage and -- the part an emailed PDF can never do -- the expiry, live.
--
-- WHY IT IS ALSO THE GROWTH LOOP. Every other way into SubSub needs the
-- hiring side to already be here: they look a contractor up, or they scan a
-- code, both of which need an account first. So supply could never bring
-- demand in, which in a product with no directory is the only flywheel
-- available. This is the one path where a free subcontractor hands something
-- genuinely useful to a general contractor who has never heard of us, doing a
-- chore they were going to do anyway.
--
-- THE SHAPE IS DELIBERATE, and shared/docshare.js holds the rules:
--
--   One recipient, one token. Not a public URL -- a link addressed to the
--   person they typed, which expires, and which they can revoke.
--
--   It is their OWN data, sent to one whole address they already had. No
--   search, no enumeration, nothing about anybody else. The same line the
--   connect lookup draws, from the other side of it.
--
--   The W-9 is NOT in the link. It carries a TIN, and for a sole proprietor
--   that is a social security number. The page says it is on file; reading it
--   needs an account. That is the one deliberate piece of friction here and
--   it sits exactly where the recipient is getting something anyway.
--
-- The view count is a count and a date, like every other roll-up here. The
-- subcontractor seeing that their pack was opened twice is most of the value
-- of having sent it through SubSub rather than as an attachment.
CREATE TABLE IF NOT EXISTS doc_shares (
  id             TEXT PRIMARY KEY,
  -- The secret in the link. Long, random, unique, and never derived from
  -- anything guessable about the company or the recipient.
  token          TEXT NOT NULL UNIQUE,
  company_id     TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  sent_by        TEXT REFERENCES users(id),
  -- Who it was addressed to. Kept so the subcontractor can see what they
  -- sent where, and so a second send to the same address can replace the
  -- first rather than leaving two live links.
  to_email       TEXT NOT NULL,
  to_name        TEXT,
  note           TEXT,
  created_at     TEXT DEFAULT CURRENT_TIMESTAMP,
  -- Not forever. A link that outlives the conversation it was sent for is a
  -- copy of somebody's insurance certificate loose on the internet.
  expires_at     TEXT NOT NULL,
  revoked_at     TEXT,
  -- A count and a date, never a log of who read what from where.
  view_count     INTEGER NOT NULL DEFAULT 0,
  last_viewed_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_doc_shares_company ON doc_shares (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_doc_shares_token ON doc_shares (token);
