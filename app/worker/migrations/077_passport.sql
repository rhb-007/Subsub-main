-- 077: the Sub Passport. One public page a subcontractor owns and hands out.
--
-- Everything a GC asks for is already on the company row -- the licence and
-- its nightly check, the certificate and its expiry, the W-9 flag, the service
-- area -- so this adds only what was missing. No ALTER TABLE, so it is one
-- paste and safe to run twice.
--
-- The schema shown before building had a fifth table, passport_referrals.
-- It is gone: 075's referral_codes / referral_attributions already record who
-- referred whom, with 'passport' as one of their channels, and a second table
-- holding the same fact would be the one that went stale.

-- The page itself. One per company, and a company is the sub.
--   slug          the address, /p/<slug>: the name plus a random suffix, so it
--                 can be read but not guessed. Stamped once and never
--                 changed, because it is printed on decals and flyers.
--   published_at  NULL is private. Not public until the sub presses Publish.
--   trades        what the sub says they do, in public: their own statement,
--                 separate from what any one client engages them for.
--   founded_year  a year, never "years in business", which goes stale.
CREATE TABLE IF NOT EXISTS passports (
  company_id     TEXT PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  slug           TEXT NOT NULL UNIQUE,
  published_at   TEXT,
  trades         TEXT NOT NULL DEFAULT '[]',
  founded_year   INTEGER,
  about          TEXT,
  view_count     INTEGER NOT NULL DEFAULT 0,
  last_viewed_at TEXT,
  created_at     TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at     TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Photographs of their work. Removed, never deleted, like every other upload.
CREATE TABLE IF NOT EXISTS passport_photos (
  id          TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  file_key    TEXT NOT NULL,
  file_type   TEXT,
  caption     TEXT,
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT DEFAULT CURRENT_TIMESTAMP,
  removed_at  TEXT
);
CREATE INDEX IF NOT EXISTS ix_passport_photos_company ON passport_photos (company_id, position);

-- A hiring account asking to open the certificate and the W-9. The sub says
-- yes or no; a yes can be revoked. One live request per pair, held by the
-- partial index even when two arrive at once.
CREATE TABLE IF NOT EXISTS passport_access (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  account_id    TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  requested_by  TEXT REFERENCES users(id),
  message       TEXT,
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'approved', 'declined', 'revoked')),
  requested_at  TEXT DEFAULT CURRENT_TIMESTAMP,
  decided_at    TEXT,
  decided_by    TEXT REFERENCES users(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_passport_access_live
  ON passport_access (company_id, account_id) WHERE status IN ('pending', 'approved');

-- Licence expiry reminders, 30, 7 and 0 days out. Written BEFORE the email is
-- sent, so a night that fails halfway never sends the same one twice; keyed on
-- the expiry date, so a renewed licence earns a fresh set.
CREATE TABLE IF NOT EXISTS license_reminders (
  id          TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  expires_on  TEXT NOT NULL,
  days_out    INTEGER NOT NULL,
  emailed     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_license_reminder
  ON license_reminders (company_id, expires_on, days_out);
