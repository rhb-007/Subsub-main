-- 071. AN ACCOUNT'S OWN FEE TERMS, SET FROM THE STAFF CONSOLE.
--
-- SubSub's fee on a payment it moves defaults to 0.05%, at most $500 a
-- payment, with the first $50,000 an account sends through SubSub free
-- (app/shared/fee.js). Staff can set a different rate, cap or free allowance
-- for one account -- a negotiated deal, a design partner -- and this is where
-- that lives.
--
-- A ROW ONLY WHERE SOMETHING DIFFERS. No row means the defaults, so every
-- account that exists today is unaffected and there is no backfill. Each
-- figure falls back on its own when NULL, so lowering the rate for somebody
-- keeps their cap and free allowance.
--
-- WHO SET IT AND WHEN, because a rate nobody can explain becomes permanent --
-- the same reason a comp carries a note.
--
-- STAMPED, NEVER READ BACK INTO THE PAST. A release carries the fee it was
-- charged; changing these changes what later payments are charged, and
-- nothing already paid moves.
--
-- No ALTER TABLE, so it can be run more than once.

CREATE TABLE IF NOT EXISTS account_fee_terms (
  account_id  TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  fee_bps     INTEGER,
  cap_cents   INTEGER,
  free_cents  INTEGER,
  note        TEXT,
  updated_by  TEXT,
  updated_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
