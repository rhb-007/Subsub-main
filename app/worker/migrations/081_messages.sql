-- 081: messages between an account and the people it already works with.
--
-- A thread always hangs off a relationship that already exists, which is the
-- whole of why this is not a directory with a chat box on it:
--   tenant  -- an account and one of its tenants (a tenant seat);
--   crew    -- an account and a company on its roster (an engagement);
--   owner   -- an account and the owner of a building it runs (an owner seat,
--              or the owning account of a building appointed out to it).
-- Each kind has one general thread per party, and may have one per job.
-- `account_id` is always the account that RUNS the relationship: the hiring
-- side for a crew, the operator for a tenant or an owner. There is no thread
-- between a tenant and a crew, or a tenant and an owner -- the operator stays
-- in the middle. See app/shared/messaging.js for every rule.
--
-- Messages are append-only. The author may correct one for ten minutes, and
-- nothing is ever deleted, because a thread about a job is part of its record.
--
-- `message_reads` is per person, not per side: a teammate reading a thread
-- does not mean you have. `notified_at` is when the new-message email last
-- went, so one email covers a run of messages rather than one each.
--
-- Timestamps are written by the Worker as ISO strings, all of them, so every
-- comparison here is one format against itself.
--
-- No ALTER TABLE, so it is one paste and safe to run twice.

CREATE TABLE IF NOT EXISTS message_threads (
  id                TEXT PRIMARY KEY,
  thread_key        TEXT NOT NULL,
  account_id        TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  kind              TEXT NOT NULL CHECK (kind IN ('tenant', 'crew', 'owner')),
  party_user_id     TEXT REFERENCES users(id),
  party_company_id  TEXT REFERENCES companies(id),
  party_account_id  TEXT REFERENCES accounts(id),
  job_id            TEXT REFERENCES jobs(id) ON DELETE CASCADE,
  property_id       TEXT REFERENCES properties(id) ON DELETE SET NULL,
  created_by        TEXT REFERENCES users(id),
  created_at        TEXT NOT NULL,
  last_at           TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_message_thread_key ON message_threads(thread_key);
CREATE INDEX IF NOT EXISTS ix_message_threads_account ON message_threads(account_id, last_at);
CREATE INDEX IF NOT EXISTS ix_message_threads_company ON message_threads(party_company_id);
CREATE INDEX IF NOT EXISTS ix_message_threads_user ON message_threads(party_user_id);
CREATE INDEX IF NOT EXISTS ix_message_threads_party_account ON message_threads(party_account_id);
CREATE INDEX IF NOT EXISTS ix_message_threads_job ON message_threads(job_id);

CREATE TABLE IF NOT EXISTS messages (
  id              TEXT PRIMARY KEY,
  thread_id       TEXT NOT NULL REFERENCES message_threads(id) ON DELETE CASCADE,
  author_user_id  TEXT REFERENCES users(id),
  author_side     TEXT NOT NULL CHECK (author_side IN ('home', 'party')),
  body            TEXT NOT NULL DEFAULT '',
  photos          TEXT NOT NULL DEFAULT '[]',
  created_at      TEXT NOT NULL,
  edited_at       TEXT
);
CREATE INDEX IF NOT EXISTS ix_messages_thread ON messages(thread_id, created_at);

CREATE TABLE IF NOT EXISTS message_reads (
  thread_id    TEXT NOT NULL REFERENCES message_threads(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id),
  read_at      TEXT,
  notified_at  TEXT,
  PRIMARY KEY (thread_id, user_id)
);
