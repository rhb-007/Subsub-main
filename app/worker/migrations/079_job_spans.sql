-- 079: how long each trade on a job takes -- a start and a length in working
-- days -- so the calendar can draw a timeline rather than a dot per job.
--
-- Keyed on (job, trade), because the estimate belongs to the trade: demo,
-- plumbing and paint on one job run in sequence, and one start and end for the
-- whole job would show every trade busy for every day of it. The job's own span
-- is derived from these rows, never stored beside them.
--
-- The finish is not a column. It is computed from the start, the length, the
-- weekend rule and the days the crew holding the work has marked off, so a
-- holiday in the middle of a job pushes its end on every screen at once.
--
-- proposed_* is the crew suggesting different figures: the hiring side keeps
-- its own until it accepts them. See app/shared/span.js for every rule.
--
-- No ALTER TABLE, so it is one paste and safe to run twice.

CREATE TABLE IF NOT EXISTS job_trade_spans (
  job_id          TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  trade           TEXT NOT NULL,
  start_date      TEXT NOT NULL,
  work_days       INTEGER NOT NULL CHECK (work_days BETWEEN 1 AND 365),
  weekends        INTEGER NOT NULL DEFAULT 0,
  set_by          TEXT REFERENCES users(id),
  set_at          TEXT DEFAULT CURRENT_TIMESTAMP,
  proposed_start  TEXT,
  proposed_days   INTEGER CHECK (proposed_days IS NULL OR proposed_days BETWEEN 1 AND 365),
  proposed_note   TEXT,
  proposed_by     TEXT REFERENCES users(id),
  proposed_at     TEXT,
  PRIMARY KEY (job_id, trade)
);
CREATE INDEX IF NOT EXISTS ix_job_trade_spans_start ON job_trade_spans(start_date);
