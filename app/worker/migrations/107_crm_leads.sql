-- 107. CRM leads: everybody the account is trying to sell to, and the stage
-- they are at. shared/leads.js holds the rules.
--
-- One paste. Two new tables and no ALTER TABLE, so running it twice does
-- nothing. Until it is pasted, the CRM's Leads and Dashboard name this file
-- and appointments book exactly as before.

-- One person per row, matched on the account by phone. stage is one of
-- lead, prospect, opportunity, customer, former. stage_at is when it last
-- moved, so "customers this month" can be read without the event log.
CREATE TABLE IF NOT EXISTS sales_leads (
  id          TEXT PRIMARY KEY,
  account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  stage       TEXT NOT NULL DEFAULT 'lead',
  first_name  TEXT,
  last_name   TEXT,
  phone       TEXT,
  email       TEXT,
  street      TEXT,
  city        TEXT,
  state       TEXT,
  zip         TEXT,
  services    TEXT NOT NULL DEFAULT '[]',
  source      TEXT,
  notes       TEXT,
  owner_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  stage_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_sales_leads_account ON sales_leads(account_id, stage);
CREATE INDEX IF NOT EXISTS ix_sales_leads_phone ON sales_leads(account_id, phone);

-- Which lead an appointment belongs to. A table rather than a column on
-- sales_appointments, so this is one paste with no ALTER TABLE.
CREATE TABLE IF NOT EXISTS sales_lead_links (
  appointment_id TEXT PRIMARY KEY REFERENCES sales_appointments(id) ON DELETE CASCADE,
  lead_id        TEXT NOT NULL REFERENCES sales_leads(id) ON DELETE CASCADE,
  account_id     TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  linked_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_sales_lead_links_lead ON sales_lead_links(lead_id);
