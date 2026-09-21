-- Where an account's branded hostname got to.
--
-- Provisioning it is two calls to Cloudflare that can each fail for reasons
-- nobody filling in a signup form can do anything about, so it happens after
-- the response and records its own outcome here. Without that, a failure is
-- invisible until a customer opens the address they were sold and finds
-- nothing -- which is exactly how it behaved before.
--
--   NULL          never attempted (a Basic account, or Cloudflare unconfigured)
--   'pending'     registered, certificate not issued yet
--   'active'      live; the customer can open it
--   'failed'      Cloudflare refused; hostname_error says what it said
--   'removed'     deliberately taken down (downgrade, or account deleted)
ALTER TABLE accounts ADD COLUMN hostname_status TEXT;

-- Cloudflare's own words, kept verbatim. A paraphrase is not something
-- support can search for.
ALTER TABLE accounts ADD COLUMN hostname_error TEXT;

-- When we last asked. The nightly sweep uses it to leave alone what it
-- already checked, and the console uses it to say how fresh the answer is.
ALTER TABLE accounts ADD COLUMN hostname_checked_at TEXT;
