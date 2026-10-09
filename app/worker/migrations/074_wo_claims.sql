-- 074. "SENT VIA SUBSUB" ON EVERY WORK ORDER, AND WHO BROUGHT WHICH SUB IN.
--
-- Every work order a hiring account sends carries a claim link,
-- /claim/<token>, naming that work order and through it the subcontractor and
-- the account that sent it. The sub opens it on a phone, reads the work
-- order, and makes a free login with their mobile and a texted code.
--
-- Two tables and no ALTER TABLE, for the reason 048, 057 and 063 give: ADD
-- COLUMN cannot be run twice, so this paste can.
--
-- wo_claim_links is ONE ROW PER WORK ORDER. The token is 32 random bytes,
-- never derived from anything about the work order, the company or the clock,
-- which is the same rule the pack, the invite and the waiver links follow:
-- nothing on the page is addressable by an id. account_id and company_id are
-- STAMPED at issue rather than read through the work order later, because
-- "which account sent this sub this link" must survive the work order being
-- reissued or voided. A row exists from the moment the work order goes out,
-- so a count of rows per account is "work orders sent"; first_opened_at says
-- the link was opened at all and open_count how often.
--
-- sub_attributions is ONE ROW PER COMPANY, keyed on the company, and the
-- first claim wins. "Which account brought this sub onto SubSub" has one
-- answer, and a second account's work order reaching somebody already on
-- SubSub is a sign-in, not a second recruitment. Written only for a company
-- that had no login anywhere before the claim.

CREATE TABLE IF NOT EXISTS wo_claim_links (
  token             TEXT PRIMARY KEY,
  work_order_id     TEXT NOT NULL UNIQUE REFERENCES work_orders(id) ON DELETE CASCADE,
  account_id        TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  company_id        TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  created_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  first_opened_at   TEXT,
  last_opened_at    TEXT,
  open_count        INTEGER NOT NULL DEFAULT 0,
  claimed_at        TEXT,
  claimed_user_id   TEXT REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS ix_wo_claim_links_account ON wo_claim_links(account_id);
CREATE INDEX IF NOT EXISTS ix_wo_claim_links_company ON wo_claim_links(company_id);

CREATE TABLE IF NOT EXISTS sub_attributions (
  company_id     TEXT PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  account_id     TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  work_order_id  TEXT REFERENCES work_orders(id) ON DELETE SET NULL,
  token          TEXT,
  user_id        TEXT REFERENCES users(id) ON DELETE SET NULL,
  claimed_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_sub_attributions_account ON sub_attributions(account_id);
