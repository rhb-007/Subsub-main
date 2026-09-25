-- Documents that actually stay current.
--
-- Until now `insurance` was a 1 and a filename, and "compliant" meant a file
-- exists. Nothing recorded when the certificate ran out. So a subcontractor
-- uploads a COI, it gets approved, and eighteen months later their card is
-- still green -- which is worse than a missing certificate, because a
-- missing one makes somebody ask and an expired one makes everybody stop
-- asking.
--
-- The only expiry dates in the system arrived from a state licensing
-- registry, for Washington, and only when the licence was found. For most
-- subcontractors there was no date at all.
--
-- A TABLE, NOT COLUMNS ON `companies`. The question that gets asked in a
-- dispute is not "are they insured" but "were they insured on the day of
-- that job", and that needs the certificate that was current then, not the
-- one current now. So each upload is a row and the old ones stay.
--
-- The existing booleans and doc_files are left exactly as they are. They
-- answer "is there a file", which is still a true and useful thing, and
-- every screen and query already written against them goes on working. This
-- adds what the file SAYS.
CREATE TABLE IF NOT EXISTS company_docs (
  id             TEXT PRIMARY KEY,
  company_id     TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL CHECK (kind IN ('insurance','bond','contract','w9')),

  file_key       TEXT,
  file_name      TEXT,

  -- What the certificate says. Captured at approval, because that is the
  -- moment somebody is looking at it -- they were already reading it, they
  -- just were not writing any of it down.
  issuer         TEXT,          -- carrier, surety, whoever wrote it
  policy_no      TEXT,
  coverage_cents INTEGER,       -- whole cents, like every other amount here
  effective_on   TEXT,          -- ISO day
  expires_on     TEXT,          -- ISO day. The one that matters.

  -- A W-9 and a signed contract do not expire, and pretending they do
  -- would put two thirds of a roster permanently amber. NULL expires_on is
  -- "does not expire", not "unknown".
  uploaded_at    TEXT DEFAULT CURRENT_TIMESTAMP,
  uploaded_by    TEXT REFERENCES users(id),
  approved_at    TEXT,
  approved_by    TEXT REFERENCES users(id),
  -- Superseded rather than deleted: the certificate that covered March has
  -- to still be findable in September.
  superseded_at  TEXT,
  created_at     TEXT DEFAULT CURRENT_TIMESTAMP
);
-- The current one per kind is the one nothing has replaced.
CREATE INDEX IF NOT EXISTS ix_company_doc_current
  ON company_docs (company_id, kind, superseded_at);
CREATE INDEX IF NOT EXISTS ix_company_doc_expiry
  ON company_docs (expires_on) WHERE superseded_at IS NULL AND expires_on IS NOT NULL;

-- What has already been chased, so a nightly sweep does not send the same
-- warning every night for thirty days.
CREATE TABLE IF NOT EXISTS doc_reminders (
  id             TEXT PRIMARY KEY,
  company_doc_id TEXT NOT NULL REFERENCES company_docs(id) ON DELETE CASCADE,
  company_id     TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  -- 30, 14, 3, 0 -- and -1 for the urgent one raised when a certificate
  -- lapses under a job that is already booked. That job is NOT blocked:
  -- stranding scheduled work over paperwork helps nobody. It is chased
  -- instead, hard.
  days_out       INTEGER NOT NULL,
  sent_at        TEXT DEFAULT CURRENT_TIMESTAMP,
  emailed        INTEGER NOT NULL DEFAULT 0,
  texted         INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_doc_reminder
  ON doc_reminders (company_doc_id, days_out);
CREATE INDEX IF NOT EXISTS ix_doc_reminder_company ON doc_reminders (company_id, sent_at);
