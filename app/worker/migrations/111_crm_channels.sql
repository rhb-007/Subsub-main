-- 111. Templates for texts and letters as well as email, and follow-ups on a
-- homeowner whether or not an estimate is booked. The rules are in
-- shared/crmsales.js.
--
-- TWO PASTES. The ALTER TABLE is the one statement that cannot be run twice,
-- so it goes on its own; the table after it is IF NOT EXISTS.

-- Paste 1. Every template so far is an email, which is the default.
ALTER TABLE crm_templates ADD COLUMN channel TEXT NOT NULL DEFAULT 'email';

-- Paste 2. A follow-up on a lead: an action item for a person, with what to
-- do, how (call, email, text, letter or visit) and when. A text or letter step
-- in a sequence lands here too (enrollment_id and template_id say which),
-- because SubSub cannot send a text or post a letter itself.
CREATE TABLE IF NOT EXISTS lead_followups (
  id            TEXT PRIMARY KEY,
  account_id    TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  lead_id       TEXT NOT NULL REFERENCES sales_leads(id) ON DELETE CASCADE,
  body          TEXT NOT NULL,
  channel       TEXT NOT NULL,
  due_date      TEXT NOT NULL,
  assignee_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
  enrollment_id TEXT,
  template_id   TEXT,
  done_at       TEXT,
  done_by       TEXT REFERENCES users(id) ON DELETE SET NULL,
  reminded_at   TEXT,
  created_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_lead_followups_due ON lead_followups(account_id, done_at, due_date);
CREATE INDEX IF NOT EXISTS ix_lead_followups_lead ON lead_followups(lead_id);
