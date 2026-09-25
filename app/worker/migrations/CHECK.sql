-- Which migrations has this database actually had?
--
-- Paste this into the D1 console and read the row. Every column answers 1
-- for applied and 0 for not. There is no migrations table to consult -- they
-- are applied by hand -- so this asks the schema itself, which cannot be
-- wrong about it.
--
-- It exists because "did I run that one?" came up after nearly every round,
-- and the honest answer from a chat thread is a guess. Safe to run as often
-- as you like: it reads nothing but the table definitions and changes
-- nothing.
--
-- Add a line here whenever a migration adds a column, so this keeps pace
-- with the folder it lives in.
SELECT
  (SELECT COUNT(*) FROM pragma_table_info('users')       WHERE name='notify')               AS m018_user_notify,
  (SELECT COUNT(*) FROM sqlite_master                    WHERE type='table' AND name='visits') AS m019_visits,
  (SELECT COUNT(*) FROM pragma_table_info('jobs')        WHERE name='withdrawn_at')         AS m020_withdrawn,
  (SELECT COUNT(*) FROM pragma_table_info('jobs')        WHERE name='declined_at')          AS m021_declined,
  (SELECT COUNT(*) FROM pragma_table_info('jobs')        WHERE name='photos')               AS m022_photos,
  (SELECT COUNT(*) FROM pragma_table_info('jobs')        WHERE name='report_detail')        AS m022_report_detail,
  (SELECT COUNT(*) FROM pragma_table_info('jobs')        WHERE name='severity')             AS m023_severity,
  (SELECT COUNT(*) FROM pragma_table_info('accounts')    WHERE name='emergency_company_id') AS m023_emergency_sub,
  (SELECT COUNT(*) FROM pragma_table_info('work_orders') WHERE name='pay_kind')             AS m024_pay_kind,
  (SELECT COUNT(*) FROM pragma_table_info('work_orders') WHERE name='rate_cents')           AS m024_rate_cents,
  (SELECT COUNT(*) FROM pragma_table_info('work_orders') WHERE name='cap_hours')            AS m024_cap_hours,
  (SELECT COUNT(*) FROM pragma_table_info('jobs')        WHERE name='updated_at')           AS m025_updated_at,
  (SELECT COUNT(*) FROM pragma_table_info('jobs')        WHERE name='material_supplier')    AS m026_supplier,
  (SELECT COUNT(*) FROM pragma_table_info('jobs')        WHERE name='material_branch')      AS m026_branch,
  (SELECT COUNT(*) FROM pragma_table_info('sub_invites') WHERE name='email')               AS m027_invite_email,
  (SELECT COUNT(*) FROM pragma_table_info('sub_invites') WHERE name='sent_at')             AS m027_invite_sent,
  (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='user_invites')          AS m028_user_invites,
  (SELECT COUNT(*) FROM pragma_table_info('sub_invites') WHERE name='phone')               AS m029_invite_phone,
  (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='connect_requests')       AS m030_connect_requests,
  (SELECT COUNT(*) FROM pragma_table_info('companies')   WHERE name='connect_code')         AS m030_connect_code,
  (SELECT COUNT(*) FROM pragma_table_info('accounts')    WHERE name='company_id')           AS m031_account_company,
  -- Not a column check: the point of 031 is that every GENERAL CONTRACTOR
  -- has one. The other account kinds hire but are not hired, and must not.
  (SELECT COUNT(*) FROM accounts
    WHERE kind = 'general_contractor' AND company_id IS NULL)                               AS m031_gcs_without,
  (SELECT COUNT(*) FROM accounts
    WHERE kind <> 'general_contractor' AND company_id IS NOT NULL)                          AS m031_others_with,
  (SELECT COUNT(*) FROM pragma_table_info('users')       WHERE name='avatar_key')           AS m032_avatar;
