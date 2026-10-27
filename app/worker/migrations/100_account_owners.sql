-- 100. One owner per account.
--
-- An account may have any number of admins, and they are all equal except in
-- one way: the OWNER is the admin nobody else can remove or demote, and the
-- one who may remove or demote other admins and hand ownership on. Without it
-- a departing employee holding admin had the same control as the person who
-- started the company, and the customer-side role control would demote an
-- account's last admin.
--
-- The owner is always an admin of the account. Billing stays open to every
-- admin, by decision.
--
-- Filled in for every account that exists: its earliest admin. One paste, and
-- it can be run twice.
CREATE TABLE IF NOT EXISTS account_owners (
  account_id  TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id),
  set_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  set_by      TEXT,
  note        TEXT
);

INSERT OR IGNORE INTO account_owners (account_id, user_id, note)
SELECT m.account_id, m.user_id, 'earliest admin (100)'
  FROM memberships m
 WHERE m.role = 'admin'
   AND NOT EXISTS (
     SELECT 1 FROM memberships o
      WHERE o.account_id = m.account_id AND o.role = 'admin'
        AND (COALESCE(o.created_at, '') < COALESCE(m.created_at, '')
             OR (COALESCE(o.created_at, '') = COALESCE(m.created_at, '') AND o.rowid < m.rowid)));
