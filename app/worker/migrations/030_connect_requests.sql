-- Connecting to a contractor who is already on SubSub.
--
-- Two things arrive here, and they are the same thing underneath.
--
-- A general contractor types a subcontractor's email or licence into the
-- add-a-contractor form, and that company is already on SubSub -- working
-- for two other accounts, with its trades, crews, coverage, insurance and
-- bond already filled in and verified. Until now the form made them type
-- the whole profile again, and the server quietly reused the existing
-- company at the end without telling anybody. Worse than the retyping: the
-- engagement appeared with no word to the contractor at all.
--
-- And a subcontractor standing in front of a general contractor wants to
-- be added without spelling out an email address. They show the QR code in
-- their portal, it is scanned, and the same thing happens.
--
-- Both now create a REQUEST that the contractor answers. The reason is
-- that connecting is not the hiring account's to grant: it hands over that
-- contractor's documents, crews and availability to a company they may
-- never have heard of. An engagement is created only when they accept.
CREATE TABLE IF NOT EXISTS connect_requests (
  id            TEXT PRIMARY KEY,
  account_id    TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  company_id    TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','accepted','declined','cancelled')),
  -- How it was started, so the contractor can see whether they showed
  -- somebody a code or whether a stranger typed their address in.
  via           TEXT NOT NULL DEFAULT 'lookup' CHECK (via IN ('lookup','code')),
  requested_by  TEXT REFERENCES users(id),
  message       TEXT,
  created_at    TEXT DEFAULT CURRENT_TIMESTAMP,
  responded_at  TEXT
);

-- One LIVE request per pair. A partial index rather than a plain UNIQUE,
-- because a contractor who declined in March must be askable again in
-- September, and a plain unique constraint would make the first refusal
-- permanent.
CREATE UNIQUE INDEX IF NOT EXISTS ux_connect_pending
  ON connect_requests (account_id, company_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS ix_connect_company ON connect_requests (company_id, status);
CREATE INDEX IF NOT EXISTS ix_connect_account ON connect_requests (account_id, status);

-- The contractor's own code, which is what their QR encodes. Nullable and
-- minted on first use: every company on SubSub predates this column, and
-- backfilling random codes in a migration would mean a code nobody chose
-- and nobody can be told about.
--
-- It is a credential of a sort -- holding it lets you ASK -- so it is
-- rotatable, and the index keeps two companies from ever sharing one.
ALTER TABLE companies ADD COLUMN connect_code TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS ux_company_connect_code
  ON companies (connect_code) WHERE connect_code IS NOT NULL;
