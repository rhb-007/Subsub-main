-- 043 — asking your own subcontractors to price a job, before committing.
--
-- Part of "pre-award" already existed: a work order with status 'pending' IS a
-- pre-award view. The subcontractor sees the job, the address, the scope and
-- the price, and accepts or declines before anything is committed.
--
-- What did not exist is the case where the account does not know the price yet
-- and wants two or three of its own roofers to quote the same trade before it
-- commits to any of them. Work orders cannot do that: issuing one commits to a
-- number, and issuing three for the same trade collides on the live-WO index.
--
-- This is overflow's shape pointed at the account's OWN ROSTER instead of
-- broadcast: ask several, they answer with a price and a date, you pick, and
-- picking issues the work order. None of overflow's gates apply -- no opt-in,
-- no three months, no rating floor, no fee -- because these are already your
-- contractors. That is the product: running the subcontractors you have.
--
-- Safe to run twice: every statement is IF NOT EXISTS.
--
--   npx wrangler d1 execute subsub-db --config=wrangler.toml \
--     --file=./worker/migrations/043_quotes.sql

CREATE TABLE IF NOT EXISTS quote_requests (
  id            TEXT PRIMARY KEY,
  account_id    TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  job_id        TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  -- One trade. A job with roofing and electrical is two separate questions to
  -- two separate sets of companies, and a quote that covered both would be
  -- impossible to compare against one that covered either.
  trade         TEXT NOT NULL,
  -- What they are pricing, when it is narrower than the job's own scope. This
  -- is the text every invited company reads, so it has to say the same thing
  -- to all of them -- a scope that differs per company is not a comparison.
  scope         TEXT,
  -- When quotes are wanted by. Advisory: a late quote is still a quote, and
  -- refusing one because a clock ran out is how an account ends up awarding
  -- the second-best price it had.
  due_at        TEXT,
  status        TEXT NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open','awarded','cancelled')),
  awarded_company_id TEXT REFERENCES companies(id),
  -- The work order the award issued, so the request stays joined to what came
  -- of it rather than being a dead end somebody has to reconcile by hand.
  awarded_wo_id TEXT REFERENCES work_orders(id),
  created_by    TEXT REFERENCES users(id),
  created_at    TEXT DEFAULT CURRENT_TIMESTAMP,
  closed_at     TEXT
);
-- One open request per job per trade. A partial index rather than a UNIQUE on
-- a nullable column: SQLite treats NULLs as distinct in a unique index, so
-- `UNIQUE (job_id, trade, closed_at)` would happily allow a hundred open ones.
CREATE UNIQUE INDEX IF NOT EXISTS ux_quote_open
  ON quote_requests (job_id, trade) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS ix_quote_req_account ON quote_requests (account_id, status);
CREATE INDEX IF NOT EXISTS ix_quote_req_job ON quote_requests (job_id);

-- Who was asked, and what they said. One table rather than two, because unlike
-- overflow the asking account CHOSE these companies and already knows who they
-- are -- there is no distribution list to keep from them.
--
-- What must still not travel sideways is the other direction: an invited
-- company may never learn who else was asked or what they quoted. These are
-- competing bids, and one of them is the price the account is about to pay.
CREATE TABLE IF NOT EXISTS quote_invites (
  id           TEXT PRIMARY KEY,
  request_id   TEXT NOT NULL REFERENCES quote_requests(id) ON DELETE CASCADE,
  company_id   TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'invited'
                 CHECK (status IN ('invited','quoted','passed','withdrawn')),
  -- Whole cents, like everything else that is money here. NULL until they
  -- answer, and still NULL on a pass -- "no" carries no price.
  price_cents  INTEGER,
  -- When they could be there. Very often the thing that decides it rather
  -- than the number: the cheapest quote that starts in March is not cheaper.
  can_start    TEXT,
  note         TEXT,
  invited_at   TEXT DEFAULT CURRENT_TIMESTAMP,
  answered_at  TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_quote_invite
  ON quote_invites (request_id, company_id);
CREATE INDEX IF NOT EXISTS ix_quote_invite_company
  ON quote_invites (company_id, status);
