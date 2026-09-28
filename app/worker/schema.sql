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
  -- Who the account is. A general contractor and a subcontractor have no
  -- building list; the other three manage a standing portfolio and scope
  -- vendors to specific properties. A subcontractor is the one kind here that
  -- is HIRED rather than hiring, and it exists because the
  -- send-your-compliance-pack loop is aimed at them: without it a roofer had to
  -- call itself a general contractor to get a hireable account.
  --
  -- Note that a database grown through the migrations has NO check here at all:
  -- 003 added `kind` as plain TEXT on purpose, because constraining an existing
  -- table needs a full rebuild. So this list and a live database can disagree,
  -- and adding a kind means updating both this and 047. CHECK.sql reports which
  -- shape the database in front of you actually has.
  kind              TEXT NOT NULL DEFAULT 'general_contractor'
                      CHECK (kind IN ('general_contractor','subcontractor',
                                      'property_manager','building_owner',
                                      'portfolio_manager')),
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
  -- 013. Without this the app had to guess, and it guessed "renews" -- telling
  -- somebody who cancelled that they will be charged again is a support ticket,
  -- and telling somebody who did not that their access ends is worse.
  cancel_at_period_end   INTEGER NOT NULL DEFAULT 0,
  theme             TEXT,               -- JSON: {bg,surface,text,accent,btnText} — the two
                                         -- pages a subcontractor sees before signing in
                                         -- (sign-in + public application form); NULL = defaults
  -- 010. The branded hostname, as Cloudflare last reported it:
  --   NULL          never asked for
  --   'pending'     registered, certificate not issued yet
  --   'active'      live; the customer can open it
  --   'failed'      Cloudflare refused; hostname_error says what it said
  --   'removed'     deliberately taken down (downgrade, or account deleted)
  hostname_status   TEXT,
  -- Cloudflare's own words, kept verbatim. A paraphrase is not something
  -- support can search for.
  hostname_error    TEXT,
  hostname_checked_at TEXT,
  -- 023. The subcontractor this account has named to take urgent call-outs.
  -- Nothing dispatches itself until somebody sets it deliberately: a feature
  -- that spends money on its own should not arrive switched on.
  emergency_company_id TEXT,
  -- 031. An account is a company too, for the kinds that can be hired. The row
  -- is what somebody else's roster points at. CHECK.sql's m031_hireable_without
  -- and m031_others_with are the invariant: every hireable kind has one, and no
  -- other kind does.
  company_id        TEXT REFERENCES companies(id),
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
  -- 030. What their QR code carries. Minted on first use rather than
  -- backfilled: a code nobody has been told about is just a column.
  connect_code         TEXT,
  -- 038. Overflow eligibility. Opting in is theirs to do; overflow_since is
  -- when they did, and is NOT what the three-month rule counts from -- that
  -- runs from when they joined, or this column would make a year-old
  -- subcontractor "too new" for a quarter.
  overflow_opt_in      INTEGER NOT NULL DEFAULT 0,
  overflow_trades      TEXT NOT NULL DEFAULT '[]',   -- JSON array of category ids
  overflow_since       TEXT,
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
  notify         TEXT,               -- 018. JSON: {email,sms}; NULL = never chosen
  avatar_key     TEXT,               -- 032. R2 object key; a person's photograph,
                                     -- which is not a company logo and sits behind auth
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
  -- 020/021. A report taken back by the person who made it, and a request the
  -- account turned down. Both keep the row: the question afterwards is what was
  -- asked for and what happened to it.
  withdrawn_at        TEXT,
  withdrawn_note      TEXT,
  declined_at         TEXT,
  declined_note       TEXT,
  -- 022. What a tenant actually reported. `photos` is a JSON array of R2 keys;
  -- `report_detail` holds { problem, started, words, unit } and `scope` is
  -- composed from it, so a contractor still reads one sentence.
  photos              TEXT,
  report_detail       TEXT,
  severity            TEXT,           -- 023. app/shared/severity.js decides it
  -- 025. Last activity, so a job somebody is working on floats. Deliberately
  -- not completed_at, which holds a date with no time.
  updated_at          TEXT,
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
  -- 024. Hourly work. value_cents keeps meaning the most this work order can
  -- cost -- rate x cap for an hourly one -- so every total already written
  -- against it goes on working untouched.
  pay_kind           TEXT NOT NULL DEFAULT 'fixed',   -- 'fixed' | 'hourly'
  rate_cents         INTEGER,
  cap_hours          REAL,
  -- 034. Retainage held back from each release, in basis points.
  retainage_bps      INTEGER NOT NULL DEFAULT 0,
  -- 036. Whether the subcontractor is supplying materials. 'labor_only' is a
  -- declaration somebody signs rather than an absence nobody recorded, and it
  -- moves the lien exposure UP to the hiring account's own supply house.
  scope_kind         TEXT NOT NULL DEFAULT 'labor_materials',
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
  -- 039. account_id means WHO OPERATES IT; this means who owns it. Equal for
  -- every row that existed before 039, which is the truthful backfill -- and
  -- the reason 040 exists, since that equality cannot tell a building an agent
  -- owns from one they merely typed in. CHECK.sql's m039_unowned must read 0.
  owner_account_id TEXT REFERENCES accounts(id),
  -- 040. Said out loud, with a name and a date against it: this firm owns this
  -- building. Per building, never per account, and it never outranks ownership.
  owner_declared_at TEXT,
  owner_declared_by TEXT REFERENCES users(id),
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
  phone        TEXT,
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


