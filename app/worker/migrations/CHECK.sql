-- Which migrations has this database actually had?
--
-- Paste this into the D1 console and read the row. There is no migrations
-- table to consult -- they are applied by hand -- so this asks the schema
-- itself, which cannot be wrong about it.
--
-- MOST columns answer 1 for applied and 0 for not. FOUR do not, and reading
-- them the same way turns a healthy database into four bug reports:
--
--   m031_hireable_without, m031_others_with, m039_unowned
--       INVARIANTS. They count BROKEN ROWS, so 0 is the good answer and
--       anything above 0 is the bug report. All three read 1 once, and each
--       was a different route writing a row the migration had taught the
--       schema to expect.
--
--   m046_kind_check
--       TRI-STATE, and the only one where the middle value means "do not
--       run the migration". 0 and 2 are both fine; only 1 needs 046.
--
-- This header used to say "every column answers 1 for applied and 0 for not",
-- which is the screen-that-lies rule pointed at a comment: somebody reading
-- their own healthy row would have found four zeros and gone looking for four
-- migrations that were never missing.
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
  -- Not a column check: the point of 031 is that every account that can BE
  -- HIRED has one, and no other kind does. It read `general_contractor` alone
  -- until `subcontractor` was added -- at which point the invariant would have
  -- flagged every subcontractor account as an illegal company row while
  -- silently allowing one with no company to be hired as. The list here has to
  -- stay in step with HIREABLE_KINDS in worker/index.js; nothing enforces that
  -- but this comment and the migration-gap test.
  (SELECT COUNT(*) FROM accounts
    WHERE kind IN ('general_contractor','subcontractor')
      AND company_id IS NULL)                                                               AS m031_hireable_without,
  (SELECT COUNT(*) FROM accounts
    WHERE kind NOT IN ('general_contractor','subcontractor')
      AND company_id IS NOT NULL)                                                           AS m031_others_with,
  (SELECT COUNT(*) FROM pragma_table_info('users')       WHERE name='avatar_key')           AS m032_avatar,
  (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='wo_milestones')          AS m033_milestones,
  (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='wo_events')              AS m033_events,
  (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='wo_releases')            AS m033_releases,
  (SELECT COUNT(*) FROM pragma_table_info('work_orders') WHERE name='retainage_bps')        AS m034_retainage,
  (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='lien_waivers')           AS m035_waivers,
  (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='lower_tier_parties')     AS m035_lower_tier,
  (SELECT COUNT(*) FROM pragma_table_info('work_orders') WHERE name='scope_kind')           AS m036_scope,
  (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='company_docs')           AS m037_docs,
  (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='doc_reminders')          AS m037_reminders,
  (SELECT COUNT(*) FROM pragma_table_info('companies')   WHERE name='overflow_opt_in')      AS m038_optin,
  (SELECT COUNT(*) FROM pragma_table_info('companies')   WHERE name='overflow_trades')      AS m038_trades,
  (SELECT COUNT(*) FROM pragma_table_info('companies')   WHERE name='overflow_since')       AS m038_since,
  (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='overflow_posts')         AS m038_posts,
  (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='overflow_invites')       AS m038_invites,
  (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='overflow_responses')     AS m038_responses,
  (SELECT COUNT(*) FROM pragma_table_info('properties')  WHERE name='owner_account_id')     AS m039_owner,
  (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='property_transfers')     AS m039_transfers,
  -- Not a column check: 039's backfill must have left every building owned by
  -- whoever holds it, or an unclaimed property can never be handed over.
  (SELECT COUNT(*) FROM properties WHERE owner_account_id IS NULL)                          AS m039_unowned,
  (SELECT COUNT(*) FROM pragma_table_info('properties')  WHERE name='owner_declared_at')     AS m040_declared_at,
  (SELECT COUNT(*) FROM pragma_table_info('properties')  WHERE name='owner_declared_by')     AS m040_declared_by,
  (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='doc_shares')              AS m041_doc_shares,
  (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='quote_requests')           AS m043_quote_requests,
  (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='quote_invites')            AS m043_quote_invites,
  (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='doc_retouches')            AS m044_retouches,
  (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='doc_share_optouts')        AS m044_optouts,
  (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='doc_inboxes')              AS m045_inboxes,
  -- 046 is the one migration here that MOST DATABASES MUST NOT RUN, so this
  -- reads the shape rather than asking whether a column arrived.
  --
  --   0  no CHECK on accounts.kind -- 003 added it as plain TEXT on purpose.
  --      The subcontractor kind stores with nothing run. Do not run 046.
  --   1  the OLD constraint, from a database built out of schema.sql. It
  --      REFUSES 'subcontractor', and a subcontractor signing up gets a 409
  --      and no account. Run 046's rebuild.
  --   2  already widened. Nothing to do.
  (SELECT CASE
     WHEN (SELECT sql FROM sqlite_master WHERE type='table' AND name='accounts')
            NOT LIKE '%CHECK (kind IN%' THEN 0
     WHEN (SELECT sql FROM sqlite_master WHERE type='table' AND name='accounts')
            LIKE '%''subcontractor''%' THEN 2
     ELSE 1 END)                                                                            AS m046_kind_check,
  -- And the uniqueness 046's rebuild has to put back, because
  -- CREATE TABLE AS SELECT keeps the rows and drops everything else. Every
  -- branded page load looks an account up by subdomain, and two accounts
  -- holding one address is the worst row this table can carry.
  --
  -- Asked as "is subdomain unique, by any means" rather than "does an index
  -- with this name exist". A database built from schema.sql gets its
  -- uniqueness from the inline UNIQUE on the column, which SQLite implements
  -- as sqlite_autoindex_accounts_N with a NULL sql -- invisible to a name or
  -- LIKE test, so that version read 0 on a perfectly good database and would
  -- have told somebody their rebuild had failed.
  (SELECT COUNT(*) FROM pragma_index_list('accounts') il
    WHERE il."unique" = 1
      AND EXISTS (SELECT 1 FROM pragma_index_info(il.name) ii
                   WHERE ii.name = 'subdomain'))                                            AS m046_subdomain_unique,
  -- 047. Whether this company has been ASKED to be hireable. NULL on a row
  -- means not answered, never "no", and the effective default is open -- so
  -- this counts the column, not the answers.
  (SELECT COUNT(*) FROM pragma_table_info('companies')
    WHERE name = 'open_to_hire')                                                            AS m047_open_to_hire;
