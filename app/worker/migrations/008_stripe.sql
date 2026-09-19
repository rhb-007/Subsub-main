-- Stripe linkage. Stripe stays the source of truth for money; these columns
-- are a local cache of what it last told us, so the app can decide what a
-- customer may do without a round trip on every request.
ALTER TABLE accounts ADD COLUMN stripe_customer_id TEXT;
ALTER TABLE accounts ADD COLUMN stripe_subscription_id TEXT;
-- Stripe's own vocabulary, kept verbatim rather than mapped: trialing,
-- active, past_due, canceled, incomplete, incomplete_expired, unpaid. NULL
-- means nobody has ever subscribed, which is not the same as canceled.
ALTER TABLE accounts ADD COLUMN subscription_status TEXT;
-- When the paid period runs out. A canceled subscription keeps working until
-- this passes, which is what the customer was sold.
ALTER TABLE accounts ADD COLUMN current_period_end TEXT;

CREATE INDEX idx_accounts_stripe_customer ON accounts(stripe_customer_id);

-- Stripe retries a webhook until it gets a 2xx, and will happily deliver the
-- same event twice on its own. Every handler here writes something, so
-- "have I seen this event id" is the difference between one upgrade and
-- three subscription_events rows saying so.
CREATE TABLE stripe_events (
  id           TEXT PRIMARY KEY,     -- Stripe's event id (evt_...)
  type         TEXT NOT NULL,
  received_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
