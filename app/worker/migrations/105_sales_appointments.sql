-- 105: sales appointments -- a homeowner booked for an estimate, before
-- anything is a job.
--
-- Booked by a call-center seat (role `callcenter`, which needs no column:
-- memberships.role carries no CHECK) or by an admin or project manager. The
-- sales manager runs it on site, the outcome is recorded here, and a sold one
-- becomes a job (job_id), assigned like any other. shared/salesappt.js holds
-- the call script and the rules.
--
-- The homeowner's own details are columns, because they are what the list is
-- searched and sorted by. The answers to the script, the second decision maker
-- and the home questions are JSON, because they follow the script and the
-- script is allowed to grow.
--
-- No ALTER TABLE, so it is one paste and safe to run twice.

CREATE TABLE IF NOT EXISTS sales_appointments (
  id            TEXT PRIMARY KEY,
  account_id    TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'scheduled',
  direction     TEXT NOT NULL,
  source        TEXT,
  services      TEXT NOT NULL,
  details       TEXT NOT NULL DEFAULT '{}',
  home          TEXT NOT NULL DEFAULT '{}',
  first_name    TEXT NOT NULL,
  last_name     TEXT NOT NULL,
  phone         TEXT NOT NULL,
  email         TEXT,
  street        TEXT NOT NULL,
  city          TEXT NOT NULL,
  state         TEXT NOT NULL,
  zip           TEXT NOT NULL,
  second        TEXT,
  date          TEXT NOT NULL,
  time          TEXT NOT NULL,
  minutes       INTEGER NOT NULL DEFAULT 90,
  rep_user_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
  notes         TEXT,
  outcome_note  TEXT,
  job_id        TEXT REFERENCES jobs(id) ON DELETE SET NULL,
  created_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status_at     TEXT
);
CREATE INDEX IF NOT EXISTS ix_sales_appointments_day ON sales_appointments(account_id, date);
CREATE INDEX IF NOT EXISTS ix_sales_appointments_rep ON sales_appointments(rep_user_id, date);
