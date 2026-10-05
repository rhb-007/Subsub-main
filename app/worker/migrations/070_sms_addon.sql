-- 070. HOW MANY TEXT-MESSAGE ADD-ONS AN ACCOUNT HAS BOUGHT.
--
-- Scale includes 2,500 text messages a month; each add-on is 5,000 more for
-- $50 a month. app/shared/smsquota.js holds the figures and the rule, and the
-- Worker counts what was actually sent out of sms_log (011), so the only new
-- fact to store is how many add-ons the account is paying for.
--
-- A CACHE OF STRIPE'S LAST WORD, like `plan` beside it. The add-on is a line
-- on the Scale subscription, the webhook writes the quantity here, and nothing
-- else decides it -- an account cannot buy texts by writing this column.
--
-- NOT NULL DEFAULT 0, so every account that exists has none and keeps the
-- included 2,500 with no backfill.
--
-- ONE `ALTER TABLE ... ADD COLUMN`, which is the one statement that cannot be
-- run twice, so it is a paste of its own. If it answers "duplicate column
-- name" it has already been run and there is nothing to do.

ALTER TABLE accounts ADD COLUMN sms_addon_blocks INTEGER NOT NULL DEFAULT 0;
