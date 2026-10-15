-- 082: which job a conversation turned into.
--
-- A message never changes anything: "the sink is leaking" is not a job until
-- somebody presses Create a job (the manager) or Report a problem (the
-- tenant). When they press it FROM a conversation, the job is linked back to
-- it, so the conversation can say "Job created from this conversation" and
-- point at it, and the job knows where it came from. See app/shared/messaging.js.
--
-- No ALTER TABLE, so it is one paste and safe to run twice.

CREATE TABLE IF NOT EXISTS thread_job_links (
  thread_id   TEXT NOT NULL REFERENCES message_threads(id) ON DELETE CASCADE,
  job_id      TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  created_by  TEXT REFERENCES users(id),
  created_at  TEXT NOT NULL,
  PRIMARY KEY (thread_id, job_id)
);
CREATE INDEX IF NOT EXISTS ix_thread_job_links_job ON thread_job_links(job_id);
