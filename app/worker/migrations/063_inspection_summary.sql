-- 063. THE SUMMARY THE WORK ORDER CARRIES, written from the comments on the
-- flagged rooms.
--
-- Asked for as: *"A work order should also carry a summary of all of the
-- comments from the follow up or flagged item to give as a summary for the
-- subcontractor. Combine the comments and summarize automatically."*
--
-- 062 gave the work order the flagged rooms and their photographs, which is
-- the record. What it does not do is answer the question somebody pricing the
-- work asks first: *what is this job, in total.* Eleven rooms each with a
-- line about a scuff is eleven lines that have to be read and added up, and
-- the thing worth knowing -- that it is one repaint across four rooms and one
-- tap -- is nowhere on the page. So the comments are combined and summarised
-- once, at the top.
--
-- A SUMMARY IS NOT THE RECORD, which is the same rule 057 keeps between a
-- caption and a draft and the reason this is its own table rather than a
-- column on `inspections`. The rooms, the notes and the captions stay exactly
-- as they are and stay the thing a deposit argument is run from; this is a
-- derived paragraph, marked as derived wherever it is drawn, and deleting
-- every row here would lose nothing but convenience.
--
-- `source` IS WHAT WAS SUMMARISED, STORED VERBATIM, and it is the load-bearing
-- column. A job can be raised from an UNFINISHED inspection -- deliberately,
-- because the leak does not wait for the paperwork -- so the notes can move on
-- afterwards and a paragraph written from the old ones would read as current.
-- Keeping the source means staleness is a comparison rather than a guess: the
-- same rule `agreements` follows by hashing what the signer was shown rather
-- than re-rendering it later. Stored rather than hashed because it is a
-- kilobyte of text either way and a hash cannot be read back by anybody
-- wondering what the model was actually given.
--
-- A SEPARATE TABLE ALSO MEANS ONE PASTE. `ALTER TABLE ... ADD COLUMN` is the
-- one statement that cannot be run twice, so four of them is four pastes and
-- an operator who has to get the order right -- the reason 048 and 057 both
-- chose a table. Every statement here is `IF NOT EXISTS`, so running this file
-- again does nothing.
--
-- There is no ALTER TABLE here, so this is one paste.

CREATE TABLE IF NOT EXISTS inspection_summaries (
  -- The inspection is the key. One summary per inspection, so there is no way
  -- to hold two and no question about which the work order carries.
  inspection_id TEXT PRIMARY KEY REFERENCES inspections(id) ON DELETE CASCADE,
  -- The paragraph. NOT NULL because a row saying nothing is worse than no row:
  -- the screen would draw an empty summary box over a list of rooms and the
  -- reader would take the blank for "nothing much wrong".
  summary       TEXT NOT NULL,
  -- Exactly what it was written from -- room names, statuses, the manager's
  -- notes and the captions they kept, rendered the same way every time. This
  -- is what makes a stale summary detectable, and it is never shown to
  -- anybody: it is the notes, which the same reader already has in full.
  source        TEXT NOT NULL,
  -- Which model wrote it. Stamped rather than read live, the same rule the
  -- agreement templates follow: the sentence was produced by one model and a
  -- screen naming whichever is current today would be describing a different
  -- thing from the one in the column.
  model         TEXT,
  written_at    TEXT,
  -- Who pressed it, which for the automatic one is whoever raised the job.
  -- Sending a tenant's condition notes to a third party to be read is the
  -- sort of thing that gets asked about later.
  written_by    TEXT REFERENCES users(id)
);
