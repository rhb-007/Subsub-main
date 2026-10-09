-- 075. REFERRALS: A CODE FOR EVERY SUB AND EVERY HIRING ACCOUNT, WHO BROUGHT
-- WHOM IN, AND A LEDGER OF WHAT THAT EARNED.
--
-- Five tables and no ALTER TABLE, for the reason 048, 057, 063 and 074 give:
-- ADD COLUMN cannot be run twice, so this paste can.
--
-- referral_codes is WHO CAN REFER. One row per subcontractor COMPANY (kind
-- 'sub') and one per hiring ACCOUNT (kind 'gc'). A sub is keyed on the company
-- because that is what they are on every roster they sit on -- a roofer seated
-- on three general contractors' accounts is one referrer, not three. The code
-- is eight characters from an alphabet with nothing that reads two ways on a
-- truck door (no 0/O, 1/I/L, no U), minted lazily the first time anybody asks.
--
-- referral_touches is a COUNT OF ARRIVALS, never a log of who. A link opened, a
-- code typed, a claim link opened, a Passport viewed. No address, no IP, no
-- cookie id: it is what the console measures, and it is not a record of any
-- visitor.
--
-- referral_attributions is WHO BROUGHT THIS ACCOUNT (or this company) IN, ONE
-- ROW EACH, written once at signup from the LAST touch before it. That is the
-- rule asked for, and it is deliberately different from 074's
-- sub_attributions, which keeps the FIRST account whose work order a sub
-- claimed -- that table answers "which customer recruited this contractor",
-- this one answers "whose referral earns the reward". Both stay.
--
-- referral_rewards is THE LEDGER. One row per reward, unique on (referred
-- account, kind, beneficiary), so a webhook delivered twice cannot pay twice.
-- A sub's $100 is 'sub_cash' and moves pending -> approved -> paid by hand in
-- the console; a hiring account's month free is 'gc_credit' and moves pending
-- -> applied when Stripe has taken it as a customer-balance credit. Either can
-- be voided with a reason. Nothing is ever deleted: "we paid them in March"
-- is a question somebody asks.
--
-- referral_invites counts the invitations a sub sent from "Get your GCs on
-- SubSub", so they can be rate-limited and a second invite to the same address
-- inside a month can be refused. An address is kept for an emailed invite
-- (it is what the dedupe needs, the same as doc_shares.to_email); a texted one
-- goes from the sub's own phone and SubSub never sees the number, so none is
-- stored.

CREATE TABLE IF NOT EXISTS referral_codes (
  code        TEXT PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('sub', 'gc')),
  account_id  TEXT REFERENCES accounts(id) ON DELETE CASCADE,
  company_id  TEXT REFERENCES companies(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((kind = 'sub' AND company_id IS NOT NULL) OR (kind = 'gc' AND account_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_referral_codes_gc ON referral_codes(account_id) WHERE kind = 'gc';
CREATE UNIQUE INDEX IF NOT EXISTS ux_referral_codes_sub ON referral_codes(company_id) WHERE kind = 'sub';

CREATE TABLE IF NOT EXISTS referral_touches (
  id       TEXT PRIMARY KEY,
  code     TEXT NOT NULL REFERENCES referral_codes(code) ON DELETE CASCADE,
  channel  TEXT NOT NULL CHECK (channel IN ('link', 'code', 'claim', 'passport')),
  at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_referral_touches_code ON referral_touches(code, at);

CREATE TABLE IF NOT EXISTS referral_attributions (
  subject_kind  TEXT NOT NULL CHECK (subject_kind IN ('account', 'company')),
  subject_id    TEXT NOT NULL,
  code          TEXT NOT NULL REFERENCES referral_codes(code) ON DELETE CASCADE,
  channel       TEXT NOT NULL CHECK (channel IN ('link', 'code', 'claim', 'passport')),
  touched_at    TEXT,
  created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (subject_kind, subject_id)
);
CREATE INDEX IF NOT EXISTS ix_referral_attributions_code ON referral_attributions(code);

CREATE TABLE IF NOT EXISTS referral_rewards (
  id                      TEXT PRIMARY KEY,
  code                    TEXT NOT NULL REFERENCES referral_codes(code) ON DELETE CASCADE,
  referred_account_id     TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  kind                    TEXT NOT NULL CHECK (kind IN ('sub_cash', 'gc_credit')),
  beneficiary             TEXT NOT NULL CHECK (beneficiary IN ('referrer', 'referred')),
  beneficiary_account_id  TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  beneficiary_company_id  TEXT REFERENCES companies(id) ON DELETE SET NULL,
  amount_cents            INTEGER NOT NULL CHECK (amount_cents > 0),
  status                  TEXT NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'approved', 'paid', 'applied', 'void')),
  trigger_invoice_id      TEXT,
  processor_ref           TEXT,
  reference               TEXT,
  note                    TEXT,
  error                   TEXT,
  created_at              TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  approved_at             TEXT,
  approved_by             TEXT REFERENCES users(id) ON DELETE SET NULL,
  paid_at                 TEXT,
  paid_by                 TEXT REFERENCES users(id) ON DELETE SET NULL,
  applied_at              TEXT,
  voided_at               TEXT,
  voided_by               TEXT REFERENCES users(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_referral_reward ON referral_rewards(referred_account_id, kind, beneficiary);
CREATE INDEX IF NOT EXISTS ix_referral_rewards_code ON referral_rewards(code);
CREATE INDEX IF NOT EXISTS ix_referral_rewards_status ON referral_rewards(status);

CREATE TABLE IF NOT EXISTS referral_invites (
  id          TEXT PRIMARY KEY,
  code        TEXT NOT NULL REFERENCES referral_codes(code) ON DELETE CASCADE,
  sent_by     TEXT REFERENCES users(id) ON DELETE SET NULL,
  channel     TEXT NOT NULL CHECK (channel IN ('email', 'sms')),
  to_email    TEXT,
  emailed     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_referral_invites_code ON referral_invites(code, created_at);
