-- Migration 046 — the subcontractor account kind.
--
-- Every account kind before this one HIRES. The send-your-compliance-pack loop
-- is aimed at the company being hired, and in a product with no directory it is
-- the only flywheel there is -- so a roofer following it arrived at a signup
-- form offering four ways to describe a business, all four of which hire.
-- "General contractor" was the only one that produced a hireable account, so
-- that is what they had to pick, and from then on the staff console, the
-- account switcher and their own branded sign-in page all called a roofing
-- company a general contractor.
--
-- MOST DATABASES NEED NOTHING FROM THIS FILE, and that is the point of reading
-- it before running it.
--
-- `accounts.kind` was added by migration 003 as plain TEXT, deliberately:
--
--   "The CHECK constraint is deliberately omitted: adding one to an existing
--    table needs a full table rebuild, and the API validates the value anyway."
--
-- So a database grown through the migrations in order has NO constraint on
-- `kind`, and the new value stores with nothing run at all. Only a database
-- created from `worker/schema.sql` -- a fresh install, or a rebuilt one --
-- carries the CHECK, and there the new value is refused with
--
--   CHECK constraint failed: kind IN ('general_contractor','property_manager',...)
--
-- which surfaces to whoever is signing up as `signup_conflict`, a 409, and no
-- account. Silent until the first subcontractor tries.
--
-- WHICH ONE IS IN FRONT OF YOU. Run CHECK.sql and read `m046_kind_check`:
--
--   0  no constraint on `kind`. Nothing to do. Stop here.
--   1  the OLD constraint, which refuses 'subcontractor'. Run the rebuild below.
--   2  already widened. Nothing to do.
--
-- Do not run the rebuild "just in case": it recreates a table.
--
-- ---------------------------------------------------------------------------
-- THE REBUILD, only if m046_kind_check reads 1.
--
-- SQLite cannot alter a CHECK constraint, so the table is copied. This is the
-- official 12-step recipe (sqlite.org/lang_altertable.html) and the order
-- matters: foreign keys OFF first, or every row that points at `accounts` is
-- rewritten or rejected as the old table goes.
--
-- Paste the whole block at once. It is one transaction -- if any statement
-- fails the ROLLBACK leaves the database exactly as it was, which is why this
-- one does not follow the usual "one statement per paste" rule.
--
-- `SELECT *` is deliberate. Listing columns by name means this file goes stale
-- the next time a migration adds one, and a column left out of an INSERT is
-- data silently dropped.

PRAGMA foreign_keys = OFF;

BEGIN TRANSACTION;

CREATE TABLE accounts_new AS SELECT * FROM accounts;

DROP TABLE accounts;

ALTER TABLE accounts_new RENAME TO accounts;

COMMIT;

PRAGMA foreign_keys = ON;

-- What that leaves you, and what it costs.
--
-- `CREATE TABLE ... AS SELECT` keeps every column and every row and drops
-- everything else: the PRIMARY KEY, the UNIQUE on `subdomain`, the DEFAULTs,
-- the NOT NULLs and all five CHECK constraints -- the one on `kind` among them,
-- which is the whole object of the exercise.
--
-- That is a deliberate trade and it is worth stating plainly rather than
-- pretending otherwise. The alternative is restating the entire accounts table
-- here, which means this file has to be edited every time a migration touches
-- it, and a stale copy would silently drop whatever it had not heard about.
-- Migration 003 already decided which side of that trade this schema is on:
-- the API validates `kind` against ACCOUNT_KINDS on every write, and
-- `validSubdomain` plus the signup route's own conflict handling cover the
-- uniqueness. After this the live shape matches what 003 intended all along.
--
-- Put the index back, because that one is not a constraint and is not optional:
-- `GET /api/account-by-subdomain/:s` is on the public route list and runs on
-- every branded page load.

CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_subdomain ON accounts(subdomain);

-- Then confirm: CHECK.sql's `m046_kind_check` should read 0, and
-- `m046_subdomain_unique` should read 1.
