-- 084: per-unit pricing for accounts that keep buildings.
--
-- A property manager, a portfolio manager or a building owner pays the flat
-- $99 a month until their buildings hold more than 80 units. Past that it is
-- $1.25 per OCCUPIED unit a month (never less than $99), monthly only, plus a
-- one-time setup fee sized to the portfolio. See app/shared/unitpricing.js.
--
-- TWO PASTES. The ALTER TABLE cannot be run twice, so it goes on its own; the
-- table below it is safe to run any number of times.
--
-- PASTE 1 of 2. How many of a building's units are lived in, typed by the
-- manager beside the total. NULL is "not said", which is billed as full and
-- said so on the billing screen: a blank cannot claim a vacancy.
ALTER TABLE properties ADD COLUMN occupied_units INTEGER;

-- PASTE 2 of 2. The setup fee, once per account. The primary key is what makes
-- it once: the row is written BEFORE Stripe is asked, so two presses, or a
-- sweep racing a checkout, find the row and charge nothing a second time.
-- `status` is pending (written, not yet on a Stripe invoice), invoiced (an
-- invoice item is waiting on the next bill), or paid_at_checkout (it was a
-- line on the first checkout). `stripe_ref` is the invoice item or the
-- checkout session that carries it.
CREATE TABLE IF NOT EXISTS account_setup_fees (
  account_id   TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  tier         TEXT NOT NULL,
  units        INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'invoiced', 'paid_at_checkout')),
  stripe_ref   TEXT,
  created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  charged_at   TEXT
);
