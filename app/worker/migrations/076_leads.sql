-- 076. LEADS FROM THE MARKETING SITE'S FREE TOOLS.
--
-- The licence checker at subsub.work/check and the handyman limit calculator
-- at subsub.work/handyman-limits ask for an email address before they show a
-- full answer (or to send one). This is where those addresses land, tagged by
-- the tool and the state they were asked about. Before this there was no lead
-- capture anywhere: the demo form books through Cal and stores nothing.
--
-- One row per submission rather than per address, because "asked about WA in
-- March and Oregon in May" is two things somebody in sales would want to
-- read. `detail` is the question in JSON (the licence number or name looked
-- up, the job value and type) and never the answer, which is the state's
-- public data and can be asked again. `ref_code` is the referral code the
-- visitor arrived with, if any.
--
-- Documented in the marketing site's README, because the tools it serves are
-- the site's.

CREATE TABLE IF NOT EXISTS leads (
  id          TEXT PRIMARY KEY,
  email       TEXT NOT NULL,
  tool        TEXT NOT NULL CHECK (tool IN ('check', 'handyman_limits')),
  state       TEXT,
  detail      TEXT NOT NULL DEFAULT '{}',
  ref_code    TEXT,
  notified    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_leads_created ON leads(created_at);
CREATE INDEX IF NOT EXISTS ix_leads_email ON leads(email);
