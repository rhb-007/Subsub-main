-- 068: move-in and move-out inspections arriving from somebody else's system.
--
-- Run 048 first, for `api_tokens` -- a token is a token, and the one an
-- account already holds for posting jobs is the one that posts inspections.
-- Nothing here mints a second kind of key.
--
-- THREE TABLES AND DELIBERATELY NO `ALTER TABLE`, which makes this ONE PASTE.
-- Every statement is IF NOT EXISTS, so running it again does nothing. The
-- obvious shape was two columns on `inspections` -- source and external_id --
-- and it is wrong twice over for the reasons 048 gives: ADD COLUMN is the one
-- statement here that cannot be run twice, so it needs a paste of its own and
-- an operator who gets the order right; and where an inspection CAME FROM is
-- a fact about how it arrived, not about the walk.

-- Where an inspection came from, and the thing that makes a retry safe.
--
-- A webhook that does not get a 200 sends again. Without a key to recognise
-- the second delivery by, one walk of one unit becomes four inspections -- and
-- four jobs raised against one flat, which is four contractors asked to turn
-- up. The unique index is what makes the second POST return the first
-- inspection instead of creating another, so it is a CONSTRAINT and not a
-- convenience: dropping it does not slow anything down, it silently allows the
-- duplicate.
--
-- Scoped to the account as well as the source, because two customers both on
-- the same inspection app will both have a walk numbered 1041 and they are
-- different units in different towns.
CREATE TABLE IF NOT EXISTS inspection_sources (
  inspection_id TEXT PRIMARY KEY REFERENCES inspections(id) ON DELETE CASCADE,
  account_id    TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  source        TEXT NOT NULL,
  external_id   TEXT NOT NULL,
  -- Which token posted it. Revoking a token does not withdraw the inspections
  -- it created -- they are real records of real walks, and a deposit argument
  -- may turn on one -- but "where did these come from" has to stay answerable
  -- after the key is turned off.
  token_id      TEXT REFERENCES api_tokens(id),
  created_at    TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_inspection_sources_external
  ON inspection_sources(account_id, source, external_id);

-- The account's own dictionary: when a room arrives saying THIS, it means
-- THAT condition.
--
-- Every inspection app has its own scale -- pass/fail, good/fair/poor, 1 to 5,
-- A/B/C -- and SubSub has four statuses. `shared/inspectingest.js` knows the
-- near-universal words; this is for everything else, and for an account whose
-- "Fair" means something different from ours.
--
-- THERE IS NO `match_kind` COLUMN, unlike `crm_trade_rules`. A trade rule can
-- match a job type, a status or a tag, so it has to say which; a condition
-- rule matches one thing -- the word in the room's condition field -- and a
-- column with one possible value is a column that reads as a choice somebody
-- has to make.
CREATE TABLE IF NOT EXISTS inspection_status_rules (
  id          TEXT PRIMARY KEY,
  account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- Which system, or '*' for every one of them, which is the default and the
  -- common case. The words are the ACCOUNT'S OWN -- their inspection app's
  -- scale, chosen by them -- so "Poor" means the same thing whichever system
  -- sends it, and a per-source dictionary would be the same dictionary
  -- retyped. This is 049's lesson taken at the start rather than after a
  -- release of rules that fired for nobody.
  source      TEXT NOT NULL DEFAULT '*',
  match_value TEXT NOT NULL,
  -- One of shared/inspection.js's ROOM_STATUSES. Validated in the Worker
  -- rather than by a CHECK, the same trade 055 made for `inspections.kind`.
  -- CHECK.sql counts a row that got past it, because a rule naming a status
  -- that does not exist fires and does nothing, which looks exactly like one
  -- that was set up.
  status      TEXT NOT NULL,
  created_by  TEXT REFERENCES users(id),
  created_at  TEXT DEFAULT CURRENT_TIMESTAMP
);

-- One rule per word, per source, per account. Two rules for one word are two
-- answers to one question, and whichever the query returned first would
-- silently win.
CREATE UNIQUE INDEX IF NOT EXISTS ux_inspection_status_rules
  ON inspection_status_rules(account_id, source, match_value);

-- The work queue: condition words that arrived and meant nothing to us.
--
-- This is the half that keeps an unmapped inspection from being a dead end,
-- and it is the same argument 049 makes one feature along. The alternative --
-- refusing a walk whose conditions have no rule -- is the worst possible
-- answer: the sender does not get a 200, so it retries, so it keeps not
-- getting one, and NOBODY IS TOLD. The inspection never arrives, the account
-- never learns it did not, and the only symptom is a unit nobody has a record
-- of walking.
--
-- So the inspection lands, those rooms are `unchecked` -- which is the strict
-- answer, and the one that stops it being signed off as if somebody had walked
-- them -- and the word is kept here, counted. "Nine rooms arrived saying
-- Poor" is a question somebody answers in one tap; "some rooms were not
-- checked" is a mystery.
CREATE TABLE IF NOT EXISTS inspection_unmapped (
  id          TEXT PRIMARY KEY,
  account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  source      TEXT NOT NULL,
  match_value TEXT NOT NULL,
  -- How often, and when last, so the busiest gap sorts to the top rather than
  -- the oldest one.
  hits        INTEGER NOT NULL DEFAULT 0,
  last_seen   TEXT,
  created_at  TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Counted, not listed: one row per distinct word, incremented. Without this a
-- busy account gets one row per room per walk and the screen becomes the thing
-- it was meant to summarise.
CREATE UNIQUE INDEX IF NOT EXISTS ux_inspection_unmapped
  ON inspection_unmapped(account_id, source, match_value);