-- ===========================================================================
-- EVERYTHING BELOW ARRIVED BY MIGRATION
-- ===========================================================================
--
-- This file and worker/migrations/ are two records of one database, and they
-- have to agree. This file is what a FRESH database is built from -- a new
-- environment, a preview, and every Worker test that calls freshDb(). The
-- migrations are what the LIVE database was built from, one hand-run paste at
-- a time.
--
-- They stopped agreeing somewhere around 010 and nobody noticed for
-- thirty-five migrations, because nothing compared them. By 045 this file was
-- missing twenty-six tables, eighty indexes and thirty columns, which had two
-- costs. A fresh install was born broken -- CHECK.sql could not even be RUN
-- against it, so the one tool for spotting the drift was disabled by the
-- drift. And every Worker test got a database no customer has: a route reading
-- a post-010 column threw "no such column", which the Worker deliberately
-- reports as `migration_needed` rather than a 500, so a real bug read as a
-- database behind the code and a route that quietly does nothing when a column
-- is missing passed while writing nothing at all.
--
-- `npm run test:schemadrift` is the check that was missing. ADD A COLUMN OR A
-- TABLE HERE IN THE SAME CHANGE AS THE MIGRATION, not afterwards.
--
-- The blocks below are lifted verbatim from the migration that introduced
-- them, comments included, and IF NOT EXISTS is kept: these statements are
-- read by people who are about to run something against a real database, and
-- the reasoning is the half worth having.

-- ---------------------------------------------------------------------------
-- 025 / 031 — two indexes on tables that already existed
-- ---------------------------------------------------------------------------

-- Jobs with recent activity float to the top of the list, so the ordering key
-- is indexed with the scope it is always read under.
CREATE INDEX IF NOT EXISTS idx_jobs_updated ON jobs(account_id, updated_at);

-- Two accounts must never share one company row. Partial, because most
-- accounts have none and NULL is the ordinary case rather than an error.
CREATE UNIQUE INDEX IF NOT EXISTS ux_accounts_company
  ON accounts(company_id) WHERE company_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 011 — outbound text messages
-- ---------------------------------------------------------------------------

