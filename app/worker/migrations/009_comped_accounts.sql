-- A complimentary account: Scale features, no payment.
--
-- Derivable in principle (plan = scale with no Stripe subscription), but
-- stored explicitly because it has to outrank Stripe rather than be inferred
-- from its absence. Without the flag, a webhook arriving for an unrelated
-- reason would quietly move a comped customer back to Basic, and nobody
-- would know why.
ALTER TABLE accounts ADD COLUMN comped INTEGER NOT NULL DEFAULT 0;
-- Who authorised it and why. A comp with no reason attached becomes
-- permanent by default, because nobody can tell whether it still applies.
ALTER TABLE accounts ADD COLUMN comp_note TEXT;
