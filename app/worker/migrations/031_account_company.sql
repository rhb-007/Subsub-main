-- A general contractor is a company too.
--
-- Until now an `account` and a `company` were different kinds of thing. An
-- account is a tenant of SubSub -- a subdomain, a plan, a team. A company is
-- a contractor business: the thing that gets engaged, issued a work order,
-- and rated. A general contractor was only ever the first, so there was
-- nothing of theirs to hire, nothing to look up, and nothing to put a QR
-- code on.
--
-- Which is wrong about the trade. The same outfit sells siding to a property
-- manager on Tuesday and subs its gutters out on Wednesday, and when a
-- bigger general contractor wants them for a roof they have to be typed in
-- from scratch -- by somebody guessing at a licence number that is already
-- in this database, while their crews, coverage and insurance sit here
-- unread.
--
-- GENERAL CONTRACTORS ONLY. A property manager, a portfolio manager and a
-- building owner hire; they are not hired. Giving them a company row would
-- be giving them a QR code and a listing for something they will never do,
-- and one careless join away from putting a landlord on somebody's
-- subcontractor roster. An account that changes its kind to general
-- contractor later gets its row then, from the app.
--
--   npx wrangler d1 execute subsub-db --config=wrangler.toml --remote \
--     --file=./worker/migrations/031_account_company.sql
--
-- Re-running it fails on the ALTER, which is first and on purpose: nothing
-- after it can run twice, and everything after it had already run.
ALTER TABLE accounts ADD COLUMN company_id TEXT REFERENCES companies(id);

-- One company row per general contractor, named after the account. The id is
-- derived from the account id rather than random, so this says the same
-- thing every time it runs and a half-finished run can be finished.
--
-- Contact details are left empty on purpose: they are what an account fills
-- in to BE findable, and inventing an address nobody chose and putting it in
-- front of strangers is not a migration's business.
INSERT OR IGNORE INTO companies (id, company)
  SELECT 'cmp_own_' || a.id, a.name
    FROM accounts a
   WHERE a.kind = 'general_contractor';

UPDATE accounts SET company_id = 'cmp_own_' || id
 WHERE company_id IS NULL AND kind = 'general_contractor';

-- Two accounts must never share one. Partial, because most accounts have
-- none and NULL is the ordinary case rather than an error.
CREATE UNIQUE INDEX IF NOT EXISTS ux_accounts_company
  ON accounts (company_id) WHERE company_id IS NOT NULL;
