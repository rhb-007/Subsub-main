-- 048: an API for scheduled jobs arriving from somebody else's CRM.
--
-- Two tables, and DELIBERATELY NO `ALTER TABLE`. The obvious shape was two
-- new columns on `jobs` -- source and external_id -- and it is the wrong one
-- twice over. ADD COLUMN is the one statement here that cannot be run twice,
-- so it needs a paste of its own and a operator who gets the order right; and
-- where a job CAME FROM is a fact about how it arrived, not about the work.
-- A separate table keeps every existing query against `jobs` untouched and
-- makes this whole file one paste that can be run again safely.
--
-- RUN IT AS ONE PASTE. Every statement is IF NOT EXISTS, so running it twice
-- does nothing the second time.

-- The token an account's CRM authenticates with.
--
-- The token itself is NEVER STORED. What is kept is a SHA-256 of it, the same
-- way a password would be -- so a copy of this table is not a set of working
-- keys to every customer's integration. That means it can be shown exactly
-- once, at the moment it is minted, and the screen says so rather than
-- offering a "view" that cannot work.
--
-- `prefix` is the first few characters, kept in the clear on purpose: it is
-- the only way somebody holding three tokens can tell which row is which
-- without being able to read any of them.
CREATE TABLE IF NOT EXISTS api_tokens (
  id            TEXT PRIMARY KEY,
  account_id    TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- What it is for, in their words: "JobNimbus", "our scheduler".
  name          TEXT NOT NULL,
  prefix        TEXT NOT NULL,
  token_hash    TEXT NOT NULL,
  created_by    TEXT REFERENCES users(id),
  created_at    TEXT DEFAULT CURRENT_TIMESTAMP,
  -- Answers "is this thing actually being used", which is the question asked
  -- before revoking one nobody recognises. Written at most once a minute --
  -- a write on every call would make the busiest integration the slowest.
  last_used_at  TEXT,
  revoked_at    TEXT
);

-- The lookup every authenticated API call makes, so it is an index rather
-- than a scan. Unique because two rows with one hash is two accounts behind
-- one key.
CREATE UNIQUE INDEX IF NOT EXISTS ux_api_tokens_hash ON api_tokens(token_hash);
CREATE INDEX IF NOT EXISTS ix_api_tokens_account ON api_tokens(account_id);

-- Where a job came from, and the thing that makes a retry safe.
--
-- A CRM webhook that does not get a 200 sends again. Without a key to
-- recognise the second delivery by, one scheduled job becomes four jobs on
-- somebody's roster and four contractors asked to show up on a Tuesday. The
-- unique index is what makes the second POST return the first job instead of
-- creating another, so it is a CONSTRAINT and not a convenience: dropping it
-- does not slow anything down, it silently allows the duplicate.
--
-- Scoped to the account as well as the source, because two customers both on
-- JobNimbus will both have a job numbered 1041 and they are different jobs.
CREATE TABLE IF NOT EXISTS job_sources (
  job_id       TEXT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
  account_id   TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  source       TEXT NOT NULL,
  external_id  TEXT NOT NULL,
  -- Which token posted it. Revoking a token does not withdraw the jobs it
  -- created -- the work is real and somebody may already be booked -- but
  -- "where did these come from" has to be answerable afterwards.
  token_id     TEXT REFERENCES api_tokens(id),
  created_at   TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_job_sources_external
  ON job_sources(account_id, source, external_id);
