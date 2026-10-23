-- 096. The checklist inside each inspection room: one row per item somebody
-- recorded something about (a condition, a note or a cost), keyed on the item
-- key from shared/roomchecklist.js. Items nobody touched have no row; the
-- room's list is derived from its name at read time.
--
-- On a move-out, movein_condition / movein_note / movein_from are the
-- matching move-in item as it read when the move-out was FINISHED. Until
-- then the move-in is read live, because it is a living document; once the
-- move-out is finished the comparison must not change under it.
--
-- One paste. Every statement is IF NOT EXISTS, so running it twice does
-- nothing. Until it is run the rooms work as before and the checklist says
-- which file to paste.
CREATE TABLE IF NOT EXISTS inspection_items (
  id               TEXT PRIMARY KEY,
  room_id          TEXT NOT NULL REFERENCES inspection_rooms(id) ON DELETE CASCADE,
  item_key         TEXT NOT NULL,
  label            TEXT,
  grp              TEXT,
  condition        TEXT,
  note             TEXT,
  cost_cents       INTEGER,
  movein_condition TEXT,
  movein_note      TEXT,
  movein_from      TEXT,
  updated_by       TEXT,
  updated_at       TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_inspection_items ON inspection_items(room_id, item_key);
