-- Migration 002 — properties, change orders, and the platform console tables.
--
-- schema.sql is the full picture for a FRESH database and is not re-runnable
-- against a live one (its CREATE TABLEs have no IF NOT EXISTS). Apply this
-- file instead to a database that already has migration 001, either from the
-- D1 console or with:
--
--   npx wrangler d1 execute subsub-db --config=wrangler.toml \
--     --file=./worker/migrations/002_properties_change_orders_platform.sql
--
-- Every statement is guarded, so running it twice is harmless. The one
-- exception is the ALTER on jobs: SQLite has no ADD COLUMN IF NOT EXISTS, so
-- it errors the second time with "duplicate column name: property_id". That
-- error is safe to ignore; nothing after it depends on the ALTER succeeding.

ALTER TABLE jobs ADD COLUMN property_id TEXT;

CREATE TABLE IF NOT EXISTS properties (
  id          TEXT PRIMARY KEY,
  account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  address     TEXT,
  city        TEXT,
  state       TEXT,
  zip         TEXT,
  units       INTEGER,
  notes       TEXT,
  created_at  TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_properties_account ON properties(account_id);

CREATE TABLE IF NOT EXISTS engagement_properties (
  engagement_id TEXT NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  property_id   TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  PRIMARY KEY (engagement_id, property_id)
);
CREATE INDEX IF NOT EXISTS idx_engagement_properties_property ON engagement_properties(property_id);

CREATE TABLE IF NOT EXISTS change_orders (
  id                TEXT PRIMARY KEY,
  work_order_id     TEXT NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  seq               INTEGER NOT NULL,
  kind              TEXT NOT NULL,
  origin            TEXT NOT NULL CHECK (origin IN ('gc','sub')),
  scope             TEXT NOT NULL,
  value_delta_cents INTEGER NOT NULL DEFAULT 0,
  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','accepted','declined','expired')),
  raised_by         TEXT REFERENCES users(id),
  raised_at         TEXT DEFAULT CURRENT_TIMESTAMP,
  respond_by        TEXT,
  responded_at      TEXT,
  note              TEXT,
  UNIQUE (work_order_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_change_orders_wo ON change_orders(work_order_id, status);

DROP VIEW IF EXISTS work_order_revised;
CREATE VIEW work_order_revised AS
SELECT w.id,
       w.value_cents AS original_cents,
       w.value_cents + COALESCE(SUM(CASE WHEN c.status = 'accepted'
                                         THEN c.value_delta_cents END), 0) AS revised_cents,
       COUNT(CASE WHEN c.status = 'pending' THEN 1 END) AS pending_count
FROM work_orders w
LEFT JOIN change_orders c ON c.work_order_id = w.id
GROUP BY w.id;

CREATE TABLE IF NOT EXISTS superadmins (
  user_id      TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  role         TEXT NOT NULL CHECK (role IN ('superadmin','standard')),
  finance      INTEGER NOT NULL DEFAULT 0,
  impersonate  INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS activity (
  id          TEXT PRIMARY KEY,
  account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  at          TEXT NOT NULL,
  user_id     TEXT REFERENCES users(id),
  kind        TEXT NOT NULL,
  text        TEXT NOT NULL,
  meta        TEXT
);
CREATE INDEX IF NOT EXISTS idx_activity_account_at ON activity(account_id, at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_user_at    ON activity(user_id, at DESC);

CREATE TABLE IF NOT EXISTS subscription_events (
  id              TEXT PRIMARY KEY,
  account_id      TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  at              TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN
                    ('created','upgraded','downgraded','cycle','canceled','reactivated','comped')),
  from_plan       TEXT,
  to_plan         TEXT,
  cycle           TEXT CHECK (cycle IN ('monthly','annual')),
  mrr_delta_cents INTEGER NOT NULL DEFAULT 0,
  source          TEXT NOT NULL DEFAULT 'stripe'
);
CREATE INDEX IF NOT EXISTS idx_subscription_events_month ON subscription_events(substr(at, 1, 7));

CREATE TABLE IF NOT EXISTS invoices (
  id            TEXT PRIMARY KEY,
  account_id    TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  amount_cents  INTEGER NOT NULL,
  status        TEXT NOT NULL,
  period_start  TEXT NOT NULL,
  period_end    TEXT NOT NULL,
  paid_at       TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_invoices_account ON invoices(account_id);

CREATE TABLE IF NOT EXISTS platform_daily_stats (
  day                 TEXT PRIMARY KEY,
  mrr_cents           INTEGER NOT NULL,
  arr_cents           INTEGER NOT NULL,
  accounts_basic      INTEGER NOT NULL,
  accounts_scale      INTEGER NOT NULL,
  accounts_annual     INTEGER NOT NULL,
  new_accounts        INTEGER NOT NULL,
  conversions         INTEGER NOT NULL,
  churned             INTEGER NOT NULL,
  gmv_accepted_cents  INTEGER NOT NULL,
  basic_at_limit      INTEGER NOT NULL
);
