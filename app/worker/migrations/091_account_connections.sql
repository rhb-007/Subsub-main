-- 091. An account's connection to an outside system it reads from.
--
-- ONE PASTE, safe to run any number of times: every statement is
-- IF NOT EXISTS.
--
-- The first is CompanyCam: an admin pastes the account's CompanyCam access
-- token in Account -> Integrations, and the job form can then import that
-- account's project photos and documents as measurement documents.
--
-- secret_enc is the token SEALED (AES-GCM under the Worker secret
-- INTEGRATION_SECRET_KEY, app/worker/secretbox.js). It is never stored in the
-- clear and never sent back to a browser. label is what the outside system
-- calls the account (CompanyCam's company name), so the panel can say which
-- account is connected without anybody reading the token.
--
-- One row per account per provider: connecting again replaces it, and
-- disconnecting deletes it. Until this is run, connecting answers
-- migration_needed naming this file and nothing else changes.
CREATE TABLE IF NOT EXISTS account_connections (
  account_id    TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  provider      TEXT NOT NULL,
  secret_enc    TEXT NOT NULL,
  label         TEXT,
  connected_at  TEXT DEFAULT CURRENT_TIMESTAMP,
  connected_by  TEXT REFERENCES users(id),
  last_ok_at    TEXT,
  last_error    TEXT,
  PRIMARY KEY (account_id, provider)
);
