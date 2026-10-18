-- 090. Which of its own integrations an account has switched off.
--
-- ONE PASTE, safe to run any number of times: every statement is
-- IF NOT EXISTS.
--
-- Account -> Integrations lists what runs on the account's own credentials
-- (its API key for Zapier, Make and scripts; its CRM and inspection-app
-- webhooks) and gives each a switch. A row here is somebody answering that
-- switch. NO ROW MEANS ON, so everything that works today keeps working with
-- nothing backfilled. provider is an id from app/shared/integrations.js.
--
-- Until it is run, every integration reads as on and pressing a switch names
-- this file. Nothing else on any screen changes.
CREATE TABLE IF NOT EXISTS account_integrations (
  account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  provider    TEXT NOT NULL,
  enabled     INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  updated_at  TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_by  TEXT REFERENCES users(id),
  PRIMARY KEY (account_id, provider)
);
