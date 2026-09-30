-- 052: a subcontractor agreement is between TWO PARTIES.
--
-- `companies.contract` is one boolean on a row every hiring account shares, so
-- a roofer who signed with Outerhome read as having a signed agreement on
-- Cascade Management's roster too -- for a document Cascade never sent and
-- could not produce. That was quietly wrong already; it becomes unmissable the
-- moment SubSub offers a form with both parties' names printed in it.
--
-- So an agreement hangs off the pair. The old boolean stays, for the uploads
-- that predate this, and stops being what decides anything.
--
-- ONE PASTE AND NO `ALTER TABLE`, for the reason 048 records: ADD COLUMN is
-- the one statement that cannot be run twice, so it needs a paste of its own
-- and an operator who gets the order right. Everything here is
-- CREATE ... IF NOT EXISTS, so running this file again does nothing.

CREATE TABLE IF NOT EXISTS agreements (
  id             TEXT PRIMARY KEY,

  -- The two parties. This pair is the whole reason the table exists.
  account_id     TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  company_id     TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,

  -- SubSub's form, signed in the app, or the hiring account's own paper,
  -- uploaded. Both satisfy the same requirement and only one can be signed
  -- here, which is why the screen has to know which it is looking at.
  source         TEXT NOT NULL DEFAULT 'subsub_standard'
                   CHECK (source IN ('subsub_standard','uploaded')),

  -- WHICH TEXT, STAMPED. Never read live. Editing the template must not
  -- change what somebody already signed, so a stored agreement names the
  -- version it was rendered from and is re-rendered from that.
  template_id      TEXT,
  template_version TEXT,
  -- The merged term values, and the parties as they read at the moment of
  -- issue. Both stored, because a company can be renamed and an account can
  -- change its standard terms -- and a re-render that picked either up live
  -- would no longer match the hash.
  terms          TEXT NOT NULL DEFAULT '{}',
  parties        TEXT NOT NULL DEFAULT '{}',

  -- Law follows the work. Stamped at issue, exactly as
  -- lien_waivers.governing_state is, and for the same reason.
  governing_state TEXT,

  status         TEXT NOT NULL DEFAULT 'sent'
                   CHECK (status IN ('sent','signed','countersigned',
                                     'declined','void','superseded')),

  -- WHAT WAS SIGNED. Without the hash the record proves somebody signed
  -- something, which is not the same as proving what.
  doc_key        TEXT,
  doc_sha256     TEXT,
  file_name      TEXT,

  issued_at      TEXT DEFAULT CURRENT_TIMESTAMP,
  issued_by      TEXT REFERENCES users(id),

  -- The subcontractor's signature.
  signed_at        TEXT,
  signed_by        TEXT REFERENCES users(id),
  signed_by_name   TEXT,
  signed_by_email  TEXT,
  signed_ip        TEXT,

  -- And the hiring account's. A form signed by one side is not a contract,
  -- so nothing is in force until both of these are set.
  countersigned_at       TEXT,
  countersigned_by       TEXT REFERENCES users(id),
  countersigned_by_name  TEXT,
  countersigned_by_email TEXT,
  countersigned_ip       TEXT,

  declined_note  TEXT,
  declined_at    TEXT,
  voided_at      TEXT,
  superseded_at  TEXT,
  created_at     TEXT DEFAULT CURRENT_TIMESTAMP
);

-- ONE LIVE AGREEMENT PER RELATIONSHIP, and PARTIAL for the reason
-- ux_wo_transfer_live is: a plain unique index would mean a relationship that
-- once had a declined or withdrawn agreement could never have another, and no
-- index at all would let two arrive at once and leave two documents each
-- claiming to be the terms.
CREATE UNIQUE INDEX IF NOT EXISTS ux_agreement_live
  ON agreements (account_id, company_id)
  WHERE status IN ('sent','signed','countersigned');

CREATE INDEX IF NOT EXISTS ix_agreement_company ON agreements (company_id, status);
CREATE INDEX IF NOT EXISTS ix_agreement_account ON agreements (account_id, status);

-- A hiring account's standing terms.
--
-- A separate table rather than columns on `accounts`, for the ALTER TABLE
-- reason above -- and it reads correctly besides: these are the terms of a
-- document the account issues, not a property of the account.
CREATE TABLE IF NOT EXISTS agreement_terms (
  account_id     TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  terms          TEXT NOT NULL DEFAULT '{}',
  -- The hiring account's OWN details as they should read in a contract.
  --
  -- There is nowhere else to get them. A general contractor has a company row
  -- since 031, but a property manager has none by design, and `accounts` has
  -- never carried an address -- the city typed at signup is validated and
  -- discarded. A contract naming one party with no address is a contract with
  -- a blank in it, which is the one thing a document being signed must not
  -- have.
  hiring_party   TEXT NOT NULL DEFAULT '{}',
  -- Whether a new subcontractor is sent one without anybody asking. NULL is
  -- not a value here: absent means the account has no row at all, which is
  -- "never answered", and the effective answer to that is no.
  require_by_default INTEGER NOT NULL DEFAULT 0,
  updated_at     TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_by     TEXT REFERENCES users(id)
);
