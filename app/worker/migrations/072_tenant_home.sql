-- 072. THE TENANT'S OWN DASHBOARD: HOW TO REACH THEM, WHO TO CALL IF THEY
-- CANNOT BE REACHED, AND WHAT THE BUILDING NEEDS THEM TO KNOW.
--
-- tenant_contacts is keyed by (account, person), not by person alone. A
-- person is global and may rent from two landlords; how they would like THIS
-- one to reach them, and the emergency contact they chose to give THIS one,
-- is something they told that account and nobody else. Their phone number
-- itself stays on users.phone, which is what every text already goes to --
-- a second number here would be two records of one fact and the texts would
-- follow one of them.
--
-- building_notices is the manager telling everybody in a building one thing:
-- the water is off on Tuesday, the lift is out, the car park is being
-- resurfaced. Per building, never per account: a notice about one address
-- shown at another is the wrong answer to "is my water off". Removed, never
-- deleted, because "we did tell them" is the question a notice is asked
-- about afterwards.
--
-- No ALTER TABLE, so it can be run more than once.

CREATE TABLE IF NOT EXISTS tenant_contacts (
  account_id          TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  prefer              TEXT,
  best_time           TEXT,
  emergency_name      TEXT,
  emergency_relation  TEXT,
  emergency_phone     TEXT,
  updated_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (account_id, user_id)
);

CREATE TABLE IF NOT EXISTS building_notices (
  id           TEXT PRIMARY KEY,
  account_id   TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  property_id  TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  body         TEXT,
  important    INTEGER NOT NULL DEFAULT 0,
  ends_on      TEXT,
  created_by   TEXT,
  created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  removed_at   TEXT,
  emailed      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_building_notices_property ON building_notices(property_id, removed_at);
