-- 089. A sub's own BBB profile, linked from their Passport, and the last
-- rating the official BBB API answered for it.
--
-- ONE PASTE, safe to run any number of times: every statement is
-- IF NOT EXISTS.
--
-- Its own table rather than columns on passports, so the paste can be run
-- twice. Keyed by the company: one profile per business. profile_url is the
-- address the sub pasted (whole value, never a name search); bbb_id and
-- business_id are read off it. rating and accredited are what the API last
-- said; checked_at is when, and a reading older than 30 days is not drawn
-- (BBB's own refresh rule). A failed check keeps the last answer and stamps
-- last_failed_at, the rule license checks already follow.
--
-- Until it is run, linking a profile answers migration_needed naming this
-- file, and nothing else on any screen changes.
CREATE TABLE IF NOT EXISTS bbb_profiles (
  company_id      TEXT PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  profile_url     TEXT NOT NULL,
  bbb_id          TEXT NOT NULL,
  business_id     TEXT NOT NULL,
  rating          TEXT,
  accredited      INTEGER NOT NULL DEFAULT 0,
  checked_at      TEXT,
  last_failed_at  TEXT,
  last_error      TEXT,
  linked_at       TEXT DEFAULT CURRENT_TIMESTAMP,
  linked_by       TEXT REFERENCES users(id)
);
