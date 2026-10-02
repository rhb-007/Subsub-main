-- 055. Move-in and move-out unit inspections.
--
-- A managing agent walks a unit when somebody moves in and again when they
-- move out, room by room, with photographs. "The carpet was like that when I
-- moved in" is the commonest dispute in the business and the only answer to
-- it is two dated records of the same unit -- which is why the kind and the
-- date are columns rather than something somebody types into a note.
--
-- Three tables rather than one JSON blob on a row, for the reason
-- `company_docs` is a table: the rooms are queried (how many are flagged,
-- how many are unanswered) and the photos are served one at a time by id.
--
-- WHOSE IT IS: account_id, like everything else. property_id is what the
-- property scope narrows on, so a project manager scoped to named buildings
-- sees inspections of those buildings and no others -- the middleware that
-- already resolves a job for that scope is where it is enforced, not in a
-- filter per route.
--
-- There is no ALTER TABLE here, so this is one paste.

CREATE TABLE IF NOT EXISTS inspections (
  id            TEXT PRIMARY KEY,
  account_id    TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  property_id   TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  -- Free text, like every other unit in this schema: a unit is "3B" in one
  -- building and "Apt 12" in the next, and a managing agent types what is on
  -- the door.
  unit          TEXT,
  -- 'move_in' or 'move_out'. Validated in the Worker against
  -- shared/inspection.js rather than by a CHECK, the same trade 003 made for
  -- accounts.kind: a CHECK on a table this young is a full rebuild the first
  -- time a third kind is wanted.
  kind          TEXT NOT NULL,
  -- Who was moving. Not a tenant id: the person moving OUT may already have
  -- had their seat removed, and the person moving IN very often has no seat
  -- yet -- an inspection that could only name people with logins would be
  -- unusable at exactly the two moments it is for.
  tenant_name   TEXT,
  -- The day it was WALKED, which is not the day the row was made. Somebody
  -- types the inspection up that evening.
  inspected_on  TEXT,
  -- 'draft' until it is finished. A finished one is a document somebody may
  -- be quoting back months later, so it stops being editable.
  status        TEXT NOT NULL DEFAULT 'draft',
  finished_at   TEXT,
  -- The job raised from what was flagged, when one was. One per inspection:
  -- raising a second would be two contractors asked for the same work.
  job_id        TEXT REFERENCES jobs(id),
  created_by    TEXT REFERENCES users(id),
  created_at    TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_inspections_account ON inspections(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inspections_property ON inspections(property_id);

CREATE TABLE IF NOT EXISTS inspection_rooms (
  id            TEXT PRIMARY KEY,
  inspection_id TEXT NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  -- Free text. shared/inspection.js offers a standard list, and it is a
  -- suggestion: every building has a room that list has not heard of.
  name          TEXT NOT NULL,
  -- 'unchecked' | 'ok' | 'follow_up' | 'fail'. Defaults to unchecked, which
  -- is a real answer and not a missing one -- a room nobody has walked and a
  -- room walked and found fine must not look the same.
  status        TEXT NOT NULL DEFAULT 'unchecked',
  note          TEXT,
  position      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_inspection_rooms ON inspection_rooms(inspection_id, position);

CREATE TABLE IF NOT EXISTS inspection_photos (
  id            TEXT PRIMARY KEY,
  room_id       TEXT NOT NULL REFERENCES inspection_rooms(id) ON DELETE CASCADE,
  -- The R2 key. Written by the Worker from the account id, never taken from
  -- the browser -- the upload route hands back a key under this account's own
  -- prefix and the attach route refuses anything else.
  file_key      TEXT NOT NULL,
  name          TEXT,
  content_type  TEXT,
  created_at    TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_inspection_photos ON inspection_photos(room_id, created_at);
