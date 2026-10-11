-- 078: hours worked on an hourly work order, and asking for more of them.
--
-- 024 gave a work order a rate and a cap and nothing else, so an hourly job
-- was paid as rate x cap -- as though every estimated hour had been used --
-- and the real number had nowhere to go but a free-text note.
--
-- A submission of hours IS a milestone: that row is what gets verified,
-- released and paid, so hours use the one money path that already carries the
-- fee, retainage, the cover gate and the lien waiver. This table is what the
-- hours were, one row per day, against the milestone they were sent with.
-- See app/shared/hours.js for every rule.
--
-- No ALTER TABLE, so it is one paste and safe to run twice.

CREATE TABLE IF NOT EXISTS wo_hour_entries (
  id             TEXT PRIMARY KEY,
  work_order_id  TEXT NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  milestone_id   TEXT NOT NULL REFERENCES wo_milestones(id) ON DELETE CASCADE,
  -- The day worked, YYYY-MM-DD. Quarter hours only: a quarter is exact in
  -- binary, so the amount paid can be recomputed from these rows to the cent.
  work_date      TEXT NOT NULL,
  hours          REAL NOT NULL CHECK (hours > 0 AND hours <= 24),
  note           TEXT,
  created_at     TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_wo_hour_entries_milestone ON wo_hour_entries(milestone_id);
CREATE INDEX IF NOT EXISTS ix_wo_hour_entries_wo ON wo_hour_entries(work_order_id);

-- Asking for more hours than were estimated. The ceiling is the work order's
-- own cap_hours plus every APPROVED row here, derived on read and never
-- written back onto the work order, which is not edited once accepted.
CREATE TABLE IF NOT EXISTS wo_hour_requests (
  id             TEXT PRIMARY KEY,
  work_order_id  TEXT NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  account_id     TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  hours          REAL NOT NULL CHECK (hours > 0),
  reason         TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','approved','declined','withdrawn')),
  requested_by   TEXT REFERENCES users(id),
  requested_at   TEXT DEFAULT CURRENT_TIMESTAMP,
  decided_by     TEXT REFERENCES users(id),
  decided_at     TEXT,
  decided_note   TEXT
);
CREATE INDEX IF NOT EXISTS ix_wo_hour_requests_wo ON wo_hour_requests(work_order_id);
-- One open question per work order. The route checks first; this is what is
-- correct when two presses arrive at once.
CREATE UNIQUE INDEX IF NOT EXISTS ux_wo_hour_request_pending
  ON wo_hour_requests(work_order_id) WHERE status = 'pending';
