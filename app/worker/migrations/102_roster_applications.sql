-- 102. A contractor who applies through the public form waits for the
-- account to accept or decline them, instead of landing on the roster.
-- The engagement is held at status 'paused' while this row is pending,
-- which is what keeps them off the roster and unassignable; this row is
-- the reason, so the screen can say "applied, waiting on you" rather than
-- "paused". One paste, safe to run twice.
CREATE TABLE IF NOT EXISTS roster_applications (
  engagement_id TEXT PRIMARY KEY,
  account_id    TEXT NOT NULL,
  company_id    TEXT NOT NULL,
  state         TEXT NOT NULL DEFAULT 'pending',
  applied_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_at    TEXT,
  decided_by    TEXT
);
CREATE INDEX IF NOT EXISTS ix_roster_applications_account
  ON roster_applications (account_id, state);
