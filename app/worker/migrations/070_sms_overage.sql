-- 070. TEXT MESSAGES PAST THE INCLUDED 2,500, CHARGED ON THE 1ST -- AND A
-- SWITCH TO TURN THEM OFF.
--
-- Scale includes 2,500 texts a month. Past that, texts keep going and the
-- month is $50 for every 5,000 sent, counted from the first (7,000 is $100,
-- 12,000 is $150), charged automatically on the 1st. The count is
-- not stored -- it is read out of sms_log (011), so there is one record of
-- what was sent. What is stored here is what was BILLED for it: one row per
-- account per month, written by the nightly sweep before it asks Stripe for
-- anything.
--
-- One row per account per month, and the unique index is what makes that
-- true. The sweep runs every night and bills the month just ended; without the
-- index two nights could both bill October, and the idempotency key on the
-- Stripe call only lasts a day. A row that failed is retried the next night
-- rather than replaced.
--
--   status   pending       written, Stripe not asked yet
--            billed        invoiced and charged; processor_ref is the line and
--                          the invoice
--            failed        Stripe refused; error says why; retried nightly
--            not_billable  over the allowance with nothing to bill (a comped
--                          account); kept so staff can see it happened
--
-- This file REPLACES an earlier 070 that added accounts.sms_addon_blocks for
-- a pre-bought add-on. If that one was already pasted, nothing breaks: the
-- column is simply unused. Paste this one either way.
--
-- account_sms_settings is the account's own switch. Texts are billed
-- automatically, so turning them off has to be one press: off means no texts
-- at all except an emergency call-out. No row is ON, which is what every
-- account was before the switch existed.
--
-- No ALTER TABLE, so it can be run more than once.

CREATE TABLE IF NOT EXISTS sms_overage (
  id            TEXT PRIMARY KEY,
  account_id    TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  month         TEXT NOT NULL,
  used          INTEGER NOT NULL,
  allowance     INTEGER NOT NULL,
  blocks        INTEGER NOT NULL,
  amount_cents  INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','billed','failed','not_billable')),
  processor_ref TEXT,
  error         TEXT,
  created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  billed_at     TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_sms_overage_month ON sms_overage(account_id, month);

CREATE TABLE IF NOT EXISTS account_sms_settings (
  account_id  TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  sms_off     INTEGER NOT NULL DEFAULT 0,
  updated_by  TEXT,
  updated_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
