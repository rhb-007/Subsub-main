-- 106. CRM / Sales: consent to follow up, and the activity on an appointment.
-- shared/salescrm.js holds the rules.
--
-- One paste. Two new tables and no ALTER TABLE, so running it twice does
-- nothing. Until it is pasted, booking still works and the reply says the
-- consent was not kept; the activity panel names this file.

-- What the homeowner said they may be contacted by, in the script's words
-- (script_version), when and by whom. 1 is yes, 0 is no. record_call NULL
-- means nobody asked, which is not the same as no.
CREATE TABLE IF NOT EXISTS sales_consents (
  appointment_id    TEXT PRIMARY KEY REFERENCES sales_appointments(id) ON DELETE CASCADE,
  account_id        TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  email             INTEGER NOT NULL,
  phone             INTEGER NOT NULL,
  text              INTEGER NOT NULL,
  record_call       INTEGER,
  script_version    TEXT NOT NULL,
  captured_by       TEXT REFERENCES users(id) ON DELETE SET NULL,
  captured_at       TEXT NOT NULL,
  reminder_sent_for TEXT
);
CREATE INDEX IF NOT EXISTS ix_sales_consents_account ON sales_consents(account_id);

-- A note, a logged call, a follow-up, or a call recording. Append-only apart
-- from a follow-up being ticked done.
CREATE TABLE IF NOT EXISTS sales_activities (
  id              TEXT PRIMARY KEY,
  account_id      TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  appointment_id  TEXT NOT NULL REFERENCES sales_appointments(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL,
  body            TEXT,
  direction       TEXT,
  outcome         TEXT,
  channel         TEXT,
  due_date        TEXT,
  assignee_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  done_at         TEXT,
  done_by         TEXT REFERENCES users(id) ON DELETE SET NULL,
  file_key        TEXT,
  file_name       TEXT,
  file_type       TEXT,
  file_size       INTEGER,
  record_consent  INTEGER,
  reminded_at     TEXT,
  created_by      TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_sales_activities_appt ON sales_activities(appointment_id, created_at);
CREATE INDEX IF NOT EXISTS ix_sales_activities_due ON sales_activities(account_id, kind, due_date);
