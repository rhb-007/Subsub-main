-- Overflow: broadcast to opted-in companies, never a directory.
--
-- The moment this is for: a pipe bursts on a Sunday, the account's two
-- plumbers are both booked, and without this the property manager rings
-- strangers off a search engine. So they may put the job out.
--
-- READ shared/overflow.js BEFORE CHANGING ANY OF THIS. The shapes below are
-- built around one property that is easy to destroy by accident:
--
--   THE POSTING ACCOUNT NEVER LEARNS WHO IT WENT TO. `overflow_invites` is
--   the distribution list and it is SERVER-SIDE ONLY -- no route returns it,
--   not filtered, not counted. A count of how many companies were asked is a
--   measure of the platform's roster and is nobody's to have. The account
--   sees `overflow_responses`: the ones who answered.
--
-- Two tables rather than one because they answer different questions and have
-- different audiences. Collapsing them into a single table with a status
-- column would put "we asked them and they said nothing" in the same rows the
-- posting account reads, and the first innocent SELECT * would leak the
-- roster.
--
--   npx wrangler d1 execute subsub-db --config=wrangler.toml --remote \
--     --file=./worker/migrations/038_overflow.sql
--
-- The three ALTERs are first and on purpose: they are the statements that
-- cannot run twice, so a re-run fails on the first one and nothing after it
-- is half-applied. Run this paste on its own.
ALTER TABLE companies ADD COLUMN overflow_opt_in INTEGER NOT NULL DEFAULT 0;

-- Which trades they want a stranger's emergency for. Declared by them, not
-- inferred from the trades other accounts have them down for: reading one
-- account's engagement rows to decide what to send another account's job to
-- would be exactly the cross-account accumulation the product forbids.
ALTER TABLE companies ADD COLUMN overflow_trades TEXT NOT NULL DEFAULT '[]';

-- When they became reachable. Eligibility needs time served and `created_at`
-- on companies is when somebody TYPED THEM IN, which for most of the table is
-- an account adding a contact, not a business joining SubSub.
ALTER TABLE companies ADD COLUMN overflow_since TEXT;

-- One broadcast. Belongs to the account that posted it.
CREATE TABLE IF NOT EXISTS overflow_posts (
  id              TEXT PRIMARY KEY,
  account_id      TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  job_id          TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  trade           TEXT NOT NULL,
  severity        TEXT NOT NULL DEFAULT 'urgent',   -- 911 | urgent | standard
  scope           TEXT,                              -- what the work is
  value_cents     INTEGER,                           -- the ceiling offered
  -- Stamped at the moment the post is made, exactly like wo_releases.fee_bps
  -- and for the same reason: switching the rate on next year must not rewrite
  -- what was charged this year. Zero until payment processing ships.
  fee_bps         INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open','filled','cancelled','expired')),
  -- Past this it is not an emergency any more and answering helps nobody.
  expires_at      TEXT NOT NULL,
  filled_company_id TEXT REFERENCES companies(id),
  filled_wo_id    TEXT,
  created_by      TEXT REFERENCES users(id),
  created_at      TEXT DEFAULT CURRENT_TIMESTAMP,
  closed_at       TEXT
);
CREATE INDEX IF NOT EXISTS ix_overflow_post_account ON overflow_posts (account_id, status);
CREATE INDEX IF NOT EXISTS ix_overflow_post_open ON overflow_posts (status, expires_at);
-- One live post per job and trade. Two broadcasts for the same slot would
-- have two companies each told they were being asked about the same work.
CREATE UNIQUE INDEX IF NOT EXISTS ux_overflow_post_slot
  ON overflow_posts (job_id, trade) WHERE status = 'open';

-- WHO IT WENT TO. Server-side only. Nothing returns this to any account, and
-- no aggregate of it either -- see the header. It exists so a post is not
-- re-sent to the same company twice and so support can answer "did they get
-- it" without guessing.
CREATE TABLE IF NOT EXISTS overflow_invites (
  id          TEXT PRIMARY KEY,
  post_id     TEXT NOT NULL REFERENCES overflow_posts(id) ON DELETE CASCADE,
  company_id  TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  sent_at     TEXT DEFAULT CURRENT_TIMESTAMP,
  emailed     INTEGER NOT NULL DEFAULT 0,
  texted      INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_overflow_invite ON overflow_invites (post_id, company_id);
CREATE INDEX IF NOT EXISTS ix_overflow_invite_company ON overflow_invites (company_id, sent_at);

-- WHO ANSWERED. This is what the posting account is allowed to see, and only
-- for their own posts.
--
-- A response is an OFFER. It does not book anybody: the account still picks,
-- and picking is what issues the work order. So a company answering has not
-- committed their calendar to a job they may not get.
CREATE TABLE IF NOT EXISTS overflow_responses (
  id          TEXT PRIMARY KEY,
  post_id     TEXT NOT NULL REFERENCES overflow_posts(id) ON DELETE CASCADE,
  company_id  TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  status      TEXT NOT NULL DEFAULT 'offered'
                CHECK (status IN ('offered','withdrawn','passed')),
  -- What they will do it for, if they want to say. Blank means the posted
  -- ceiling is fine.
  price_cents INTEGER,
  -- When they can be there. The thing the account actually needs to know.
  can_start   TEXT,
  note        TEXT,
  created_at  TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at  TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_overflow_response ON overflow_responses (post_id, company_id);
CREATE INDEX IF NOT EXISTS ix_overflow_response_post ON overflow_responses (post_id, status);
