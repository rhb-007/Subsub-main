-- Whether the subscription renews at the end of the period, or stops.
--
-- Stripe keeps a cancelling subscription's status at `active` right up to
-- the last day -- which is correct, because the customer is still entitled
-- to what they paid for -- so status alone cannot tell the two apart. Without
-- this column the app had to guess, and it guessed "renews", which is the
-- wrong way round: telling somebody who cancelled that they will be charged
-- again is a support ticket, and telling somebody who did not that their
-- access ends is worse.
ALTER TABLE accounts ADD COLUMN cancel_at_period_end INTEGER NOT NULL DEFAULT 0;
