-- When a job last moved.
--
-- Jobs were only ever ordered by when they were created, so one that had
-- just been assigned, replied to, scheduled or corrected sat wherever it
-- first landed -- and a list of three hundred buries the six that changed
-- today. There was nothing to sort by: created_at is the only timestamp a
-- job carried.
--
-- This is touched from every path that changes a job or anything hanging off
-- it -- its work orders and its visits -- so "moved" means what a person
-- means by it, not just "the jobs row was written to".
--
-- Written as datetime('now'), matching created_at's "2026-09-22 19:28:16",
-- because this column is ordered as text and falls back to created_at. An
-- ISO string carries a "T" where that has a space, and "T" sorts above every
-- digit, so one job updated at one in the morning would have outranked
-- another created at eleven at night.
--
-- Backfilled from approved_at or created_at, and deliberately not from
-- completed_at: that one holds a date with no time, which would be a
-- different shape again. A finished job sorting by when it was raised is
-- honest -- nobody recorded the hour it was closed -- and inventing one to
-- make the column tidy would be worse.
ALTER TABLE jobs ADD COLUMN updated_at TEXT;
UPDATE jobs SET updated_at = COALESCE(approved_at, created_at) WHERE updated_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_updated ON jobs(account_id, updated_at);
