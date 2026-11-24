-- 109. Contacting a CRM lead from SubSub: email, a text from your own phone,
-- a printed letter, a logged call or a note, all in one place -- the CRM
-- Inbox. The rules are in shared/leadcontact.js.
--
-- One paste. Two new tables and no ALTER TABLE, so running it twice does
-- nothing.

-- Every contact with a lead, both ways. channel is email, text, mail, call
-- or note. An outbound email carries the reply token its Reply-To was made
-- from, so a homeowner's answer lands back here as an inbound row. read_at is
-- for inbound rows: an answer nobody on the team has opened is the Inbox's
-- unread count. mailed_at is a printed letter somebody says went in the mail.
CREATE TABLE IF NOT EXISTS lead_messages (
  id           TEXT PRIMARY KEY,
  account_id   TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  lead_id      TEXT NOT NULL REFERENCES sales_leads(id) ON DELETE CASCADE,
  channel      TEXT NOT NULL,
  direction    TEXT NOT NULL DEFAULT 'outbound',
  subject      TEXT,
  body         TEXT,
  to_addr      TEXT,
  status       TEXT NOT NULL,
  error        TEXT,
  outcome      TEXT,
  reply_token  TEXT,
  sent_by      TEXT REFERENCES users(id) ON DELETE SET NULL,
  read_at      TEXT,
  mailed_at    TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_lead_messages_lead ON lead_messages(lead_id, created_at);
CREATE INDEX IF NOT EXISTS ix_lead_messages_account ON lead_messages(account_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS ux_lead_messages_token ON lead_messages(reply_token) WHERE reply_token IS NOT NULL;

-- Consent to follow up, asked of a lead directly. Until now it was asked only
-- when an appointment was booked, so a lead added by hand could never be
-- emailed. The newest answer on file wins, whether it came from here or from
-- an appointment.
CREATE TABLE IF NOT EXISTS sales_lead_consents (
  lead_id        TEXT PRIMARY KEY REFERENCES sales_leads(id) ON DELETE CASCADE,
  account_id     TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  email          INTEGER,
  phone          INTEGER,
  text           INTEGER,
  script_version TEXT,
  captured_by    TEXT,
  captured_at    TEXT NOT NULL
);
