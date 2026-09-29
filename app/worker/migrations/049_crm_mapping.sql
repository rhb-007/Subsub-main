-- 049: what a CRM's own words mean in SubSub trades.
--
-- Run 048 first. Like it, this is ONE PASTE and no ALTER TABLE: every
-- statement is IF NOT EXISTS, so running it again does nothing.
--
-- JobNimbus has no concept of a trade. It has a job `type`, a
-- `record_type_name`, a `status_name` and free-text tags -- the customer's
-- own words, different at every company. Nothing in that payload maps to
-- `roofing` unless somebody says so, so the account says so once.

-- The account's own dictionary. One row per "when you see THIS, it means
-- THESE trades".
CREATE TABLE IF NOT EXISTS crm_trade_rules (
  id          TEXT PRIMARY KEY,
  account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- Which CRM, or '*' for every one of them, which is the default and the
  -- common case. The words a rule matches are the ACCOUNT'S OWN -- typed into
  -- their own system -- so "Roof Replacement" means roofing whichever system
  -- sends it, and a per-source dictionary would be the same dictionary retyped
  -- per CRM. A named source still narrows, for an account running two systems
  -- that disagree about a word.
  --
  -- It was NOT NULL with no default and the screen sent nothing, so the route
  -- defaulted to 'jobnimbus' and every rule saved from the screen was filed
  -- against a CRM the account might not use -- firing for nobody. No schema
  -- change was needed to fix that, only the route; the column is left as it is
  -- so this file stays a record of what was run.
  source      TEXT NOT NULL,
  -- 'type', 'status' or 'tag' -- a rule matches ONE named field, never a
  -- free-text sweep of the payload, so somebody can read their own rules
  -- back and know what each one does.
  match_kind  TEXT NOT NULL,
  match_value TEXT NOT NULL,
  -- JSON array of SubSub trade ids.
  trades      TEXT NOT NULL,
  created_by  TEXT REFERENCES users(id),
  created_at  TEXT DEFAULT CURRENT_TIMESTAMP
);

-- One rule per value, per field, per source, per account. Two rules for the
-- same word are two answers to one question, and whichever the query returned
-- first would silently win.
CREATE UNIQUE INDEX IF NOT EXISTS ux_crm_rules
  ON crm_trade_rules(account_id, source, match_kind, match_value);

-- The work queue: words that arrived and meant nothing to us.
--
-- This is the half that keeps an unmapped job from being a dead end. The
-- alternative -- refusing a job whose type has no rule -- is the worst
-- possible answer: the CRM does not get a 200, so it retries, so it keeps not
-- getting one, and NOBODY IS TOLD. The job never arrives, the account never
-- learns it did not, and the only symptom is work quietly missing from
-- SubSub.
--
-- So the job lands with no trades and the value that failed to match is kept
-- here, counted. "Three jobs arrived with type Roof Replacement" is a
-- question somebody answers in one tap; "some jobs had no trades" is a
-- mystery.
CREATE TABLE IF NOT EXISTS crm_unmapped (
  id          TEXT PRIMARY KEY,
  account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  source      TEXT NOT NULL,
  match_kind  TEXT NOT NULL,
  match_value TEXT NOT NULL,
  -- How often, and when last, so the busiest gap sorts to the top rather than
  -- the oldest one.
  hits        INTEGER NOT NULL DEFAULT 0,
  last_seen   TEXT,
  created_at  TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Counted, not listed: one row per distinct word, incremented. Without this
-- a busy account gets one row per job and the screen becomes the thing it
-- was meant to summarise.
CREATE UNIQUE INDEX IF NOT EXISTS ux_crm_unmapped
  ON crm_unmapped(account_id, source, match_kind, match_value);
