-- SubSub schema — Phase 1 (persistence).
-- Mirrors the prototype's in-memory shape (companies/accounts/engagements/
-- memberships) directly, so the API layer is a thin translation rather than
-- a redesign. Compound/array fields (crews, coverage, docReview, categories,
-- assignments, etc.) are stored as JSON TEXT for now — the same shape the
-- UI already reads and writes — and can be normalized into their own tables
-- later if query patterns demand it (see DEPLOYMENT.pdf for the fully
-- normalized version of crews/documents/etc).

PRAGMA foreign_keys = ON;

-- A hiring company's workspace (what the UI calls an "account").
CREATE TABLE accounts (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  subdomain         TEXT UNIQUE NOT NULL,
  plan              TEXT NOT NULL DEFAULT 'basic' CHECK (plan IN ('basic','scale')),
  billing           TEXT NOT NULL DEFAULT 'monthly' CHECK (billing IN ('monthly','annual')),
  logo_key          TEXT,               -- R2 object key; NULL = default mark
  use_default_mark  INTEGER NOT NULL DEFAULT 1,
  created_at        TEXT DEFAULT CURRENT_TIMESTAMP
);

-- A business in the world. One row no matter how many accounts engage them.
-- Deduped on license_number where present.
CREATE TABLE companies (
  id                 TEXT PRIMARY KEY,
  company             TEXT NOT NULL,
  contact              TEXT,
  phone                TEXT,
  email                TEXT,
  license              TEXT,             -- WA L&I license number, the dedup key
  ubi                  TEXT,
  license_check        TEXT,             -- JSON: cached verifyLicense() result
  city                 TEXT,
  state                TEXT,
  zip                  TEXT,
  mail_street          TEXT,
  mail_city            TEXT,
  mail_state           TEXT,
  mail_zip             TEXT,
  crews                TEXT NOT NULL DEFAULT '[]',   -- JSON: [{id,name,available,unavailableDays,members:[{name,role}]}]
  coverage             TEXT NOT NULL DEFAULT '{}',   -- JSON: {mode:'cities'|'radius', cities:[...], radii:[{zip,miles}]}
  available            INTEGER NOT NULL DEFAULT 1,
  unavailable_days     TEXT NOT NULL DEFAULT '[]',   -- JSON array of YYYY-MM-DD
  warranty             TEXT,             -- JSON
  insurance            INTEGER NOT NULL DEFAULT 0,   -- has a file uploaded (filename lives in doc_files)
  bond                 INTEGER NOT NULL DEFAULT 0,
  contract             INTEGER NOT NULL DEFAULT 0,
  w9                   INTEGER NOT NULL DEFAULT 0,
  doc_files            TEXT NOT NULL DEFAULT '{}',   -- JSON: {insurance,bond,contract,w9: filename}
  notify               TEXT NOT NULL DEFAULT '{"email":true,"sms":false}', -- JSON
  created_at           TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX idx_companies_license ON companies(license) WHERE license IS NOT NULL AND license != '';

-- The account <-> company relationship. Everything relationship-specific.
CREATE TABLE engagements (
  id             TEXT PRIMARY KEY,
  account_id     TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  company_id     TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  status         TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited','active','paused','ended')),
  doc_review     TEXT NOT NULL DEFAULT '{}',   -- JSON: per-kind {status,limits,checks,overrides,verifiedBy,verifiedAt,note}
  categories     TEXT NOT NULL DEFAULT '[]',   -- JSON array of trade ids this company covers for this account
  caps           TEXT NOT NULL DEFAULT '[]',   -- JSON array of capability ids
  rating         REAL NOT NULL DEFAULT 0,
  rated_jobs     INTEGER NOT NULL DEFAULT 0,
  accepted       INTEGER NOT NULL DEFAULT 0,
  declined       INTEGER NOT NULL DEFAULT 0,
  auto_schedule  INTEGER NOT NULL DEFAULT 0,
  notes          TEXT,
  invited_at     TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (account_id, company_id)
);
CREATE INDEX idx_engagements_account ON engagements(account_id);
CREATE INDEX idx_engagements_company ON engagements(company_id);

-- A person. Global identity — one login, many memberships.
CREATE TABLE users (
  id             TEXT PRIMARY KEY,
  auth_id        TEXT UNIQUE,        -- external auth provider's subject id
  name           TEXT NOT NULL,
  email          TEXT UNIQUE NOT NULL,
  phone          TEXT,
  created_at     TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Joins a user to an account with a role. A contractor membership carries
-- company_id (which company they represent there); admin/pm do not.
CREATE TABLE memberships (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id     TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  role           TEXT NOT NULL CHECK (role IN ('admin','pm','contractor')),
  company_id     TEXT REFERENCES companies(id),   -- set when role = 'contractor'
  created_at     TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, account_id)
);
CREATE INDEX idx_memberships_account ON memberships(account_id);
CREATE INDEX idx_memberships_user ON memberships(user_id);

-- Every project fact lives here.
CREATE TABLE jobs (
  id                  TEXT PRIMARY KEY,
  account_id          TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  title               TEXT NOT NULL,
  client              TEXT,
  address             TEXT,
  area                TEXT,            -- city label from the AREAS list
  zip                 TEXT,
  lat                 REAL,
  lng                 REAL,
  sqft                INTEGER,
  stories             INTEGER,
  date                TEXT,            -- YYYY-MM-DD start date
  time                TEXT DEFAULT '07:00',
  trades              TEXT NOT NULL DEFAULT '[]',  -- JSON array of trade ids
  scope               TEXT,
  material_source     TEXT,
  materials_paid_by   TEXT,
  measurement_docs    TEXT NOT NULL DEFAULT '[]',  -- JSON: [{key,name,uploadedAt}]
  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed')),
  completed_at        TEXT,
  notes               TEXT,
  created_by          TEXT REFERENCES users(id),
  created_at          TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_jobs_account_status ON jobs(account_id, status);

-- One work order per trade per job. Immutable once issued — to change
-- terms, void (status stays but a `voided_at` is set — see below) and
-- reissue as a new row; never UPDATE trade_scope/value_cents after issuing.
CREATE TABLE work_orders (
  id                 TEXT PRIMARY KEY,
  wo_number          TEXT UNIQUE NOT NULL,   -- WO-1234
  job_id             TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  trade              TEXT NOT NULL,
  company_id         TEXT NOT NULL REFERENCES companies(id),
  engagement_id      TEXT NOT NULL REFERENCES engagements(id),
  crew_name          TEXT,
  trade_scope        TEXT,
  value_cents        INTEGER,
  status             TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined')),
  auto_scheduled     INTEGER NOT NULL DEFAULT 0,
  response_window    TEXT,             -- e.g. '24h'; NULL when auto-scheduled
  respond_by         TEXT,
  responded_at       TEXT,
  rating             INTEGER,          -- 1-5, set after job completion
  distance           REAL,
  in_range           INTEGER,
  signed_file_key    TEXT,
  voided_at          TEXT,
  issued_at          TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (job_id, trade, voided_at)    -- one *live* WO per trade per job (voided ones don't collide)
);
CREATE INDEX idx_wo_company ON work_orders(company_id, status);
CREATE INDEX idx_wo_job ON work_orders(job_id);
CREATE INDEX idx_wo_engagement ON work_orders(engagement_id);

-- Cached WA L&I registry checks. Keep every check rather than overwriting —
-- when a dispute turns on whether someone was registered on the day they
-- worked, the history is the answer.
CREATE TABLE license_checks (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id                TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  state                     TEXT,      -- which state's registry this check ran against (WA, OR, CT, IA, IL, TX, DC)
  status                    TEXT,      -- ACTIVE / EXPIRED / SUSPENDED / NOT_FOUND / UNSUPPORTED_STATE
  license_type              TEXT,
  effective_date            TEXT,
  expiration_date           TEXT,
  suspend_date              TEXT,
  bond_amount_cents         INTEGER,
  bond_surety               TEXT,
  insurance_coverage_cents  INTEGER,
  insurance_carrier         TEXT,
  field_mapping_verified    INTEGER NOT NULL DEFAULT 0,  -- see STATE_LICENSING_APIS.md — only WA's field
                                                          -- names come from confirmed dataset knowledge;
                                                          -- every other state's are best-effort guesses
                                                          -- from search results, not a live schema check
  raw                       TEXT,      -- full JSON response — the source of truth if the mapping above is wrong
  checked_at                TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_license_checks_company ON license_checks(company_id, checked_at);

-- Uniform orders (Scale-plan feature).
CREATE TABLE uniform_orders (
  id             TEXT PRIMARY KEY,
  account_id     TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  company_id     TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  items          TEXT NOT NULL DEFAULT '[]',  -- JSON: [{sku,label,size,qty}]
  note           TEXT,
  ship           TEXT,                        -- JSON: {street,city,state,zip}
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied')),
  created_at     TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_uniform_orders_account ON uniform_orders(account_id);

-- Service calls (warranty / callback) raised against a completed job.
CREATE TABLE service_calls (
  id             TEXT PRIMARY KEY,
  account_id     TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  job_id         TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  trade          TEXT NOT NULL,
  company_id     TEXT NOT NULL REFERENCES companies(id),
  crew_name      TEXT,
  kind           TEXT NOT NULL CHECK (kind IN ('warranty','callback')),
  issue          TEXT,
  return_date    TEXT,
  status         TEXT NOT NULL DEFAULT 'awaiting-confirmation'
                 CHECK (status IN ('awaiting-confirmation','scheduled','resolved')),
  sub_note       TEXT,
  raised_by      TEXT,
  raised_at      TEXT DEFAULT CURRENT_TIMESTAMP,
  confirmed_at   TEXT,
  resolved_at    TEXT
);
CREATE INDEX idx_service_calls_account ON service_calls(account_id);

-- Append-only audit log.
CREATE TABLE events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id     TEXT,
  actor_id       TEXT,
  kind           TEXT NOT NULL,   -- wo.issued, wo.accepted, job.completed, doc.uploaded, doc.reviewed, ...
  subject_id     TEXT,
  payload        TEXT,            -- JSON
  created_at     TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_events_account ON events(account_id, created_at);
