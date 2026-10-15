-- 086. The units a property manager, portfolio manager or building owner told
-- us at signup, so Scale is priced per unit from the first bill.
--
-- ONE PASTE, safe to run any number of times.
--
-- An account signing up has no buildings in SubSub yet. Without this a 500-unit
-- portfolio checked out at the flat $99 (or a whole year at $990) on day one,
-- and the per-unit price arrived only once every building had been typed in.
-- The signup form now asks for the units and the occupied count; the checkout
-- and the monthly sync price the account on that answer UNTIL a building
-- carries a unit count, and from then on the buildings decide. See
-- pricingRows in app/shared/unitpricing.js.
--
-- Its own table rather than two columns on accounts, because ADD COLUMN is the
-- one statement that cannot be run twice. occupied_units NULL means not given,
-- which is counted as full, the same rule as a building.
CREATE TABLE IF NOT EXISTS portfolio_estimates (
  account_id     TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  total_units    INTEGER NOT NULL CHECK (total_units >= 0),
  occupied_units INTEGER CHECK (occupied_units IS NULL
                   OR (occupied_units >= 0 AND occupied_units <= total_units)),
  source         TEXT NOT NULL DEFAULT 'signup',
  created_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
