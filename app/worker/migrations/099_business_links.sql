-- 099. A second business on one login.
--
-- A general contractor that also manages buildings runs two accounts, one of
-- each kind, with one person admin on both. This row is what says the two
-- belong together: it is what the account switcher labels, what the
-- management side's connection to the construction side came from, and what
-- the 50% discount on the cheaper of the two is read off.
--
-- One pair per account. An account is in at most one row, either side: a
-- chain of three would discount two businesses against one subscription.
--
-- `discount_on` is which account Stripe is currently discounting, or NULL.
-- It records what WE told Stripe, so the sync only changes a subscription
-- when the answer changes.
--
-- One paste, and it can be run twice.
CREATE TABLE IF NOT EXISTS business_links (
  id           TEXT PRIMARY KEY,
  account_a    TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  account_b    TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by   TEXT,
  created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  discount_on  TEXT,
  discount_at  TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_business_links_a ON business_links(account_a);
CREATE UNIQUE INDEX IF NOT EXISTS ux_business_links_b ON business_links(account_b);
