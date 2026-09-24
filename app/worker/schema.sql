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
  -- Who the account is. A general contractor has no building list; the other
  -- three manage a standing portfolio and scope vendors to specific properties.
  kind              TEXT NOT NULL DEFAULT 'general_contractor'
                      CHECK (kind IN ('general_contractor','property_manager',
                                      'building_owner','portfolio_manager')),
  plan              TEXT NOT NULL DEFAULT 'basic' CHECK (plan IN ('basic','scale')),
  billing           TEXT NOT NULL DEFAULT 'monthly' CHECK (billing IN ('monthly','annual')),
  logo_key          TEXT,               -- R2 object key; NULL = default mark
  use_default_mark  INTEGER NOT NULL DEFAULT 1,
  trades            TEXT,               -- JSON array of category ids the account hires out;
                                         -- NULL = never chosen, which is not the same as none
  -- Stripe linkage. Stripe stays the source of truth for money; these are a
  -- local cache of what it last told us. subscription_status is Stripe's own
  -- vocabulary kept verbatim; NULL means nobody ever subscribed, which is not
  -- the same as canceled.
  -- Complimentary: Scale features without payment. Outranks Stripe rather
  -- than being inferred from the absence of a subscription.
  comped                 INTEGER NOT NULL DEFAULT 0,
  comp_note              TEXT,
  stripe_customer_id     TEXT,
  stripe_subscription_id TEXT,
  subscription_status    TEXT,
  current_period_end     TEXT,
  theme             TEXT,               -- JSON: {bg,surface,text,accent,btnText} — the two
                                         -- pages a subcontractor sees before signing in
                                         -- (sign-in + public application form); NULL = defaults
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
  -- admin | pm | owner | contractor. No CHECK: widening one in SQLite means
  -- rebuilding the table, and the API validates the role on every write.
  role           TEXT NOT NULL,
  company_id     TEXT REFERENCES companies(id),   -- set when role = 'contractor'
  -- Which flat, door or unit, when role = 'tenant'. Free text: "4B",
  -- "Flat 2, rear" and "Shop 3" are all real answers and none of them parse.
  unit           TEXT,
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
  property_id         TEXT,            -- set when the job is at a managed property
  lat                 REAL,
  lng                 REAL,
  sqft                INTEGER,
  stories             INTEGER,
  date                TEXT,            -- YYYY-MM-DD start date
  time                TEXT DEFAULT '07:00',
  trades              TEXT NOT NULL DEFAULT '[]',  -- JSON array of trade ids
  scope               TEXT,
  material_source     TEXT,                       -- the display line: "ABC Supply — Ballard"
  material_supplier   TEXT,                       -- its id from shared/suppliers.js, or 'other'
  material_branch     TEXT,
  materials_paid_by   TEXT,
  measurement_docs    TEXT NOT NULL DEFAULT '[]',  -- JSON: [{key,name,uploadedAt}]
  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed')),
  completed_at        TEXT,
  notes               TEXT,
  created_by          TEXT REFERENCES users(id),
  -- A building owner can raise work on their own property, but it must not
  -- reach a subcontractor until the account has priced it and agreed to it.
  -- requested_by set with approved_at null is a request; both set is a job.
  requested_by        TEXT REFERENCES users(id),
  approved_at         TEXT,
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

