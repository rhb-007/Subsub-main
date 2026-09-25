-- Finishing a job becomes a record you could take to a lawyer.
--
-- Today completion is jobs.status = 'completed' and a timestamp, and there
-- is a route that undoes it. A flag can be flipped, reversed and edited, and
-- nothing anywhere says who flipped it or what they showed. That is fine
-- while completion only closes a card on a screen. It stops being fine the
-- moment money is released against it, because the question then is "who
-- said this was done, when, and what did they show me" -- asked months
-- later, by somebody disputing it.
--
-- Three tables, and the shape matters more than the columns:
--
--   wo_milestones  what the work is broken into, and what each part is
--                  worth. One milestone is exactly today's behaviour.
--
--   wo_events      APPEND ONLY. Never updated, never deleted. Status is a
--                  projection of these, not the other way round.
--
--   wo_releases    what is owed and whether it has been settled. Settlement
--                  is manual now -- a cheque number typed in -- and the
--                  `method` column is the seam a payment processor drops
--                  into later without any of this changing shape.
--
-- Amounts are whole cents, everywhere, always. See shared/money.js for the
-- arithmetic: every cut is computed cumulatively so a percentage taken over
-- several milestones sums to exactly the right total.

-- ---------------------------------------------------------------------------
-- What the work is broken into.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wo_milestones (
  id             TEXT PRIMARY KEY,
  work_order_id  TEXT NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  -- Denormalised on purpose: every read of this table is scoped to one
  -- account, and joining three tables to prove it is how a scoping bug gets
  -- written.
  account_id     TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  seq            INTEGER NOT NULL,
  label          TEXT NOT NULL,
  amount_cents   INTEGER NOT NULL DEFAULT 0,
  -- reached: the subcontractor says this part is done.
  -- verified: the hiring account agrees. Only then is anything owed.
  -- Two parties, and neither can do both -- that is what makes the record
  -- worth something to somebody who was not there.
  status         TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','reached','verified','rejected')),
  reached_at     TEXT,
  reached_by     TEXT REFERENCES users(id),
  verified_at    TEXT,
  verified_by    TEXT REFERENCES users(id),
  note           TEXT,
  created_at     TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_wo_milestone_seq ON wo_milestones (work_order_id, seq);
CREATE INDEX IF NOT EXISTS ix_wo_milestone_wo ON wo_milestones (work_order_id, status);
CREATE INDEX IF NOT EXISTS ix_wo_milestone_acct ON wo_milestones (account_id, status);

-- ---------------------------------------------------------------------------
-- What happened, in order, for ever.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wo_events (
  id             TEXT PRIMARY KEY,
  work_order_id  TEXT NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  account_id     TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  milestone_id   TEXT REFERENCES wo_milestones(id) ON DELETE SET NULL,
  kind           TEXT NOT NULL,
  -- Who, in three parts, because "the contractor" is not an answer when the
  -- contractor is a company with four people on it.
  actor_user_id  TEXT REFERENCES users(id),
  actor_role     TEXT,
  actor_company_id TEXT REFERENCES companies(id),
  at             TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Whatever the event needs: photo keys, a note, the amounts as they stood.
  -- Amounts are copied in rather than referenced, because a release has to
  -- keep saying what it said even after a change order moves the total.
  payload        TEXT,
  -- A retry must not write the event twice. Every writer supplies one.
  idem_key       TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_wo_event_idem ON wo_events (idem_key) WHERE idem_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_wo_event_wo ON wo_events (work_order_id, at);
CREATE INDEX IF NOT EXISTS ix_wo_event_acct ON wo_events (account_id, at);

-- ---------------------------------------------------------------------------
-- What is owed, and whether it has gone.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wo_releases (
  id             TEXT PRIMARY KEY,
  work_order_id  TEXT NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  account_id     TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  milestone_id   TEXT REFERENCES wo_milestones(id) ON DELETE SET NULL,
  -- Who is owed. Not derived from the work order at read time: a company can
  -- be replaced on a job, and who was owed in March must stay March's answer.
  company_id     TEXT NOT NULL REFERENCES companies(id),
  gross_cents    INTEGER NOT NULL,
  retainage_cents INTEGER NOT NULL DEFAULT 0,
  -- The rate AND the money. The rate is stamped at the moment the release is
  -- made so a fee change next year cannot rewrite what was charged last
  -- year. Zero until payment processing exists, which is the point: the
  -- column is here from the first row rather than added once there is
  -- history to backfill.
  fee_bps        INTEGER NOT NULL DEFAULT 0,
  fee_cents      INTEGER NOT NULL DEFAULT 0,
  net_cents      INTEGER NOT NULL,
  status         TEXT NOT NULL DEFAULT 'due'
                   CHECK (status IN ('due','paid','void')),
  -- The seam. 'manual' is a cheque, a transfer, whatever they already do,
  -- with the reference typed in. A processor becomes another value here and
  -- a transfer id in `reference`; nothing else about this table changes.
  method         TEXT,
  reference      TEXT,
  settled_at     TEXT,
  settled_by     TEXT REFERENCES users(id),
  idem_key       TEXT,
  created_at     TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_wo_release_idem ON wo_releases (idem_key) WHERE idem_key IS NOT NULL;
-- One release per milestone. Paying the same milestone twice is the failure
-- this whole table exists to make impossible, so it is a constraint and not
-- a check somebody remembers to write.
CREATE UNIQUE INDEX IF NOT EXISTS ux_wo_release_milestone
  ON wo_releases (milestone_id) WHERE milestone_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_wo_release_wo ON wo_releases (work_order_id, status);
CREATE INDEX IF NOT EXISTS ix_wo_release_acct ON wo_releases (account_id, status);
CREATE INDEX IF NOT EXISTS ix_wo_release_company ON wo_releases (company_id, status);
