-- 110. The CRM's selling half: what an estimate is worth and why one was lost,
-- a homeowner's way out of our email and the office's Do not contact flag,
-- saved email templates, and short follow-up sequences. The rules are in
-- shared/crmsales.js.
--
-- One paste. Six new tables and no ALTER TABLE, so running it twice does
-- nothing.

-- One per estimate. amount_cents is what it is quoted (or sold) at;
-- expected_close is when it should close; lost_reason is one of
-- LOST_REASONS and is kept only while the estimate is marked not sold.
CREATE TABLE IF NOT EXISTS sales_deals (
  appointment_id TEXT PRIMARY KEY REFERENCES sales_appointments(id) ON DELETE CASCADE,
  account_id     TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  amount_cents   INTEGER,
  expected_close TEXT,
  lost_reason    TEXT,
  lost_note      TEXT,
  updated_by     TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_sales_deals_account ON sales_deals(account_id);

-- A lead's opt-out. unsubscribed_at is the homeowner pressing the link in an
-- email; dnc_at is the office marking them Do not contact.
CREATE TABLE IF NOT EXISTS lead_opt_outs (
  lead_id         TEXT PRIMARY KEY REFERENCES sales_leads(id) ON DELETE CASCADE,
  account_id      TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  unsubscribed_at TEXT,
  dnc_at          TEXT,
  dnc_by          TEXT REFERENCES users(id) ON DELETE SET NULL,
  dnc_reason      TEXT,
  updated_at      TEXT NOT NULL
);

-- The token in every email's unsubscribe link: one per lead, random, never
-- derived from anything about them.
CREATE TABLE IF NOT EXISTS lead_unsub_tokens (
  token      TEXT PRIMARY KEY,
  lead_id    TEXT NOT NULL REFERENCES sales_leads(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_lead_unsub_tokens_lead ON lead_unsub_tokens(lead_id);

-- The account's own email templates. The starters are in code.
CREATE TABLE IF NOT EXISTS crm_templates (
  id         TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  subject    TEXT NOT NULL,
  body       TEXT NOT NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_crm_templates_account ON crm_templates(account_id);

-- A sequence: steps is a JSON list of {day, templateId}.
CREATE TABLE IF NOT EXISTS crm_sequences (
  id              TEXT PRIMARY KEY,
  account_id      TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  steps           TEXT NOT NULL,
  stop_on_booking INTEGER NOT NULL DEFAULT 1,
  active          INTEGER NOT NULL DEFAULT 1,
  created_by      TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_crm_sequences_account ON crm_sequences(account_id);

-- A lead on a sequence. next_step is the index of the next email; next_at is
-- when it is due. One running per lead, held by the partial index.
CREATE TABLE IF NOT EXISTS crm_enrollments (
  id             TEXT PRIMARY KEY,
  account_id     TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  lead_id        TEXT NOT NULL REFERENCES sales_leads(id) ON DELETE CASCADE,
  sequence_id    TEXT NOT NULL REFERENCES crm_sequences(id) ON DELETE CASCADE,
  start_stage    TEXT,
  enrolled_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  started_at     TEXT NOT NULL,
  next_step      INTEGER NOT NULL DEFAULT 0,
  next_at        TEXT,
  sent_count     INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'active',
  stopped_reason TEXT,
  stopped_at     TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_crm_enrollments_live ON crm_enrollments(lead_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS ix_crm_enrollments_due ON crm_enrollments(status, next_at);