-- Every SMS SubSub sends, what it cost and what it was billed at.
--
-- Nothing writes to this yet -- SMS is not wired up. It exists now because
-- the platform console reports SMS usage and revenue, and a dashboard metric
-- backed by a number typed into the interface is a number that will still be
-- wrong the day it starts mattering. Backed by this, the tile reads zero
-- today and starts being true the moment the first message is sent, with no
-- further console work.
--
-- Two money columns, deliberately:
--
--   cost_cents    what the carrier charges us. A cost, not revenue.
--   billed_cents  what the account is charged for it. Zero while messages
--                 are included in a plan; the margin between the two is the
--                 whole reason to record both rather than inferring one.
CREATE TABLE IF NOT EXISTS sms_log (
  id           TEXT PRIMARY KEY,
  account_id   TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  company_id   TEXT REFERENCES companies(id) ON DELETE SET NULL,
  to_phone     TEXT NOT NULL,
  kind         TEXT NOT NULL,                   -- wo_issued | doc_request | reminder | …
  -- Carriers bill per 160-character segment, not per message, so a long
  -- message is several. Counting messages would understate the bill.
  segments     INTEGER NOT NULL DEFAULT 1,
  cost_cents   INTEGER NOT NULL DEFAULT 0,
  billed_cents INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL,                   -- sent | failed
  provider_id  TEXT,
  error        TEXT,
  at           TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sms_log_at ON sms_log(at);

CREATE INDEX IF NOT EXISTS idx_sms_log_account_at ON sms_log(account_id, at DESC);

-- ---------------------------------------------------------------------------
-- 012 — staff acting as a customer
-- ---------------------------------------------------------------------------

-- Staff acting inside a customer's account, for as long as it takes to see
-- what they are seeing.
--
-- "Sign in as this account" set the browser's idea of who it was and handed
-- over nothing the API would accept: the staff member's own login has no
-- membership in the customer's account, so every call was refused and the
-- app fell back to its last resort -- role "contractor" with no contractor
-- record -- and showed an empty screen. The button had been advertising a
-- session it could not issue.
--
-- The grant is this row, not the header carrying it. That is the whole
-- point: it expires on its own, it can be handed back, and it is one
-- account and one identity rather than a general-purpose key. A token that
-- leaks is worth half an hour of one customer's account and is revocable
-- the moment anybody notices, which is not true of a signed blob nobody can
-- take back.
--
-- It also cannot reach the platform console: /api/platform/* authenticates
-- staff separately and never consults this table, so an impersonation
-- session can do what the customer can do and nothing more.
CREATE TABLE IF NOT EXISTS impersonation_sessions (
  token           TEXT PRIMARY KEY,          -- 32 bytes from crypto.getRandomValues, hex
  account_id      TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- Whose seat they are sitting in. An admin of that account, so the role
  -- and permissions are the customer's own rather than anything invented.
  act_as_user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- And who is really doing it. Every request under this token is
  -- attributable to a person, which is what makes the banner's promise
  -- ("actions are recorded") true rather than decorative.
  staff_user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason          TEXT,
  created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at      TEXT NOT NULL,
  ended_at        TEXT                       -- set when handed back, before it expires
);

CREATE INDEX IF NOT EXISTS idx_impersonation_account
  ON impersonation_sessions(account_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 019 — proposed visit times
-- ---------------------------------------------------------------------------

-- Migration 019 — a proposed time for a repair, confirmed by the tenant.
--
-- A report used to go from "contractor assigned" to "done" with the person
-- who lives there told nothing about when anybody would turn up. A visit is
-- the manager's (or the contractor's) proposed date and window, which the
-- tenant confirms or declines in the app. Only a confirmed visit puts a
-- date on the job and reads as "Scheduled" to the tenant.
--
-- One live visit per job: proposing again supersedes whatever was there.
--
--   npx wrangler d1 execute subsub-db --config=wrangler.toml \
--     --file=./worker/migrations/019_visits.sql
--
-- Safe to re-run.
CREATE TABLE IF NOT EXISTS visits (
  id            TEXT PRIMARY KEY,
  account_id    TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  job_id        TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  proposed_by   TEXT REFERENCES users(id),
  date          TEXT NOT NULL,           -- YYYY-MM-DD
  start_time    TEXT,                    -- HH:MM, 24h
  end_time      TEXT,
  note          TEXT,                    -- from whoever proposed it
  -- proposed | confirmed | declined | superseded
  status        TEXT NOT NULL DEFAULT 'proposed',
  tenant_note   TEXT,                    -- why it doesn't work, when it doesn't
  created_at    TEXT DEFAULT CURRENT_TIMESTAMP,
  responded_at  TEXT
);

CREATE INDEX IF NOT EXISTS idx_visits_job ON visits(job_id);

CREATE INDEX IF NOT EXISTS idx_visits_account ON visits(account_id);

-- ---------------------------------------------------------------------------
-- 030 — asking a company already here to connect
-- ---------------------------------------------------------------------------

-- Connecting to a contractor who is already on SubSub.
--
-- Two things arrive here, and they are the same thing underneath.
--
-- A general contractor types a subcontractor's email or licence into the
-- add-a-contractor form, and that company is already on SubSub -- working
-- for two other accounts, with its trades, crews, coverage, insurance and
-- bond already filled in and verified. Until now the form made them type
-- the whole profile again, and the server quietly reused the existing
-- company at the end without telling anybody. Worse than the retyping: the
-- engagement appeared with no word to the contractor at all.
--
-- And a subcontractor standing in front of a general contractor wants to
-- be added without spelling out an email address. They show the QR code in
-- their portal, it is scanned, and the same thing happens.
--
-- Both now create a REQUEST that the contractor answers. The reason is
-- that connecting is not the hiring account's to grant: it hands over that
-- contractor's documents, crews and availability to a company they may
-- never have heard of. An engagement is created only when they accept.
CREATE TABLE IF NOT EXISTS connect_requests (
  id            TEXT PRIMARY KEY,
  account_id    TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  company_id    TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','accepted','declined','cancelled')),
  -- How it was started, so the contractor can see whether they showed
  -- somebody a code or whether a stranger typed their address in.
  via           TEXT NOT NULL DEFAULT 'lookup' CHECK (via IN ('lookup','code')),
  requested_by  TEXT REFERENCES users(id),
  message       TEXT,
  created_at    TEXT DEFAULT CURRENT_TIMESTAMP,
  responded_at  TEXT
);

-- One LIVE request per pair. A partial index rather than a plain UNIQUE,
-- because a contractor who declined in March must be askable again in
-- September, and a plain unique constraint would make the first refusal
-- permanent.
CREATE UNIQUE INDEX IF NOT EXISTS ux_connect_pending
  ON connect_requests (account_id, company_id) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS ix_connect_company ON connect_requests (company_id, status);

CREATE INDEX IF NOT EXISTS ix_connect_account ON connect_requests (account_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS ux_company_connect_code
  ON companies (connect_code) WHERE connect_code IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 033 — the payment ledger
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- What the work is broken into.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wo_milestones (
  id             TEXT PRIMARY KEY,
  work_order_id  TEXT NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  -- Denormalised on purpose: every read of this table is scoped to one
  -- account, and joining three tables to prove it is how a scoping bug gets
  -- written.
  account_id     TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  seq            INTEGER NOT NULL,
  label          TEXT NOT NULL,
  amount_cents   INTEGER NOT NULL DEFAULT 0,
  -- reached: the subcontractor says this part is done.
  -- verified: the hiring account agrees. Only then is anything owed.
  -- Two parties, and neither can do both -- that is what makes the record
  -- worth something to somebody who was not there.
  status         TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','reached','verified','rejected')),
  reached_at     TEXT,
  reached_by     TEXT REFERENCES users(id),
  verified_at    TEXT,
  verified_by    TEXT REFERENCES users(id),
  note           TEXT,
  created_at     TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_wo_milestone_seq ON wo_milestones (work_order_id, seq);

CREATE INDEX IF NOT EXISTS ix_wo_milestone_wo ON wo_milestones (work_order_id, status);

CREATE INDEX IF NOT EXISTS ix_wo_milestone_acct ON wo_milestones (account_id, status);

-- ---------------------------------------------------------------------------
-- What happened, in order, for ever.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wo_events (
  id             TEXT PRIMARY KEY,
  work_order_id  TEXT NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  account_id     TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  milestone_id   TEXT REFERENCES wo_milestones(id) ON DELETE SET NULL,
  kind           TEXT NOT NULL,
  -- Who, in three parts, because "the contractor" is not an answer when the
  -- contractor is a company with four people on it.
  actor_user_id  TEXT REFERENCES users(id),
  actor_role     TEXT,
  actor_company_id TEXT REFERENCES companies(id),
  at             TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Whatever the event needs: photo keys, a note, the amounts as they stood.
  -- Amounts are copied in rather than referenced, because a release has to
  -- keep saying what it said even after a change order moves the total.
  payload        TEXT,
  -- A retry must not write the event twice. Every writer supplies one.
  idem_key       TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_wo_event_idem ON wo_events (idem_key) WHERE idem_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_wo_event_wo ON wo_events (work_order_id, at);

CREATE INDEX IF NOT EXISTS ix_wo_event_acct ON wo_events (account_id, at);

-- ---------------------------------------------------------------------------
-- What is owed, and whether it has gone.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wo_releases (
  id             TEXT PRIMARY KEY,
  work_order_id  TEXT NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  account_id     TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  milestone_id   TEXT REFERENCES wo_milestones(id) ON DELETE SET NULL,
  -- Who is owed. Not derived from the work order at read time: a company can
  -- be replaced on a job, and who was owed in March must stay March's answer.
  company_id     TEXT NOT NULL REFERENCES companies(id),
  gross_cents    INTEGER NOT NULL,
  retainage_cents INTEGER NOT NULL DEFAULT 0,
  -- The rate AND the money. The rate is stamped at the moment the release is
  -- made so a fee change next year cannot rewrite what was charged last
  -- year. Zero until payment processing exists, which is the point: the
  -- column is here from the first row rather than added once there is
  -- history to backfill.
  fee_bps        INTEGER NOT NULL DEFAULT 0,
  fee_cents      INTEGER NOT NULL DEFAULT 0,
  net_cents      INTEGER NOT NULL,
  status         TEXT NOT NULL DEFAULT 'due'
                   CHECK (status IN ('due','paid','void')),
  -- The seam. 'manual' is a cheque, a transfer, whatever they already do,
  -- with the reference typed in. A processor becomes another value here and
  -- a transfer id in `reference`; nothing else about this table changes.
  method         TEXT,
  reference      TEXT,
  settled_at     TEXT,
  settled_by     TEXT REFERENCES users(id),
  idem_key       TEXT,
  created_at     TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_wo_release_idem ON wo_releases (idem_key) WHERE idem_key IS NOT NULL;

-- One release per milestone. Paying the same milestone twice is the failure
-- this whole table exists to make impossible, so it is a constraint and not
-- a check somebody remembers to write.
CREATE UNIQUE INDEX IF NOT EXISTS ux_wo_release_milestone
  ON wo_releases (milestone_id) WHERE milestone_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_wo_release_wo ON wo_releases (work_order_id, status);

CREATE INDEX IF NOT EXISTS ix_wo_release_acct ON wo_releases (account_id, status);

CREATE INDEX IF NOT EXISTS ix_wo_release_company ON wo_releases (company_id, status);

-- ---------------------------------------------------------------------------
-- 035 — lien waivers, as a chain
-- ---------------------------------------------------------------------------

-- Lien waivers, as a chain rather than a filing cabinet.
--
-- The thing a general contractor is actually exposed to is not their
-- subcontractor. It is whoever their subcontractor did not pay. A waiver
-- binds only the party that signs it, so a signed waiver from Cascade
-- Roofworks does nothing about the supply house Cascade still owes -- that
-- supplier can lien the owner's building and the general contractor can end
-- up paying twice.
--
-- So a waiver is not a document attached to a payment. It is a link in a
-- chain, and the chain is what is worth anything:
--
--   tier 0   the account's own contractor signs to the account
--   tier 1   that contractor's supplier or lower-tier sub signs to them
--   tier 2+  rarer, and capped by the account rather than by this table
--
-- Which means the same row shape at every level, a parent pointer, and a
-- roll-up that is a STATUS and never a list: a general contractor is
-- entitled to know their subcontractor's chain is clear, and is not
-- entitled to their subcontractor's supplier list. That is the
-- subcontractor's book -- their sources and, by inference, their margins --
-- and handing it over is the mining this product does not do.
--
-- AND OFTEN THERE IS NO CHAIN AT ALL. A great deal of the time the general
-- contractor buys the materials and the subcontractor is labour; jobs
-- already record which supplier, because the general contractor is the one
-- who chose it (see 026). Then the subcontractor has nobody below them and
-- the exposure moves UP: the general contractor's own supply house can lien
-- the owner. Same table, read in the other direction -- owner, contractor,
-- subcontractor -- which is why `to_company_id` is a company and not "the
-- account".
--
-- scope_kind is what makes that case safe rather than skipped. "Labour only,
-- no materials or equipment furnished" is an attestation somebody signs, not
-- an absence nobody recorded.
--
-- SubSub authors no document here. It requests, tracks, gates payment on,
-- and stores what was signed. Generating waiver text is a separate decision
-- with a lawyer attached: roughly a dozen states prescribe the exact
-- wording and a form that deviates can be void.
CREATE TABLE IF NOT EXISTS lien_waivers (
  id             TEXT PRIMARY KEY,
  job_id         TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  -- The account whose chain this belongs to. Denormalised so every read is
  -- scoped without a three-table join to prove it.
  account_id     TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,

  -- Who signs: the party being paid.
  from_company_id TEXT REFERENCES companies(id),
  -- ...or a supply house with no company row and no reason to want one. A
  -- yard is not signing up to SubSub because one roofer asked, so the
  -- bottom of the chain signs from a link, the way every other way into
  -- this product already works.
  from_name      TEXT,
  from_email     TEXT,
  -- Who receives it: the party paying. A company, not "the account",
  -- because the same row serves owner-from-contractor and
  -- contractor-from-subcontractor.
  to_company_id  TEXT REFERENCES companies(id),

  tier           INTEGER NOT NULL DEFAULT 0,
  parent_id      TEXT REFERENCES lien_waivers(id) ON DELETE CASCADE,
  work_order_id  TEXT REFERENCES work_orders(id) ON DELETE CASCADE,
  -- Tier 0 hangs off a release. A supplier's waiver usually does not --
  -- there is no SubSub release behind money a subcontractor paid their yard.
  release_id     TEXT REFERENCES wo_releases(id) ON DELETE SET NULL,

  kind           TEXT NOT NULL CHECK (kind IN
                   ('conditional_progress','unconditional_progress',
                    'conditional_final','unconditional_final')),
  -- The whole point, and the easiest thing here to get wrong. A waiver
  -- covers work THROUGH A DATE. Material delivered the next morning is not
  -- covered, so "clear" with no date against it is a lie waiting to happen
  -- and the chain re-opens as work continues.
  through_date   TEXT NOT NULL,
  amount_cents   INTEGER NOT NULL DEFAULT 0,

  scope_kind     TEXT NOT NULL DEFAULT 'labor_materials'
                   CHECK (scope_kind IN ('labor_only','labor_materials','materials_only')),
  -- Lien law follows the PROPERTY, not the signer. An Oregon roofer on a
  -- Washington building signs under Washington law. Stamped at creation so
  -- editing the property later cannot change what a signed waiver meant.
  governing_state TEXT,

  status         TEXT NOT NULL DEFAULT 'requested'
                   CHECK (status IN ('requested','signed','declined','void')),

  -- What was signed. Without the hash the record proves somebody signed
  -- something, which is not the same as proving what.
  doc_key        TEXT,
  doc_sha256     TEXT,
  signed_at      TEXT,
  signed_by_name TEXT,
  signed_by_email TEXT,
  signed_ip      TEXT,
  declined_note  TEXT,

  -- How somebody with no account signs. Single use, like every other token
  -- in here.
  token          TEXT,
  requested_at   TEXT DEFAULT CURRENT_TIMESTAMP,
  requested_by   TEXT REFERENCES users(id),
  created_at     TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_waiver_token ON lien_waivers (token) WHERE token IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_waiver_job ON lien_waivers (job_id, tier, status);

CREATE INDEX IF NOT EXISTS ix_waiver_acct ON lien_waivers (account_id, status);

CREATE INDEX IF NOT EXISTS ix_waiver_parent ON lien_waivers (parent_id);

CREATE INDEX IF NOT EXISTS ix_waiver_release ON lien_waivers (release_id);

CREATE INDEX IF NOT EXISTS ix_waiver_wo ON lien_waivers (work_order_id, status);

-- Who a party says is below them on this job, and their warranty that the
-- list is complete.
--
-- Declared by the party being paid, because only they know. Which is the
-- weakness: under-declare and the chain reads clear when it is not. Two
-- things answer that and neither is this table -- a contract clause making
-- the list a warranty, so an incomplete one is an indemnity claim, and the
-- preliminary notices the owner receives in the post, which are the only
-- input about the chain that does not come from the subcontractor.
CREATE TABLE IF NOT EXISTS lower_tier_parties (
  id             TEXT PRIMARY KEY,
  job_id         TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  account_id     TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  work_order_id  TEXT REFERENCES work_orders(id) ON DELETE CASCADE,
  -- Whose list this is: the company declaring who is below them.
  company_id     TEXT NOT NULL REFERENCES companies(id),
  name           TEXT NOT NULL,
  email          TEXT,
  phone          TEXT,
  role           TEXT NOT NULL DEFAULT 'supplier'
                   CHECK (role IN ('supplier','subcontractor','equipment','other')),
  -- Matched to the supplier list in shared/suppliers.js where it is one of
  -- the yards already known, so "ABC Supply" and "abc supply — ballard" are
  -- one answer rather than two strings.
  supplier_id    TEXT,
  declared_at    TEXT DEFAULT CURRENT_TIMESTAMP,
  declared_by    TEXT REFERENCES users(id),
  -- The warranty. A list somebody swore to is worth something; a list
  -- somebody typed is worth less.
  complete_attested INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ix_lower_tier_job ON lower_tier_parties (job_id, company_id);

CREATE INDEX IF NOT EXISTS ix_lower_tier_wo ON lower_tier_parties (work_order_id);

CREATE INDEX IF NOT EXISTS ix_lower_tier_acct ON lower_tier_parties (account_id);

-- ---------------------------------------------------------------------------
-- 037 — a document is a row, not a flag
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- 038 — overflow: broadcast, not browse
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- 039 — a building changes hands
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS ix_properties_owner ON properties (owner_account_id);

-- A handover in flight. Two-party: one side asks, the other agrees, and
-- neither can move a building alone.
--
-- `direction` records who asked, because the two are different conversations.
-- An owner asking to be given their building is a client leaving; a manager
-- offering to hand it back is a manager resigning the instruction. Both end in
-- the same place and the audit should not have to guess which happened.
CREATE TABLE IF NOT EXISTS property_transfers (
  id                TEXT PRIMARY KEY,
  property_id       TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  -- The account operating it when the request was raised.
  from_account_id   TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- Where it is going. For a handover to an owner this is their own account,
  -- which must exist first -- an owner cannot be handed a building they have
  -- nowhere to put.
  to_account_id     TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- WHICH ACCOUNT ASKED. The two-party rule is "the side that asked has
  -- already agreed, so the other side decides", and that needs to be a fact on
  -- the row rather than something inferred from `direction`.
  --
  -- Inferring it does not survive both kinds. On a handover the owner is the
  -- `to` side; on an appointment the owner is the `from` side. A rule written
  -- in terms of owner/manager therefore points at the requester for one of
  -- them -- which lets one party move a building alone, the single thing this
  -- table exists to prevent.
  requested_by_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- Kept for the audit: an owner taking a building back and a manager resigning
  -- an instruction end in the same place and should not read the same.
  direction         TEXT NOT NULL CHECK (direction IN ('owner_requested','manager_offered')),
  kind              TEXT NOT NULL DEFAULT 'handover'
                      CHECK (kind IN ('handover','appointment')),
  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','accepted','declined','cancelled')),
  note              TEXT,
  requested_by      TEXT REFERENCES users(id),
  decided_by        TEXT REFERENCES users(id),
  created_at        TEXT DEFAULT CURRENT_TIMESTAMP,
  decided_at        TEXT
);

CREATE INDEX IF NOT EXISTS ix_ptransfer_property ON property_transfers (property_id, status);

CREATE INDEX IF NOT EXISTS ix_ptransfer_from ON property_transfers (from_account_id, status);

CREATE INDEX IF NOT EXISTS ix_ptransfer_to ON property_transfers (to_account_id, status);

-- One live request per building. Two open handovers would mean two people
-- each believing they were about to receive the same property.
CREATE UNIQUE INDEX IF NOT EXISTS ux_ptransfer_open
  ON property_transfers (property_id) WHERE status = 'pending';

-- ---------------------------------------------------------------------------
-- 041 — a subcontractor sends their own paperwork
-- ---------------------------------------------------------------------------

-- "Send my documents to a contractor."
--
-- Every subcontractor on SubSub is asked for the same four things several
-- times a month -- certificate of insurance, surety bond, signed agreement,
-- W-9 -- by general contractors who mostly are not on SubSub. Today they
-- answer by attaching PDFs to an email, one contractor at a time, and every
-- copy starts going stale the moment it is sent.
--
-- This is the same act, done once and kept current. The subcontractor types
-- the address of somebody who just asked them for paperwork; that person gets
-- a page showing what is on file, with the carrier, the policy number, the
-- coverage and -- the part an emailed PDF can never do -- the expiry, live.
--
-- WHY IT IS ALSO THE GROWTH LOOP. Every other way into SubSub needs the
-- hiring side to already be here: they look a contractor up, or they scan a
-- code, both of which need an account first. So supply could never bring
-- demand in, which in a product with no directory is the only flywheel
-- available. This is the one path where a free subcontractor hands something
-- genuinely useful to a general contractor who has never heard of us, doing a
-- chore they were going to do anyway.
--
-- THE SHAPE IS DELIBERATE, and shared/docshare.js holds the rules:
--
--   One recipient, one token. Not a public URL -- a link addressed to the
--   person they typed, which expires, and which they can revoke.
--
--   It is their OWN data, sent to one whole address they already had. No
--   search, no enumeration, nothing about anybody else. The same line the
--   connect lookup draws, from the other side of it.
--
--   The W-9 is NOT in the link. It carries a TIN, and for a sole proprietor
--   that is a social security number. The page says it is on file; reading it
--   needs an account. That is the one deliberate piece of friction here and
--   it sits exactly where the recipient is getting something anyway.
--
-- The view count is a count and a date, like every other roll-up here. The
-- subcontractor seeing that their pack was opened twice is most of the value
-- of having sent it through SubSub rather than as an attachment.
CREATE TABLE IF NOT EXISTS doc_shares (
  id             TEXT PRIMARY KEY,
  -- The secret in the link. Long, random, unique, and never derived from
  -- anything guessable about the company or the recipient.
  token          TEXT NOT NULL UNIQUE,
  company_id     TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  sent_by        TEXT REFERENCES users(id),
  -- Who it was addressed to. Kept so the subcontractor can see what they
  -- sent where, and so a second send to the same address can replace the
  -- first rather than leaving two live links.
  to_email       TEXT NOT NULL,
  to_name        TEXT,
  note           TEXT,
  created_at     TEXT DEFAULT CURRENT_TIMESTAMP,
  -- Not forever. A link that outlives the conversation it was sent for is a
  -- copy of somebody's insurance certificate loose on the internet.
  expires_at     TEXT NOT NULL,
  revoked_at     TEXT,
  -- A count and a date, never a log of who read what from where.
  view_count     INTEGER NOT NULL DEFAULT 0,
  last_viewed_at TEXT
);

CREATE INDEX IF NOT EXISTS ix_doc_shares_company ON doc_shares (company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_doc_shares_token ON doc_shares (token);

-- ---------------------------------------------------------------------------
-- 043 — asking your own roster to price a job
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- 044 — the renewal sweep's ledger
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- 045 — every pack sent to one address
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS doc_inboxes (
  id          TEXT PRIMARY KEY,
  -- The secret in the link. Same shape as a share token and just as random:
  -- 32 bytes, never derived from the address or the clock.
  token       TEXT NOT NULL UNIQUE,
  -- Lowercased, matching doc_shares, or the join misses.
  to_email    TEXT NOT NULL,
  created_at  TEXT DEFAULT CURRENT_TIMESTAMP,
  -- Shorter than a share. A share is a document somebody was sent; this is a
  -- key to everything they were ever sent, so it earns a tighter window.
  expires_at  TEXT NOT NULL,
  revoked_at  TEXT,
  last_used_at TEXT,
  -- Set when they turn it into an account, so the same link cannot be used to
  -- populate a second one, and so "where did this roster come from" has an
  -- answer later.
  claimed_at         TEXT,
  claimed_account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS ix_inbox_email ON doc_inboxes (to_email, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_inbox_token ON doc_inboxes (token);
