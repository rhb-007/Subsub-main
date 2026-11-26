-- 113. The rest of the CRM. One paste, every statement IF NOT EXISTS, no
-- ALTER TABLE, so running it twice does nothing. shared/crmplus.js holds the
-- rules for all of it.

-- 6. A proposal a homeowner opens from a link and signs. The token is the
-- link; the hash is of the text they were shown, recomputed at signing.
CREATE TABLE IF NOT EXISTS sales_proposals (
  id             TEXT PRIMARY KEY,
  account_id     TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  lead_id        TEXT NOT NULL REFERENCES sales_leads(id) ON DELETE CASCADE,
  appointment_id TEXT REFERENCES sales_appointments(id) ON DELETE SET NULL,
  token          TEXT NOT NULL,
  title          TEXT NOT NULL,
  items          TEXT NOT NULL,
  total_cents    INTEGER NOT NULL,
  notes          TEXT,
  status         TEXT NOT NULL DEFAULT 'draft',
  sent_at        TEXT,
  viewed_at      TEXT,
  signed_at      TEXT,
  signer_name    TEXT,
  signed_hash    TEXT,
  declined_at    TEXT,
  decline_note   TEXT,
  expires_at     TEXT,
  created_by     TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_sales_proposals_token ON sales_proposals(token);
CREATE INDEX IF NOT EXISTS ix_sales_proposals_lead ON sales_proposals(lead_id);

-- 7. An insurance claim on a lead.
CREATE TABLE IF NOT EXISTS lead_claims (
  lead_id          TEXT PRIMARY KEY REFERENCES sales_leads(id) ON DELETE CASCADE,
  account_id       TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  status           TEXT NOT NULL DEFAULT 'not_filed',
  carrier          TEXT,
  claim_number     TEXT,
  adjuster_name    TEXT,
  adjuster_phone   TEXT,
  adjuster_meeting TEXT,
  approved_cents   INTEGER,
  deductible_cents INTEGER,
  notes            TEXT,
  updated_by       TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at       TEXT NOT NULL
);

-- 8, 13, 14 and custom fields: one row of CRM settings per account.
CREATE TABLE IF NOT EXISTS crm_settings (
  account_id         TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  routing_mode       TEXT NOT NULL DEFAULT 'none',
  routing_reps       TEXT NOT NULL DEFAULT '[]',
  market_reps        TEXT NOT NULL DEFAULT '{}',
  routing_cursor     INTEGER NOT NULL DEFAULT 0,
  alert_new_leads    INTEGER NOT NULL DEFAULT 1,
  review_url         TEXT,
  review_delay_days  INTEGER NOT NULL DEFAULT 3,
  repeat_months      INTEGER DEFAULT 11,
  commission_bps     INTEGER,
  rep_commission     TEXT NOT NULL DEFAULT '{}',
  commission_basis   TEXT NOT NULL DEFAULT 'sale',
  custom_fields      TEXT NOT NULL DEFAULT '[]',
  updated_at         TEXT NOT NULL
);

-- 9. Tags and custom values on a lead.
CREATE TABLE IF NOT EXISTS lead_meta (
  lead_id    TEXT PRIMARY KEY REFERENCES sales_leads(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  tags       TEXT NOT NULL DEFAULT '[]',
  custom     TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);

-- 9. A person's saved views of the leads list.
CREATE TABLE IF NOT EXISTS crm_views (
  id         TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  filters    TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_crm_views_user ON crm_views(account_id, user_id);

-- 10. Photos and files on a lead.
CREATE TABLE IF NOT EXISTS lead_files (
  id          TEXT PRIMARY KEY,
  lead_id     TEXT NOT NULL REFERENCES sales_leads(id) ON DELETE CASCADE,
  account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  file_key    TEXT NOT NULL,
  name        TEXT NOT NULL,
  type        TEXT,
  size        INTEGER,
  kind        TEXT NOT NULL DEFAULT 'other',
  source      TEXT NOT NULL DEFAULT 'upload',
  uploaded_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_lead_files_lead ON lead_files(lead_id);

-- 13. A review request and a repeat-business reminder, each once per sale.
CREATE TABLE IF NOT EXISTS crm_aftercare (
  appointment_id TEXT NOT NULL REFERENCES sales_appointments(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL,
  account_id     TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  lead_id        TEXT,
  done_at        TEXT NOT NULL,
  result         TEXT,
  PRIMARY KEY (appointment_id, kind)
);

-- 14. A commission marked paid, stamped with what it was worked out from.
CREATE TABLE IF NOT EXISTS crm_commissions (
  appointment_id TEXT PRIMARY KEY REFERENCES sales_appointments(id) ON DELETE CASCADE,
  account_id     TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  rep_user_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  value_cents    INTEGER,
  value_source   TEXT,
  bps            INTEGER NOT NULL,
  amount_cents   INTEGER NOT NULL,
  paid_at        TEXT NOT NULL,
  paid_ref       TEXT,
  paid_by        TEXT REFERENCES users(id) ON DELETE SET NULL
);
