-- 095. The layout of the unit an inspection walks: 'studio', '2br-1.5ba' and
-- so on, validated against shared/unitlayout.js. Choosing one adds that
-- layout's rooms, and changing it later adds and removes rooms by comparing
-- the old layout with the new one, which is why the choice is stored rather
-- than only acted on.
--
-- One ALTER TABLE, which cannot be run twice: paste it once. Until it is
-- run, choosing a layout still adds its rooms; it is just not remembered, so
-- changing it later adds rooms and removes none.
ALTER TABLE inspections ADD COLUMN unit_layout TEXT;
