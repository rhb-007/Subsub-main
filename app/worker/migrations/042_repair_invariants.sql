-- 042 — repair the three invariants CHECK.sql flagged.
--
-- Not a schema change. CHECK.sql carries three counts that must read zero, and
-- all three read 1: a building with no owner, a non-hireable account still
-- holding a company row, and a general contractor holding none. The routes that
-- wrote those rows are fixed, so this is the existing data only. Running it
-- twice is harmless -- every statement is a no-op once it has run.
--
-- RUN THE DIAGNOSTIC FIRST. Part 2 is the only one that can be wrong for a
-- real account, and it says so rather than guessing.

------------------------------------------------------------------------------
-- DIAGNOSTIC — paste this on its own first and read the answer.
------------------------------------------------------------------------------

-- Which buildings have no owner.
SELECT 'unowned' AS problem, p.id, p.name, a.name AS operated_by
  FROM properties p JOIN accounts a ON a.id = p.account_id
 WHERE p.owner_account_id IS NULL;

-- Which accounts hold a company row they should not, and whether anybody
-- hires them. A row with hired_by > 0 is NOT repaired below: clearing the
-- link would leave live engagements pointing at a company no account answers
-- for, and the contractor on the other end would never be told.
SELECT 'company row on a non-contractor' AS problem, a.id, a.name, a.kind,
       a.company_id,
       (SELECT COUNT(*) FROM engagements e
         WHERE e.company_id = a.company_id AND e.status <> 'ended') AS hired_by
  FROM accounts a
 WHERE a.kind <> 'general_contractor' AND a.company_id IS NOT NULL;

-- Which general contractors have no company row, so cannot be looked up,
-- cannot be asked to connect, and have no code to show.
SELECT 'contractor with no company row' AS problem, a.id, a.name, a.subdomain
  FROM accounts a
 WHERE a.kind = 'general_contractor' AND a.company_id IS NULL;

------------------------------------------------------------------------------
-- PART 1 — every building is owned by whoever operates it.
--
-- The same truthful backfill 039 did. For a row nobody ever declared
-- otherwise, the account holding the building is the only answer the data
-- supports, and it is what the screens have been showing all along
-- (propertyWithOwner coalesces to account_id on the way out) -- so this
-- changes no screen, it makes handover and appointing possible at all.
------------------------------------------------------------------------------

UPDATE properties SET owner_account_id = account_id WHERE owner_account_id IS NULL;

------------------------------------------------------------------------------
-- PART 2 — a company row does not outlive being hireable.
--
-- Only where nobody hires them. An account with live engagements is left
-- exactly as it is and stays in the diagnostic above: that is a conversation
-- with their clients, not a statement to run.
--
-- The companies row itself is left in place. It is unreachable once nothing
-- points at it -- no account, and engagements is what /api/clients reads --
-- and deleting it would take company_docs, doc_shares and any historic
-- engagement with it, which is the audit trail this product keeps on purpose.
------------------------------------------------------------------------------

UPDATE accounts SET company_id = NULL
 WHERE kind <> 'general_contractor'
   AND company_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM engagements e
                    WHERE e.company_id = accounts.company_id
                      AND e.status <> 'ended');

------------------------------------------------------------------------------
-- PART 3 — every general contractor is a company.
--
-- Derived id, the same one ensureAccountCompany mints, so this is the same
-- row the app would have created and never a second one.
------------------------------------------------------------------------------

INSERT OR IGNORE INTO companies (id, company)
  SELECT 'cmp_own_' || a.id, a.name
    FROM accounts a
   WHERE a.kind = 'general_contractor' AND a.company_id IS NULL;

UPDATE accounts SET company_id = 'cmp_own_' || id
 WHERE kind = 'general_contractor' AND company_id IS NULL;