-- ---------------------------------------------------------------------------
-- Properties (portfolio / property managers)
-- ---------------------------------------------------------------------------
-- A property belongs to one account. An engagement can be scoped to specific
-- properties; scoped to none means "available everywhere on this account",
-- which is how a general contractor uses it.
CREATE TABLE properties (
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
CREATE INDEX idx_properties_account ON properties(account_id);

-- Which properties an engagement is scoped to. No rows = every property.
-- Which properties a membership may see. No rows means no restriction, which
-- is what an admin or project manager has; a building owner is scoped to the
-- buildings listed here and an owner with none listed sees nothing.
CREATE TABLE membership_properties (
  membership_id  TEXT NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
  property_id    TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  PRIMARY KEY (membership_id, property_id)
);
CREATE INDEX idx_mp_membership ON membership_properties(membership_id);
CREATE INDEX idx_mp_property ON membership_properties(property_id);

CREATE TABLE engagement_properties (
  engagement_id TEXT NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  property_id   TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  PRIMARY KEY (engagement_id, property_id)
);
CREATE INDEX idx_engagement_properties_property ON engagement_properties(property_id);

-- ---------------------------------------------------------------------------
-- Change orders
-- ---------------------------------------------------------------------------
-- A work order is never edited once accepted. Every change is a numbered
-- change order the other side accepts or declines, so the original stays
-- intact and the revised value is derived. Either side can raise one.
CREATE TABLE change_orders (
  id                TEXT PRIMARY KEY,
  work_order_id     TEXT NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  seq               INTEGER NOT NULL,            -- 1, 2, 3 … per work order
  kind              TEXT NOT NULL,               -- added | deducted | no_cost
  origin            TEXT NOT NULL CHECK (origin IN ('gc','sub')),
  scope             TEXT NOT NULL,
  value_delta_cents INTEGER NOT NULL DEFAULT 0,  -- negative for deductions
  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','accepted','declined','expired')),
  raised_by         TEXT REFERENCES users(id),
  raised_at         TEXT DEFAULT CURRENT_TIMESTAMP,
  respond_by        TEXT,
  responded_at      TEXT,
  note              TEXT,
  UNIQUE (work_order_id, seq)
);
CREATE INDEX idx_change_orders_wo ON change_orders(work_order_id, status);

-- The revised value is derived, never stored on the work order.
CREATE VIEW work_order_revised AS
SELECT w.id,
       w.value_cents AS original_cents,
       w.value_cents + COALESCE(SUM(CASE WHEN c.status = 'accepted'
                                         THEN c.value_delta_cents END), 0) AS revised_cents,
       COUNT(CASE WHEN c.status = 'pending' THEN 1 END) AS pending_count
FROM work_orders w
LEFT JOIN change_orders c ON c.work_order_id = w.id
GROUP BY w.id;

-- ---------------------------------------------------------------------------
-- Platform console (SubSub's own staff) — see DEPLOYMENT.pdf section 9
-- ---------------------------------------------------------------------------
-- Deliberately NOT a role in the app's own role table: staff get a separate
-- surface on a separate hostname, checked server-side on every route.
CREATE TABLE superadmins (
  user_id      TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  role         TEXT NOT NULL CHECK (role IN ('superadmin','standard')),
  finance      INTEGER NOT NULL DEFAULT 0,   -- may see revenue (superadmin only)
  impersonate  INTEGER NOT NULL DEFAULT 0,   -- may sign in as an account (superadmin only)
  created_at   TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Per-account activity stream. The app writes it; the console reads it.
-- Store the rendered sentence at write time: the rows it referenced change.
CREATE TABLE activity (
  id          TEXT PRIMARY KEY,
  account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  at          TEXT NOT NULL,
  user_id     TEXT REFERENCES users(id),   -- NULL for system / staff actions
  kind        TEXT NOT NULL,               -- login, doc_verified, wo_issued, plan_changed, …
  text        TEXT NOT NULL,
  meta        TEXT                         -- JSON, optional
);
CREATE INDEX idx_activity_account_at ON activity(account_id, at DESC);
CREATE INDEX idx_activity_user_at    ON activity(user_id, at DESC);

-- Append-only subscription history. Current account state cannot tell you what
-- expansion or churn happened in a given month; this can, and it is
-- unrecoverable if not kept. MRR is normalized: annual ÷ 12.
CREATE TABLE subscription_events (
  id              TEXT PRIMARY KEY,
  account_id      TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  at              TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN
                    ('created','upgraded','downgraded','cycle','canceled','reactivated','comped')),
  from_plan       TEXT,
  to_plan         TEXT,
  cycle           TEXT CHECK (cycle IN ('monthly','annual')),
  mrr_delta_cents INTEGER NOT NULL DEFAULT 0,
  source          TEXT NOT NULL DEFAULT 'stripe'   -- stripe | platform_admin | system
);
CREATE INDEX idx_subscription_events_month ON subscription_events(substr(at, 1, 7));

-- Mirrored from Stripe webhooks. Stripe stays the source of truth for money
-- collected — never derive revenue from the accounts table alone.
CREATE TABLE invoices (
  id            TEXT PRIMARY KEY,                -- Stripe invoice id
  account_id    TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  amount_cents  INTEGER NOT NULL,
  status        TEXT NOT NULL,                   -- paid | open | void | uncollectible
  period_start  TEXT NOT NULL,
  period_end    TEXT NOT NULL,
  paid_at       TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0       -- dunning visibility
);
CREATE INDEX idx_invoices_account ON invoices(account_id);

-- Nightly rollup, so MRR-over-time doesn't scan live tables and yesterday's
-- number stays yesterday's number.
CREATE TABLE platform_daily_stats (
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
  basic_at_limit      INTEGER NOT NULL          -- the upgrade pipeline
);

-- ---------------------------------------------------------------------------
-- Public-endpoint rate limiting
-- ---------------------------------------------------------------------------
-- A Worker keeps no state between requests, so the ceiling on the two
-- unauthenticated endpoints (signup and apply) lives here. One row per
-- (bucket, window); the window is a truncated timestamp, so rows age out on
-- their own and a sweep is optional rather than required.
CREATE TABLE rate_limits (
  bucket   TEXT NOT NULL,
  window   TEXT NOT NULL,
  hits     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, window)
);
CREATE INDEX idx_rate_limits_window ON rate_limits(window);

-- ---------------------------------------------------------------------------
-- Outbound email
-- ---------------------------------------------------------------------------
-- What was actually sent, from the app's own side. Bodies are not stored: they
-- are reconstructible from the template, and keeping a copy of every notice
-- means keeping personal data with no expiry story.
CREATE TABLE email_log (
  id           TEXT PRIMARY KEY,
  account_id   TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  company_id   TEXT REFERENCES companies(id) ON DELETE SET NULL,
  to_email     TEXT NOT NULL,
  kind         TEXT NOT NULL,          -- doc_request | wo_issued | application_received
  subject      TEXT NOT NULL,
  status       TEXT NOT NULL,          -- sent | failed
  provider_id  TEXT,
  error        TEXT,
  sent_by      TEXT REFERENCES users(id),
  at           TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_email_log_account_at ON email_log(account_id, at DESC);
CREATE INDEX idx_email_log_company ON email_log(company_id, at DESC);

-- One-time invite links a customer generates and sends themselves.
--
-- The public application form at a customer's own subdomain is a Scale
-- feature: it is always on and a contractor can find it unprompted. This is
-- the Basic equivalent and deliberately weaker -- the customer has to hand
-- out each link, one contractor at a time -- so the two do not collapse into
-- the same thing.
--
-- The token is the credential. It is the only thing standing between a
-- stranger and a row in someone's contractor list, so it is generated from
-- crypto.getRandomValues, expires, and is spent on first use.
-- An invitation to become a tenant of a building. Separate from sub_invites
-- because the two are accepted by answering completely different questions:
-- a company, a licence and a trade list on one side, a building and a
-- password on the other.
CREATE TABLE tenant_invites (
  id           TEXT PRIMARY KEY,
  account_id   TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- NULL means the tenant picks from the account's buildings when they
  -- accept, which is how one link on a noticeboard would be used.
  property_id  TEXT REFERENCES properties(id) ON DELETE CASCADE,
  token        TEXT UNIQUE NOT NULL,
  label        TEXT,
  created_by   TEXT REFERENCES users(id),
  created_at   TEXT DEFAULT CURRENT_TIMESTAMP,
  expires_at   TEXT NOT NULL,
  -- Only set when something actually left, by email or by text. An invite
  -- marked sent that never went is worse than one marked nothing.
  sent_at      TEXT,
  used_at      TEXT,
  user_id      TEXT REFERENCES users(id),
  revoked_at   TEXT
);

-- The same idea for the people who work at the account -- see migration 028
-- for why this is not a row in the table above.
CREATE TABLE user_invites (
  id          TEXT PRIMARY KEY,
  account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token       TEXT UNIQUE NOT NULL,
  email       TEXT,
  created_by  TEXT REFERENCES users(id),
  created_at  TEXT DEFAULT CURRENT_TIMESTAMP,
  expires_at  TEXT NOT NULL,
  sent_at     TEXT,
  used_at     TEXT,
  revoked_at  TEXT
);
CREATE INDEX idx_user_invites_account ON user_invites(account_id, created_at);
CREATE INDEX idx_tenant_invites_account ON tenant_invites(account_id);

CREATE TABLE sub_invites (
  id          TEXT PRIMARY KEY,
  account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  token       TEXT UNIQUE NOT NULL,
  -- Who it was meant for, so a list of outstanding links is readable. Not
  -- enforced against what the applicant then types: a link passed on to the
  -- right person at the wrong company is still a real application.
  label       TEXT,
  -- Where SubSub sent it, and when it went. sent_at stays null for a link
  -- the account made to hand over itself -- see migration 027.
  email        TEXT,
  contact      TEXT,
  company_name TEXT,
  sent_at      TEXT,
  created_by  TEXT REFERENCES users(id),
  created_at  TEXT DEFAULT CURRENT_TIMESTAMP,
  expires_at  TEXT NOT NULL,
  -- Set on use. A spent invite is kept rather than deleted: the customer's
  -- list should be able to say "accepted", not just go quiet.
  used_at     TEXT,
  company_id  TEXT REFERENCES companies(id),
  revoked_at  TEXT
);
CREATE INDEX idx_sub_invites_account ON sub_invites(account_id, created_at DESC);

-- Stripe retries a webhook until it gets a 2xx, and will deliver the same
-- event twice on its own. Every handler writes something, so "have I seen
-- this event id" is the difference between one upgrade and three rows saying
-- so.
CREATE TABLE stripe_events (
  id           TEXT PRIMARY KEY,
  type         TEXT NOT NULL,
  received_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_accounts_stripe_customer ON accounts(stripe_customer_id);
