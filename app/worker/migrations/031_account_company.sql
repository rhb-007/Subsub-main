-- An account is a company too.
--
-- Until now the two were different kinds of thing. An `account` is a tenant
-- of SubSub -- a subdomain, a plan, a team. A `company` is a contractor
-- business: the thing that gets engaged, issued a work order, and rated.
-- A general contractor was only ever the first, so there was nothing of
-- theirs to hire, nothing to look up, and nothing to put a QR code on.
--
-- Which is wrong about the trade. The same outfit sells siding to a
-- property manager on Tuesday and subs its gutters out on Wednesday, and
-- when a bigger general contractor wants them for a roof they have to be
-- typed in from scratch as though they had never heard of SubSub -- by
-- somebody who has to guess their licence number, while their own profile,
-- crews, coverage and insurance sit in the database already.
--
-- So every account gets a company row of its own, and the connect lookup,
-- the QR code and the connect requests all work against it exactly as they
-- do for a subcontractor. The id is derived from the account id rather than
-- random, so this migration says the same thing every time it is run and a
-- half-finished run can be finished.
--
--   npx wrangler d1 execute subsub-db --config=wrangler.toml \
--     --file=./worker/migrations/031_account_company.sql
--
-- Re-running it fails on the ALTER, which is first and on purpose: nothing
-- after it can run twice, and everything after it had already run.
ALTER TABLE accounts ADD COLUMN company_id TEXT REFERENCES companies(id);

-- One company row per account, named after it. Contact details are left
-- empty: they are what the account fills in to BE findable, and inventing
-- them here would put an address nobody chose in front of strangers.
INSERT OR IGNORE INTO companies (id, company)
  SELECT 'cmp_own_' || a.id, a.name FROM accounts a;

UPDATE accounts SET company_id = 'cmp_own_' || id WHERE company_id IS NULL;

-- Two accounts must never share one, and an account with none is allowed
-- while this is being run.
CREATE UNIQUE INDEX IF NOT EXISTS ux_accounts_company
  ON accounts (company_id) WHERE company_id IS NOT NULL;
