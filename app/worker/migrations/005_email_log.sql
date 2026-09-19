-- Migration 005 — a record of what was actually sent.
--
--   npx wrangler d1 execute subsub-db --config=wrangler.toml \
--     --file=./worker/migrations/005_email_log.sql
--
-- "Did they get the email?" is the first question support asks, and the
-- provider's dashboard is a different system with its own retention. This is
-- the answer from the app's own side: who it went to, what it was, whether
-- Resend accepted it, and the provider id to look up if it did.
--
-- Bodies are not stored. They are reconstructible from the template plus the
-- rows, and keeping copies of every notice means keeping personal data with no
-- expiry story.

CREATE TABLE IF NOT EXISTS email_log (
  id           TEXT PRIMARY KEY,
  account_id   TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  company_id   TEXT REFERENCES companies(id) ON DELETE SET NULL,
  to_email     TEXT NOT NULL,
  kind         TEXT NOT NULL,          -- doc_request | wo_issued | application_received
  subject      TEXT NOT NULL,
  status       TEXT NOT NULL,          -- sent | failed
  provider_id  TEXT,                   -- Resend's id, for looking it up there
  error        TEXT,
  sent_by      TEXT REFERENCES users(id),
  at           TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_email_log_account_at ON email_log(account_id, at DESC);
CREATE INDEX IF NOT EXISTS idx_email_log_company ON email_log(company_id, at DESC);
