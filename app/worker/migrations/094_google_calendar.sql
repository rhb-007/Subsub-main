-- 094. Google Calendar: SubSub jobs on a person's own calendar, and their
-- busy times read so SubSub does not book them over something else.
--
-- One connection per PERSON, not per account: a calendar belongs to whoever
-- carries the phone, and the same person may hold seats on several accounts.
-- The refresh token is sealed with INTEGRATION_SECRET_KEY, as CompanyCam's is.
--
-- `gcal_events` maps a visit to the event written for it, with a fingerprint
-- so an unchanged visit is not written again. `gcal_states` is the one-use
-- state for the trip to Google's consent screen and back.
--
-- Three tables, every statement IF NOT EXISTS, so the paste can be run twice.
CREATE TABLE IF NOT EXISTS gcal_connections (
  user_id        TEXT PRIMARY KEY,
  google_email   TEXT,
  refresh_enc    TEXT NOT NULL,
  calendar_id    TEXT,
  time_zone      TEXT NOT NULL DEFAULT 'UTC',
  sync_on        INTEGER NOT NULL DEFAULT 1,
  block_on       INTEGER NOT NULL DEFAULT 1,
  connected_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_synced_at TEXT,
  last_error     TEXT
);
CREATE TABLE IF NOT EXISTS gcal_events (
  user_id     TEXT NOT NULL,
  visit_id    TEXT NOT NULL,
  event_id    TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  synced_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, visit_id)
);
CREATE TABLE IF NOT EXISTS gcal_states (
  state      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  return_to  TEXT,
  time_zone  TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  used_at    TEXT
);
