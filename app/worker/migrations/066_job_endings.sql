-- 066. THE THREE WAYS A JOB ENDS WITHOUT RECORDING THAT WORK WAS DONE.
--
-- Asked for as: *"A job should be able to be cancelled or deferred if needed
-- for some reason - maybe it's an inaccurate assessment of what the issue was
-- etc. maybe we have something 'complete, no work done'"*.
--
-- A job arrives through FOUR doors -- the create form, an owner or tenant
-- request, `POST /api/v1/jobs`, a CRM hook -- and left through ONE: *Mark job
-- complete*, which writes a completion. `DELETE /api/jobs/:id` does not
-- exist; `withdraw` is the requester's own move and a job the account raised
-- has no requester; `decline` answers `not_a_request` on anything approved.
-- So tidying anything up meant recording that work had happened, and on a
-- product whose ledger hangs off completion that is not a cosmetic lie.
--
-- A STATUS RATHER THAN A DELETE, which is the shape the roster already
-- settled: the job history is what answers *were they insured on the day of
-- that job*, the work orders and releases hang off it, and a repair somebody
-- cancelled is a thing that happened.
--
-- ONE TABLE RATHER THAN SIX `ADD COLUMN`s, for the reason 048, 057 and 063 all
-- chose a table: `ALTER TABLE ... ADD COLUMN` is the one statement that cannot
-- be run twice, so six of them is six pastes and an operator who has to get
-- the order right. Every statement here is `IF NOT EXISTS`, so running the
-- file again does nothing.
--
-- AND IT IS APPEND-ONLY, no primary key on `job_id`. A deferral ends with a
-- `resumed` row rather than by deleting the one that put it on hold, because
-- *we put this off in January and picked it up in March* is two facts and the
-- first is the one somebody asks about later. Same shape as `wo_events`, the
-- superseded visit and the revoked invite, and for the same reason.
--
-- THE CURRENT STATE IS THE NEWEST ROW, read the way `/api/my-work` reads the
-- live visit: ordered by `at DESC, rowid DESC`. There is deliberately no
-- denormalised copy on `jobs` -- two records of one fact, and the stale one
-- would be the one every screen reads.
--
-- WHAT EACH KIND MEANS, because they are three different events and a person
-- reading a card needs to know which happened:
--
--   cancelled  Terminal. This work is not being done. Live work orders are
--              voided so nobody turns up and the open window is superseded.
--              Refused once money has been FUNDED against it, because then it
--              is a refund question and not a tidy-up.
--
--   deferred   Not now. Same voiding, because a crew booked for work on hold
--              is a crew that turns up -- but reversible, and `until` carries
--              the date somebody meant. A hold whose date has PASSED is live
--              again by itself, which is what "defer until March" says and is
--              why this needs no sweep to undo it. `until` NULL is an
--              indefinite hold, which only a `resumed` row ends.
--
--   no_work    The job is complete and nothing was done to it. A completion
--              with a reason rather than a fourth status, because `jobs.status`
--              carries a CHECK and 003's note says adding to one means a full
--              table rebuild -- and because every reader of `completed`
--              already answers correctly for it. What it must NOT do is read
--              as verified work: nothing is payable against it, which is
--              enforced in `loadWorkOrder` so settle and pay cannot disagree.
--
--   resumed    Ends a deferral. Never ends a cancellation: that is terminal,
--              and reopening a cancelled job is a new job.
--
-- `account_id` is denormalised for the reason every other table here does it:
-- every read is scoped to one account and a join to prove it is how a scoping
-- bug gets written.

CREATE TABLE IF NOT EXISTS job_endings (
  id          TEXT PRIMARY KEY,
  job_id      TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- 'cancelled' | 'deferred' | 'no_work' | 'resumed'. Validated in the Worker
  -- against shared/jobstate.js rather than by a CHECK, the same trade 003 made
  -- for accounts.kind and 055 for an inspection's kind: a CHECK on a table
  -- this young is a full rebuild the first time a fifth word is wanted.
  kind        TEXT NOT NULL,
  -- Why. Required for cancelled and no_work -- *"an inaccurate assessment of
  -- what the issue was"* is exactly the thing somebody needs to read back
  -- months later, and a cancellation with no reason is indistinguishable from
  -- a mis-press. Optional on a deferral, where the date is usually the whole
  -- story, and on a resume.
  note        TEXT,
  -- Deferrals only: the day it comes back. NULL is indefinite.
  until       TEXT,
  at          TEXT NOT NULL,
  by_user_id  TEXT REFERENCES users(id)
);

-- The read is always "the newest row for this job", so the index is the pair
-- in that order. Without it every job on the list costs a scan of this table.
CREATE INDEX IF NOT EXISTS ix_job_endings_job ON job_endings(job_id, at DESC);
-- And the per-account sweep the dashboard count uses.
CREATE INDEX IF NOT EXISTS ix_job_endings_account ON job_endings(account_id, kind);
