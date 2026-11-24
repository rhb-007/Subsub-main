-- 108. CRM sales appointments on Google Calendar, on a calendar of their own
-- called "SubSub Sales". The rules are in shared/gcal.js; the sync is beside
-- the 094 job sync in worker/index.js.
--
-- One paste. Two new tables and no ALTER TABLE, so running it twice does
-- nothing. It reuses the 094 connection (one Google account, one sealed
-- refresh token, the same two scopes): this is a second calendar on it, not
-- a second connection.

-- One row per person once they have touched the setting or had a calendar
-- made. NO ROW IS ON: a sales manager who connected Google Calendar for their
-- jobs gets their estimates too, and a person with no sales appointments never
-- gets a calendar, because it is made only once there is something to put on
-- it. calendar_id is the "SubSub Sales" calendar; NULL until it is made.
CREATE TABLE IF NOT EXISTS gcal_sales (
  user_id        TEXT PRIMARY KEY,
  sales_on       INTEGER NOT NULL DEFAULT 1,
  calendar_id    TEXT,
  last_synced_at TEXT,
  last_error     TEXT
);

-- Which event was written for which sales appointment, with a fingerprint
-- so an unchanged appointment is not written again.
CREATE TABLE IF NOT EXISTS gcal_sales_events (
  user_id        TEXT NOT NULL,
  appointment_id TEXT NOT NULL,
  event_id       TEXT NOT NULL,
  fingerprint    TEXT NOT NULL,
  synced_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, appointment_id)
);
