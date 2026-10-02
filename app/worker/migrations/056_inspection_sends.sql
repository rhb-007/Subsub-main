-- 056. Who has been sent an inspection report, and when.
--
-- A move-in and a move-out report are the two documents a deposit argument
-- is run from, so "did you send me the move-out report" is a question asked
-- months later by somebody with a reason to dispute the answer. A count on
-- the screen cannot answer it and a line in the activity feed cannot be
-- rendered beside the owner it is about, so it is a row per send.
--
-- A ROW PER SEND, not a flag on the inspection. A building can have several
-- owners and they are sent to one at a time; a boolean would answer "somebody
-- was told" to a question that is always about a person.
--
-- Re-sending writes a SECOND row rather than updating the first. "We sent it
-- in October and again in January" is a different fact from "we sent it in
-- January", and the first is the one that matters when somebody says they
-- never got it.
--
-- `emailed` records whether the message actually left. A send marked true
-- over a mail failure is the lie `sent_at` exists to refuse -- the same rule
-- the invite routes follow, where sent_at moves only if something went.
--
-- There is no ALTER TABLE here, so this is one paste, and every statement is
-- IF NOT EXISTS so running it twice does nothing.

CREATE TABLE IF NOT EXISTS inspection_sends (
  id            TEXT PRIMARY KEY,
  inspection_id TEXT NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  -- The owner it went to. A seat on this account, scoped to this building --
  -- never a free-typed address, because the report is read through their own
  -- login and an address with no seat behind it has nothing to open.
  user_id       TEXT NOT NULL REFERENCES users(id),
  -- Who pressed it. An inspection is evidence and so is sending one.
  sent_by       TEXT REFERENCES users(id),
  emailed       INTEGER NOT NULL DEFAULT 0,
  sent_at       TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_inspection_sends ON inspection_sends(inspection_id, sent_at DESC);
