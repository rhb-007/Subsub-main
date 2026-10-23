-- 097. A photograph can belong to one checklist item in its room
-- (shared/roomchecklist.js keys), so "Walls -- needs painting" carries the
-- picture of the scuff rather than leaving it loose in the room. NULL is a
-- photo of the room as a whole, which is every photo taken before this.
--
-- One ALTER TABLE, which cannot be run twice: paste it once. Until it is run,
-- a photo taken from an item is still saved, on the room, and the screen says
-- the item link was not kept.
ALTER TABLE inspection_photos ADD COLUMN item_key TEXT;
