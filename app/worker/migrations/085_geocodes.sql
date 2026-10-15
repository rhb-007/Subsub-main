-- 085. Where an address is, so the Jobs map and the Properties map can draw it.
--
-- ONE PASTE, safe to run any number of times.
--
-- A cache, keyed by the address line itself (case and spacing folded, see
-- app/shared/mapgeo.js). Deliberately NO account column: where 123 Main St is
-- is a public fact, the same answer for everybody, and looking it up once is
-- cheaper and kinder to the geocoder than once per account. Nothing lists
-- this table -- GET /api/map/points answers only for the caller's own jobs and
-- buildings, so sharing the cache shares nothing anybody could read.
--
-- `precision` says how sure the point is: address (the Census Bureau matched
-- the street), zip or city (placed near it). A failed lookup is a row too,
-- with lat and lng NULL and precision 'none', or the map would ask again on
-- every open about the address nobody can place; it is retried after
-- GEOCODE_RETRY_DAYS.
CREATE TABLE IF NOT EXISTS geocodes (
  address_key TEXT PRIMARY KEY,
  lat         REAL,
  lng         REAL,
  precision   TEXT NOT NULL CHECK (precision IN ('address', 'zip', 'city', 'none')),
  source      TEXT,
  checked_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
