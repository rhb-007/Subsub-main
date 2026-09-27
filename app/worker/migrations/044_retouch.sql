-- 044 — telling the people a subcontractor already sent paperwork to that it
-- has renewed.
--
-- The pack page's whole pitch is that it stays current: when the certificate
-- renews, the page shows the new one rather than the lapsed one. That promise
-- was only kept for anybody who happened to open the link again -- and the link
-- expires in SHARE_DAYS, so a year later, when the certificate actually
-- renews, every recipient is holding a dead URL.
--
-- So the renewal sends a fresh one. This is the cheapest recurring reach SubSub
-- has: it is wanted (they asked for that document), it recurs annually per
-- recipient per document without anybody doing anything, and it lands on a
-- general contractor who mostly does NOT have an account, at the moment they
-- are being reminded they have a compliance problem.
--
-- Which is exactly why it needs rails. Two tables:
--
--   doc_retouches is the suppression ledger. One row per recipient per
--   DOCUMENT ROW, so a renewal reaches somebody once and a re-run of the sweep
--   reaches them zero more times.
--
--   doc_share_optouts is the way out. A recipient who does not want these says
--   so from the pack page itself, which is already token-gated -- no new token
--   scheme, and the control lives where they already are.
--
-- Safe to run twice: every statement is IF NOT EXISTS.
--
--   npx wrangler d1 execute subsub-db --config=wrangler.toml \
--     --file=./worker/migrations/044_retouch.sql

CREATE TABLE IF NOT EXISTS doc_retouches (
  id          TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  -- Stored lowercase, the same way doc_shares stores it, or the suppression
  -- misses and somebody gets two.
  to_email    TEXT NOT NULL,
  -- The company_docs row whose arrival caused this. Keying on the row rather
  -- than the kind is what makes it once-per-renewal instead of once-ever: next
  -- year's certificate is a different row and earns another send.
  doc_id      TEXT NOT NULL REFERENCES company_docs(id) ON DELETE CASCADE,
  -- The fresh share it created, so the link in that email can be revoked with
  -- every other one rather than being untraceable.
  share_id    TEXT REFERENCES doc_shares(id) ON DELETE SET NULL,
  sent_at     TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_retouch_once
  ON doc_retouches (to_email, doc_id);
-- Read to answer "has this address heard from us lately", which caps a
-- recipient at one email however many documents renewed that week.
CREATE INDEX IF NOT EXISTS ix_retouch_recent ON doc_retouches (to_email, sent_at);

CREATE TABLE IF NOT EXISTS doc_share_optouts (
  id          TEXT PRIMARY KEY,
  to_email    TEXT NOT NULL,
  -- NULL means every company. A recipient saying "stop" about one
  -- subcontractor is not saying it about the others, and a recipient saying it
  -- about all of them must be able to.
  company_id  TEXT REFERENCES companies(id) ON DELETE CASCADE,
  created_at  TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_optout_once
  ON doc_share_optouts (to_email, COALESCE(company_id, ''));
