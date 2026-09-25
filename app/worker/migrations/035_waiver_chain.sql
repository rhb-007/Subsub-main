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
