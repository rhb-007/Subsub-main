-- 057. What is written about an inspection photograph.
--
-- Two different facts, and keeping them apart is the whole point of the
-- table:
--
--   caption -- the manager's words. This is the record. It is what the
--              building's owner reads, and it exists only because somebody
--              typed it or kept it.
--   draft   -- what the model wrote when asked. The team's working note.
--
-- A DRAFT IS NOT THE RECORD, the same rule `engagements.doc_review`'s draft
-- follows: it is stored BESIDE the real value and never as it, so nothing
-- downstream can read a half-answer as an answer. A draft nobody kept does
-- not appear in the report -- an offer that was never accepted, which is the
-- line `inForce` draws about a countersignature. Promoting one to the other
-- takes a press.
--
-- A SEPARATE TABLE RATHER THAN THREE COLUMNS ON `inspection_photos`, for the
-- reason 048 gave: `ALTER TABLE ... ADD COLUMN` is the one statement that
-- cannot be run twice, so three of them is three pastes and an operator who
-- has to get the order right. Every statement here is `IF NOT EXISTS`, so
-- this is ONE paste and running it again does nothing. It also reads
-- correctly on its own terms -- the writing about a photograph is a
-- different record from the file, which is all `inspection_photos` is.
--
-- There is no ALTER TABLE here, so this is one paste.

CREATE TABLE IF NOT EXISTS inspection_photo_notes (
  -- The photo is the key. One row per photograph, so there is no way to hold
  -- two captions for one picture and no question about which is current.
  photo_id    TEXT PRIMARY KEY REFERENCES inspection_photos(id) ON DELETE CASCADE,
  caption     TEXT,
  draft       TEXT,
  -- Whether the model said it could not make the photograph out. Kept
  -- rather than folded into the text, because the screen draws that case
  -- differently: an invented sentence about a dark photograph reads exactly
  -- like a real one, and a record somebody is arguing over is the worst
  -- place for that.
  draft_unclear INTEGER NOT NULL DEFAULT 0,
  drafted_at  TEXT,
  -- Who pressed the button. Asking a third party to read a photograph of
  -- somebody's home is the sort of thing that gets asked about later.
  drafted_by  TEXT REFERENCES users(id),
  updated_at  TEXT DEFAULT CURRENT_TIMESTAMP
);
