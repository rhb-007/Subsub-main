-- Which migrations has this database actually had?
--
-- Paste this into the D1 console and read the list. There is no migrations
-- table to consult -- they are applied by hand -- so this asks the schema
-- itself, which cannot be wrong about it.
--
-- ONE ROW PER CHECK: a `name` and a `value`. It used to be one row of 110
-- COLUMNS, and that is why it is not any more -- D1 refuses a result set
-- wider than 100 columns with `too many columns in result set`, so this file
-- became unrunnable in the console the moment 063 took it from 100 to 102.
-- It had been dead for five migrations when somebody finally pasted it.
--
-- WHICH IS THE OLDEST SHAPE IN CLAUDE.md, pointed at the tool that exists to
-- catch it: the one thing that answers "did I run that one?" was disabled by
-- its own growth, exactly as it once could not be run against a fresh
-- database because the invariants read columns `schema.sql` did not have.
-- And `schema-drift-test` was green throughout, because local SQLite allows
-- 2000 columns where D1 allows 100 -- a guard that runs where nobody is
-- looking, reporting to nobody. It now asserts the width as well.
--
-- Rows, unlike columns, have no ceiling. Adding a check is one more
-- `UNION ALL` and can never run the file into a limit again.
--
-- READ THE FIRST COLUMN AND NOTHING ELSE. `verdict` is 'ok', or it names what
-- to do, and the rows that are not ok sort to the TOP. If the first row says
-- ok then every one of them does.
--
--   NOT RUN       that migration has not been applied. Paste it.
--   BROKEN ROWS   an invariant found rows that should not exist. It is not a
--                 missing migration -- it is a route writing something the
--                 schema was taught to forbid, and it needs a fix rather than
--                 a paste.
--   RUN 046       only 046, and only when its own count is exactly 1.
--
-- `value` is beside it because a verdict that is wrong has to be visible
-- rather than silent -- which is the difference between a column like this and
-- a check query that quietly answers a different question. What the numbers
-- mean, if you want them:
--
--   MOST rows answer 1 for applied and 0 for not. FOUR do not, and reading
--   them the same way turns a healthy database into four bug reports:
--
--     m031_hireable_without, m031_others_with, m039_unowned, and anything
--     whose name contains `_inv_`
--         INVARIANTS. They count BROKEN ROWS, so 0 is the good answer and
--         anything above 0 is the bug report. The first three read 1 once, and
--         each was a different route writing a row the migration had taught
--         the schema to expect.
--
--     m046_kind_check
--         TRI-STATE, and the only one where the middle value means "do not
--         run the migration". 0 and 2 are both fine; only 1 needs 046.
--
-- A few rows count SEVERAL columns at once, so they answer with how many they
-- found rather than 1: m055_inspections and m057_photo_notes read 6,
-- m055_inspection_rooms / m056_inspection_sends / m063_inspection_summary /
-- m066_job_endings read 5, m055_inspection_photos reads 3.
--
-- An earlier header said "every column answers 1 for applied and 0 for not",
-- which is the screen-that-lies rule pointed at a comment: somebody reading
-- their own healthy row would have found four zeros and gone looking for four
-- migrations that were never missing. That is most of why the verdict is
-- computed now instead of recited -- prose describing a rule is a second
-- record of it, and the second record is the one that goes wrong.
--
-- It exists because "did I run that one?" came up after nearly every round,
-- and the honest answer from a chat thread is a guess. Safe to run as often
-- as you like: it reads nothing but the table definitions and changes
-- nothing.
--
-- Add a line here whenever a migration adds a column, so this keeps pace
-- with the folder it lives in.
  -- AND IT SAYS WHICH ROWS ARE WRONG, because a hundred and ten numbers and a
  -- four-part rule is an answer that is present and not legible. The rule used
  -- to live in the prose above and in the reader's head, applied a hundred and
  -- ten times on a phone -- and the prose had already been wrong about it once,
  -- telling somebody with a perfectly healthy database to go and find four
  -- migrations that were never missing.
  --
  -- So it is computed here, from the naming convention this file already keeps,
  -- and the problems sort to the top where somebody actually looks. `value` is
  -- still beside it: a verdict that is wrong is then visible rather than
  -- silent, which is the difference between this and a check query that
  -- quietly answers the wrong question.
  --
  -- `instr` rather than LIKE '%_inv_%' -- `_` is a LIKE wildcard, so that
  -- pattern matches any three characters around "inv" and would start
  -- classifying rows by accident.
SELECT
  CASE
    WHEN instr(name, '_inv_') > 0
      OR name IN ('m031_hireable_without', 'm031_others_with', 'm039_unowned')
      THEN CASE WHEN value = 0 THEN 'ok' ELSE 'BROKEN ROWS' END
    WHEN name = 'm046_kind_check'
      THEN CASE WHEN value = 1 THEN 'RUN 046' ELSE 'ok' END
    ELSE CASE WHEN value >= 1 THEN 'ok' ELSE 'NOT RUN' END
  END AS verdict,
  name,
  value
FROM (
  SELECT 'm018_user_notify' AS name, (SELECT COUNT(*) FROM pragma_table_info('users')       WHERE name='notify') AS value
UNION ALL
  SELECT 'm019_visits' AS name, (SELECT COUNT(*) FROM sqlite_master                    WHERE type='table' AND name='visits') AS value
UNION ALL
  SELECT 'm020_withdrawn' AS name, (SELECT COUNT(*) FROM pragma_table_info('jobs')        WHERE name='withdrawn_at') AS value
UNION ALL
  SELECT 'm021_declined' AS name, (SELECT COUNT(*) FROM pragma_table_info('jobs')        WHERE name='declined_at') AS value
UNION ALL
  SELECT 'm022_photos' AS name, (SELECT COUNT(*) FROM pragma_table_info('jobs')        WHERE name='photos') AS value
UNION ALL
  SELECT 'm022_report_detail' AS name, (SELECT COUNT(*) FROM pragma_table_info('jobs')        WHERE name='report_detail') AS value
UNION ALL
  SELECT 'm023_severity' AS name, (SELECT COUNT(*) FROM pragma_table_info('jobs')        WHERE name='severity') AS value
UNION ALL
  SELECT 'm023_emergency_sub' AS name, (SELECT COUNT(*) FROM pragma_table_info('accounts')    WHERE name='emergency_company_id') AS value
UNION ALL
  SELECT 'm024_pay_kind' AS name, (SELECT COUNT(*) FROM pragma_table_info('work_orders') WHERE name='pay_kind') AS value
UNION ALL
  SELECT 'm024_rate_cents' AS name, (SELECT COUNT(*) FROM pragma_table_info('work_orders') WHERE name='rate_cents') AS value
UNION ALL
  SELECT 'm024_cap_hours' AS name, (SELECT COUNT(*) FROM pragma_table_info('work_orders') WHERE name='cap_hours') AS value
UNION ALL
  SELECT 'm025_updated_at' AS name, (SELECT COUNT(*) FROM pragma_table_info('jobs')        WHERE name='updated_at') AS value
UNION ALL
  SELECT 'm026_supplier' AS name, (SELECT COUNT(*) FROM pragma_table_info('jobs')        WHERE name='material_supplier') AS value
UNION ALL
  SELECT 'm026_branch' AS name, (SELECT COUNT(*) FROM pragma_table_info('jobs')        WHERE name='material_branch') AS value
UNION ALL
  SELECT 'm027_invite_email' AS name, (SELECT COUNT(*) FROM pragma_table_info('sub_invites') WHERE name='email') AS value
UNION ALL
  SELECT 'm027_invite_sent' AS name, (SELECT COUNT(*) FROM pragma_table_info('sub_invites') WHERE name='sent_at') AS value
UNION ALL
  SELECT 'm028_user_invites' AS name, (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='user_invites') AS value
UNION ALL
  SELECT 'm029_invite_phone' AS name, (SELECT COUNT(*) FROM pragma_table_info('sub_invites') WHERE name='phone') AS value
UNION ALL
  SELECT 'm030_connect_requests' AS name, (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='connect_requests') AS value
UNION ALL
  SELECT 'm030_connect_code' AS name, (SELECT COUNT(*) FROM pragma_table_info('companies')   WHERE name='connect_code') AS value
UNION ALL
  SELECT 'm031_account_company' AS name, (SELECT COUNT(*) FROM pragma_table_info('accounts')    WHERE name='company_id') AS value
UNION ALL

  -- Not a column check: the point of 031 is that every account that can BE
  -- HIRED has one, and no other kind does. It read `general_contractor` alone
  -- until `subcontractor` was added -- at which point the invariant would have
  -- flagged every subcontractor account as an illegal company row while
  -- silently allowing one with no company to be hired as. The list here has to
  -- stay in step with HIREABLE_KINDS in worker/index.js; nothing enforces that
  -- but this comment and the migration-gap test.
  SELECT 'm031_hireable_without' AS name, (SELECT COUNT(*) FROM accounts
    WHERE kind IN ('general_contractor','subcontractor')
      AND company_id IS NULL) AS value
UNION ALL
  SELECT 'm031_others_with' AS name, (SELECT COUNT(*) FROM accounts
    WHERE kind NOT IN ('general_contractor','subcontractor')
      AND company_id IS NOT NULL) AS value
UNION ALL
  SELECT 'm032_avatar' AS name, (SELECT COUNT(*) FROM pragma_table_info('users')       WHERE name='avatar_key') AS value
UNION ALL
  SELECT 'm033_milestones' AS name, (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='wo_milestones') AS value
UNION ALL
  SELECT 'm033_events' AS name, (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='wo_events') AS value
UNION ALL
  SELECT 'm033_releases' AS name, (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='wo_releases') AS value
UNION ALL
  SELECT 'm034_retainage' AS name, (SELECT COUNT(*) FROM pragma_table_info('work_orders') WHERE name='retainage_bps') AS value
UNION ALL
  SELECT 'm035_waivers' AS name, (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='lien_waivers') AS value
UNION ALL
  SELECT 'm035_lower_tier' AS name, (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='lower_tier_parties') AS value
UNION ALL
  SELECT 'm036_scope' AS name, (SELECT COUNT(*) FROM pragma_table_info('work_orders') WHERE name='scope_kind') AS value
UNION ALL
  SELECT 'm037_docs' AS name, (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='company_docs') AS value
UNION ALL
  SELECT 'm037_reminders' AS name, (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='doc_reminders') AS value
UNION ALL
  SELECT 'm038_optin' AS name, (SELECT COUNT(*) FROM pragma_table_info('companies')   WHERE name='overflow_opt_in') AS value
UNION ALL
  SELECT 'm038_trades' AS name, (SELECT COUNT(*) FROM pragma_table_info('companies')   WHERE name='overflow_trades') AS value
UNION ALL
  SELECT 'm038_since' AS name, (SELECT COUNT(*) FROM pragma_table_info('companies')   WHERE name='overflow_since') AS value
UNION ALL
  SELECT 'm038_posts' AS name, (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='overflow_posts') AS value
UNION ALL
  SELECT 'm038_invites' AS name, (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='overflow_invites') AS value
UNION ALL
  SELECT 'm038_responses' AS name, (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='overflow_responses') AS value
UNION ALL
  SELECT 'm039_owner' AS name, (SELECT COUNT(*) FROM pragma_table_info('properties')  WHERE name='owner_account_id') AS value
UNION ALL
  SELECT 'm039_transfers' AS name, (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='property_transfers') AS value
UNION ALL

  -- Not a column check: 039's backfill must have left every building owned by
  -- whoever holds it, or an unclaimed property can never be handed over.
  SELECT 'm039_unowned' AS name, (SELECT COUNT(*) FROM properties WHERE owner_account_id IS NULL) AS value
UNION ALL
  SELECT 'm040_declared_at' AS name, (SELECT COUNT(*) FROM pragma_table_info('properties')  WHERE name='owner_declared_at') AS value
UNION ALL
  SELECT 'm040_declared_by' AS name, (SELECT COUNT(*) FROM pragma_table_info('properties')  WHERE name='owner_declared_by') AS value
UNION ALL
  SELECT 'm041_doc_shares' AS name, (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='doc_shares') AS value
UNION ALL
  SELECT 'm043_quote_requests' AS name, (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='quote_requests') AS value
UNION ALL
  SELECT 'm043_quote_invites' AS name, (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='quote_invites') AS value
UNION ALL
  SELECT 'm044_retouches' AS name, (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='doc_retouches') AS value
UNION ALL
  SELECT 'm044_optouts' AS name, (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='doc_share_optouts') AS value
UNION ALL
  SELECT 'm045_inboxes' AS name, (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='doc_inboxes') AS value
UNION ALL

  -- 046 is the one migration here that MOST DATABASES MUST NOT RUN, so this
  -- reads the shape rather than asking whether a column arrived.
  --
  --   0  no CHECK on accounts.kind -- 003 added it as plain TEXT on purpose.
  --      The subcontractor kind stores with nothing run. Do not run 046.
  --   1  the OLD constraint, from a database built out of schema.sql. It
  --      REFUSES 'subcontractor', and a subcontractor signing up gets a 409
  --      and no account. Run 046's rebuild.
  --   2  already widened. Nothing to do.
  SELECT 'm046_kind_check' AS name, (SELECT CASE
     WHEN (SELECT sql FROM sqlite_master WHERE type='table' AND name='accounts')
            NOT LIKE '%CHECK (kind IN%' THEN 0
     WHEN (SELECT sql FROM sqlite_master WHERE type='table' AND name='accounts')
            LIKE '%''subcontractor''%' THEN 2
     ELSE 1 END) AS value
UNION ALL

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
  SELECT 'm046_subdomain_unique' AS name, (SELECT COUNT(*) FROM pragma_index_list('accounts') il
    WHERE il."unique" = 1
      AND EXISTS (SELECT 1 FROM pragma_index_info(il.name) ii
                   WHERE ii.name = 'subdomain')) AS value
UNION ALL

  -- 047. Whether this company has been ASKED to be hireable. NULL on a row
  -- means not answered, never "no", and the effective default is open -- so
  -- this counts the column, not the answers.
  SELECT 'm047_open_to_hire' AS name, (SELECT COUNT(*) FROM pragma_table_info('companies')
    WHERE name = 'open_to_hire') AS value
UNION ALL

  -- 048. The CRM API: the tokens, and the row that makes a retried webhook
  -- return the job it already made. ux_job_sources_external is counted
  -- separately because it is the constraint doing that work -- the table
  -- without it takes the duplicate and reports success.
  SELECT 'm048_api_tokens' AS name, (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='api_tokens') AS value
UNION ALL
  SELECT 'm048_job_sources' AS name, (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='job_sources') AS value
UNION ALL
  SELECT 'm048_dedupe_index' AS name, (SELECT COUNT(*) FROM sqlite_master
    WHERE type='index' AND name='ux_job_sources_external') AS value
UNION ALL

  -- 049. The account's CRM vocabulary, and the words that meant nothing.
  SELECT 'm049_trade_rules' AS name, (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='crm_trade_rules') AS value
UNION ALL
  SELECT 'm049_unmapped' AS name, (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='crm_unmapped') AS value
UNION ALL

  -- 050. Where a subcontractor's money goes. Both indexes are counted
  -- separately from the table because each one is doing work the table alone
  -- does not: the first stops a company growing a second connected account
  -- (two places money could go, nothing saying which), and the second is the
  -- column the Connect webhook looks a row up by, so a duplicate there is an
  -- ambiguous answer at the moment money is involved.
  SELECT 'm050_payout_accounts' AS name, (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='payout_accounts') AS value
UNION ALL
  SELECT 'm050_one_per_company' AS name, (SELECT COUNT(*) FROM sqlite_master
    WHERE type='index' AND name='ux_payout_account_company') AS value
UNION ALL
  SELECT 'm050_one_per_acct' AS name, (SELECT COUNT(*) FROM sqlite_master
    WHERE type='index' AND name='ux_payout_account_processor') AS value
UNION ALL

  -- And an invariant, which must read ZERO: a row saying verified while
  -- Stripe says money cannot move is a roster reading payable over an
  -- account that is not.
  --
  -- `_inv_` in the name is what says so. Which column is a must-be-zero
  -- invariant and which is a did-I-run-it count was a hand-kept regex in
  -- schema-drift-test.mjs, so adding one here meant remembering to edit a
  -- test somewhere else -- two records of one fact, and the first new
  -- invariant since it was written duly reported itself as an unrun
  -- migration. The three older invariants keep their names because CLAUDE.md
  -- names them and they are run by hand; anything added from here marks
  -- itself.
  SELECT 'm050_inv_verified_but_stuck' AS name, (SELECT COUNT(*) FROM payout_accounts
    WHERE kyc_status = 'verified'
      AND (payouts_enabled = 0 OR transfers_active = 0)) AS value
UNION ALL

  -- 051. Money in against a work order, money out per release. The live-
  -- transfer index is counted separately because it is the half that holds
  -- when two people press pay at once -- the table alone takes the second
  -- transfer and reports success, which is the one failure this whole ledger
  -- exists to make impossible. It is PARTIAL (status <> 'failed') so a
  -- declined attempt can be retried; a plain unique index there would leave
  -- somebody unpayable because a card bounced once.
  SELECT 'm051_wo_funding' AS name, (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='wo_funding') AS value
UNION ALL
  SELECT 'm051_wo_transfers' AS name, (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='wo_transfers') AS value
UNION ALL
  SELECT 'm051_one_live_transfer' AS name, (SELECT COUNT(*) FROM sqlite_master
    WHERE type='index' AND name='ux_wo_transfer_live') AS value
UNION ALL
  SELECT 'm051_one_per_intent' AS name, (SELECT COUNT(*) FROM sqlite_master
    WHERE type='index' AND name='ux_wo_funding_intent') AS value
UNION ALL

  -- Invariants, both of which must read ZERO.
  --
  -- A release marked paid with no transfer behind it is the ORIGINAL bug in a
  -- new place: somebody was told their money went and nothing carries it.
  -- Scoped to Stripe-settled releases, because a cheque legitimately has no
  -- transfer row -- `method` is the seam and 'manual' still means what it
  -- always meant.
  SELECT 'm051_inv_paid_without_transfer' AS name, (SELECT COUNT(*) FROM wo_releases r
    WHERE r.status = 'paid' AND r.method = 'stripe'
      AND NOT EXISTS (SELECT 1 FROM wo_transfers t
                       WHERE t.release_id = r.id AND t.status IN ('paid','pending'))) AS value
UNION ALL

  -- And the reverse, which is worse: money that left against a release
  -- nothing says was paid. That is a transfer nobody can reconcile.
  SELECT 'm051_inv_transfer_without_paid' AS name, (SELECT COUNT(*) FROM wo_transfers t
    JOIN wo_releases r ON r.id = t.release_id
    WHERE t.status = 'paid' AND r.status <> 'paid') AS value
UNION ALL

  -- 052. An agreement is between TWO PARTIES, so it hangs off the pair rather
  -- than sitting as one boolean on the shared company row. The live index is
  -- counted separately because it is the half that holds when two people
  -- issue one at once, and it is PARTIAL ('sent','signed','countersigned') so
  -- a relationship whose first agreement was declined can have another.
  SELECT 'm052_agreements' AS name, (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='agreements') AS value
UNION ALL
  SELECT 'm052_agreement_terms' AS name, (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='agreement_terms') AS value
UNION ALL
  SELECT 'm052_one_live_agreement' AS name, (SELECT COUNT(*) FROM sqlite_master
    WHERE type='index' AND name='ux_agreement_live') AS value
UNION ALL

  -- Invariants, both of which must read ZERO.
  --
  -- In force means BOTH signed. A row saying countersigned with either
  -- signature missing is a contract the product would enforce -- gating
  -- compliance, and soon payment -- on a document nobody can show was agreed.
  SELECT 'm052_inv_countersigned_unsigned' AS name, (SELECT COUNT(*) FROM agreements
    WHERE status = 'countersigned'
      AND (signed_at IS NULL OR countersigned_at IS NULL)) AS value
UNION ALL

  -- And a signature with no record of WHAT was signed. The hash is the whole
  -- difference between proving somebody signed something and proving what;
  -- an uploaded agreement is excused only until it has been uploaded, so this
  -- counts the ones that carry neither a hash nor a file.
  SELECT 'm052_inv_signed_without_doc' AS name, (SELECT COUNT(*) FROM agreements
    WHERE signed_at IS NOT NULL
      AND COALESCE(doc_sha256, '') = '' AND COALESCE(file_name, '') = '') AS value
UNION ALL


  -- 053. A project manager scoped to named jobs, which is what a general
  -- contractor has instead of buildings. No rows means no restriction, so
  -- there is nothing here that must be non-zero -- the table existing is the
  -- whole of what the migration did.
  SELECT 'm053_membership_jobs' AS name, (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='membership_jobs') AS value
UNION ALL

  -- Invariant, must read ZERO: a scope row against a seat that is not scoped
  -- by job at all. `jobScopeFrom` ignores those, so such a row is a list
  -- somebody built that narrows nobody -- and it would start narrowing them
  -- the day that role joined JOB_SCOPED_ROLES, silently.
  SELECT 'm053_inv_scoped_wrong_role' AS name, (SELECT COUNT(*) FROM membership_jobs mj
     JOIN memberships m ON m.id = mj.membership_id
    WHERE m.role <> 'pm') AS value
UNION ALL

  -- And a scope row pointing at a job on a different account from the seat.
  -- The cascade cannot catch this one: both rows are real, and the pair is
  -- what is wrong. A seat narrowed to somebody else's job either sees nothing
  -- or sees across accounts, and which one it is depends on a JOIN elsewhere.
  SELECT 'm053_inv_scope_crosses_account' AS name, (SELECT COUNT(*) FROM membership_jobs mj
     JOIN memberships m ON m.id = mj.membership_id
     JOIN jobs j ON j.id = mj.job_id
    WHERE j.account_id <> m.account_id) AS value
UNION ALL


  -- 054. The same shape one axis over, and the one that actually bit.
  -- Invariant, must read ZERO: a BUILDING scope row against a seat that is
  -- not narrowed by building at all. `propertyScope` answers null for
  -- anything but a pm, an owner or a tenant, so the Worker ignores such a row
  -- -- but `/api/account-users` hands the stored rows to the browser for the
  -- picker, and `isScoped` there read the list and not the role. An admin
  -- carrying rows left over from a promotion therefore read as narrowed on
  -- screen and unnarrowed on the server, and `runsTheAccount` shut the
  -- account down around them.
  --
  -- 054 clears what is already there; shared/propscope.js and the console's
  -- role route are what stop more arriving.
  SELECT 'm054_inv_scoped_wrong_role' AS name, (SELECT COUNT(*) FROM membership_properties mp
     JOIN memberships m ON m.id = mp.membership_id
    WHERE m.role NOT IN ('pm', 'owner', 'tenant')) AS value
UNION ALL


  -- 055. Move-in and move-out unit inspections. Three tables; no rows is the
  -- ordinary state of a fresh database, so what is checked is that they are
  -- there and carry the columns the routes read.
  SELECT 'm055_inspections' AS name, (SELECT COUNT(*) FROM pragma_table_info('inspections')
    WHERE name IN ('kind','status','property_id','unit','job_id','finished_at')) AS value
UNION ALL
  SELECT 'm055_inspection_rooms' AS name, (SELECT COUNT(*) FROM pragma_table_info('inspection_rooms')
    WHERE name IN ('inspection_id','name','status','note','position')) AS value
UNION ALL
  SELECT 'm055_inspection_photos' AS name, (SELECT COUNT(*) FROM pragma_table_info('inspection_photos')
    WHERE name IN ('room_id','file_key','content_type')) AS value
UNION ALL

  -- Invariant, must read ZERO: a room on an inspection that is not there.
  -- The cascade covers a deleted inspection; this covers a row written
  -- against an id that never existed, which is what a route taking an id from
  -- the body without joining it back to the account produces.
  SELECT 'm055_inv_orphan_rooms' AS name, (SELECT COUNT(*) FROM inspection_rooms r
    WHERE NOT EXISTS (SELECT 1 FROM inspections i WHERE i.id = r.inspection_id)) AS value
UNION ALL

  -- And a finished inspection with a room nobody answered. `whyNotFinish`
  -- refuses that, so a row here is a route that stopped asking it.
  SELECT 'm055_inv_finished_unchecked' AS name, (SELECT COUNT(*) FROM inspections i
    WHERE i.status = 'finished'
      AND EXISTS (SELECT 1 FROM inspection_rooms r
                   WHERE r.inspection_id = i.id AND r.status = 'unchecked')) AS value
UNION ALL


  -- 056. Who has been sent an inspection report. No rows is the ordinary
  -- state, so what is checked is the shape.
  SELECT 'm056_inspection_sends' AS name, (SELECT COUNT(*) FROM pragma_table_info('inspection_sends')
    WHERE name IN ('inspection_id','user_id','sent_by','emailed','sent_at')) AS value
UNION ALL

  -- Invariant, must read ZERO: a report sent from an inspection that is not
  -- finished. `canSendInspection` refuses it, because a half-walked document
  -- says nothing while looking like it says everything -- a row here is a
  -- route that stopped asking.
  SELECT 'm056_inv_sent_unfinished' AS name, (SELECT COUNT(*) FROM inspection_sends s
     JOIN inspections i ON i.id = s.inspection_id
    WHERE i.status <> 'finished') AS value
UNION ALL


  -- 057. What is written about a photograph. No rows until somebody drafts
  -- or captions one, so what is checked is the shape.
  SELECT 'm057_photo_notes' AS name, (SELECT COUNT(*) FROM pragma_table_info('inspection_photo_notes')
    WHERE name IN ('photo_id','caption','draft','draft_unclear','drafted_at','drafted_by')) AS value
UNION ALL

  -- Invariant, must read ZERO: a note against a photograph that is not
  -- there. The foreign key says it cannot happen and this is here because
  -- m055_inv_orphan_rooms is -- a route that takes an id from the body
  -- without joining it back is what produces one.
  SELECT 'm057_inv_orphan_notes' AS name, (SELECT COUNT(*) FROM inspection_photo_notes n
    WHERE NOT EXISTS (SELECT 1 FROM inspection_photos p WHERE p.id = n.photo_id)) AS value
UNION ALL

  -- Invariant, must read ZERO: a draft written after the inspection was
  -- finished. Drafting is a write, and finishing is a one-way door --
  -- `whyNotDraft` refuses it, so a row here is a route that stopped asking.
  --
  -- `datetime()` ON BOTH SIDES, AND THAT IS NOT TIDYING. This project writes
  -- timestamps two ways and always has: `drafted_at` is the route's
  -- `new Date().toISOString()` (`2026-10-02T09:15:00.000Z`) and `finished_at`
  -- is SQLite's CURRENT_TIMESTAMP (`2026-10-02 11:40:00`). Compared as TEXT
  -- the 'T' sorts above the space, so a draft written at nine and an
  -- inspection finished at eleven ON THE SAME DAY read as drafted after it --
  -- which is the ordinary case, somebody walking a unit and closing it out on
  -- one visit. It read 8 on the live database with the gate working perfectly.
  -- Both families are UTC, so normalising is the whole of what is needed, and
  -- any OTHER cross-family comparison added here needs the same thing.
  --
  -- AND AN UNPARSEABLE TIMESTAMP IS COUNTED, because `datetime()` answers
  -- NULL for one and a comparison against NULL is NULL -- so a route writing
  -- a malformed date would drop out of this count rather than be reported by
  -- it. That is the direction that hides a real error, which is the one this
  -- file refuses everywhere else.
  SELECT 'm057_inv_drafted_after_finish' AS name, (SELECT COUNT(*) FROM inspection_photo_notes n
     JOIN inspection_photos p ON p.id = n.photo_id
     JOIN inspection_rooms r  ON r.id = p.room_id
     JOIN inspections i       ON i.id = r.inspection_id
    WHERE n.drafted_at IS NOT NULL AND i.finished_at IS NOT NULL
      AND (datetime(n.drafted_at) IS NULL
        OR datetime(i.finished_at) IS NULL
        OR datetime(n.drafted_at) > datetime(i.finished_at))) AS value
UNION ALL


  -- 058. What somebody is to the account that engaged them.
  SELECT 'm058_engaged_as' AS name, (SELECT COUNT(*) FROM pragma_table_info('engagements')
    WHERE name = 'engaged_as') AS value
UNION ALL

  -- Invariant, must read ZERO: a value the product does not produce. NULL is
  -- the ordinary state and reads as subcontractor, so this counts only rows
  -- carrying a word that is neither -- which is a route that stopped
  -- validating against ENGAGED_AS.
  SELECT 'm058_inv_unknown_engaged_as' AS name, (SELECT COUNT(*) FROM engagements
    WHERE engaged_as IS NOT NULL
      AND engaged_as NOT IN ('subcontractor','handyman')) AS value
UNION ALL

  -- Invariant, must read ZERO: a handyman on an account that has no buildings
  -- to maintain. `mayEngageHandyman` refuses it, so a row here is a route
  -- that stopped asking -- and it would be a maintenance worker excused their
  -- insurance on a general contractor's roster.
  SELECT 'm058_inv_handyman_wrong_kind' AS name, (SELECT COUNT(*) FROM engagements e
     JOIN accounts a ON a.id = e.account_id
    WHERE e.engaged_as = 'handyman'
      AND a.kind NOT IN ('property_manager','building_owner','portfolio_manager')) AS value
UNION ALL


  -- 059. What they will be to you, carried on the invite until they arrive.
  SELECT 'm059_invite_engaged_as' AS name, (SELECT COUNT(*) FROM pragma_table_info('sub_invites')
    WHERE name = 'engaged_as') AS value
UNION ALL

  -- Invariant, must read ZERO: the same two faults 058 counts, one table
  -- earlier. They are counted again rather than trusted to the engagement
  -- check, because an invite is where the word is DECIDED and an engagement
  -- is only where it ends up -- a bad value sitting on an unredeemed invite
  -- shows up here today and on `engagements` the day somebody opens the link.
  SELECT 'm059_inv_unknown_engaged_as' AS name, (SELECT COUNT(*) FROM sub_invites
    WHERE engaged_as IS NOT NULL
      AND engaged_as NOT IN ('subcontractor','handyman')) AS value
UNION ALL

  -- Invariant, must read ZERO: a handyman invite from an account with no
  -- buildings to maintain. Counted on every invite, spent or not: a spent one
  -- has already written the word onto an engagement, and an outstanding one
  -- is about to.
  SELECT 'm059_inv_handyman_wrong_kind' AS name, (SELECT COUNT(*) FROM sub_invites i
     JOIN accounts a ON a.id = i.account_id
    WHERE i.engaged_as = 'handyman'
      AND a.kind NOT IN ('property_manager','building_owner','portfolio_manager')) AS value
UNION ALL


  -- 060. Who has to be there to let somebody in.
  SELECT 'm060_job_access' AS name, (SELECT COUNT(*) FROM pragma_table_info('jobs')
    WHERE name = 'access') AS value
UNION ALL

  -- Invariant, must read ZERO: a value the product does not produce. NULL is
  -- the ordinary state and means "not answered", so this counts only a job
  -- carrying a word that is none of the three -- which is a route that stopped
  -- validating against ACCESS_KINDS.
  SELECT 'm060_inv_unknown_access' AS name, (SELECT COUNT(*) FROM jobs
    WHERE access IS NOT NULL
      AND access NOT IN ('tenant','manager','none')) AS value
UNION ALL


  -- 061. The contractor's half of an appointment.
  SELECT 'm061_visit_contractor_at' AS name, (SELECT COUNT(*) FROM pragma_table_info('visits')
    WHERE name = 'contractor_at') AS value
UNION ALL
  SELECT 'm061_visit_contractor_note' AS name, (SELECT COUNT(*) FROM pragma_table_info('visits')
    WHERE name = 'contractor_note') AS value
UNION ALL

  -- Invariant, must read ZERO: a visit marked confirmed that somebody who had
  -- to agree never answered. Scoped to visits on a job whose access answer
  -- asks the tenant, because that is the only side this can be checked for
  -- from SQL alone -- whether a contractor was owed an answer depends on a
  -- live work order, and `visitParties` is where that is decided.
  --
  -- A confirmed window with a tick against it that nobody is attending is the
  -- worst of the three states this can be in, because it reads as settled.
  SELECT 'm061_inv_confirmed_unanswered' AS name, (SELECT COUNT(*) FROM visits v
     JOIN jobs j ON j.id = v.job_id
    WHERE v.status = 'confirmed'
      AND v.responded_at IS NULL
      AND j.access = 'tenant'
      AND j.requested_by IS NOT NULL) AS value
UNION ALL


  -- 062. Which tenant has to be let in, when it is not the person who asked.
  SELECT 'm062_job_access_user' AS name, (SELECT COUNT(*) FROM pragma_table_info('jobs')
    WHERE name = 'access_user_id') AS value
UNION ALL

  -- Invariant, must read ZERO: a job naming somebody who is not a tenant on
  -- that job's own account. NULL is the ordinary state and means "the only
  -- person who can confirm a window is whoever reported the repair", so this
  -- counts only a row a route actually wrote -- and the whole point of the
  -- column is that the named person can answer a visit, which an id with no
  -- tenant seat behind it cannot. It would be a confirmation step waiting on
  -- nobody, which is the failure 060 refused to ship.
  SELECT 'm062_inv_access_not_a_tenant' AS name, (SELECT COUNT(*) FROM jobs j
    WHERE j.access_user_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM memberships m
                       WHERE m.user_id = j.access_user_id
                         AND m.account_id = j.account_id
                         AND m.role = 'tenant')) AS value
UNION ALL


  -- 063. The summary the work order carries.
  --
  -- Counted by its COLUMNS and not by the table name, which is the lesson 052
  -- paid for against a live database: `sqlite_master` tells you a table is
  -- there and `pragma_table_info` tells you it is the right one. Must read 5.
  SELECT 'm063_inspection_summary' AS name, (SELECT COUNT(*) FROM pragma_table_info('inspection_summaries')
    WHERE name IN ('summary','source','model','written_at','written_by')) AS value
UNION ALL

  -- Invariant, must read ZERO: a summary row that says nothing, or one that
  -- does not record what it was written from.
  --
  -- Both are the same fault wearing two hats. An empty paragraph draws a
  -- summary box over a list of rooms with a blank in it, and a blank there
  -- reads as "nothing much wrong" -- which is the one thing a summary must
  -- never say by accident. An empty `source` is worse: staleness is a
  -- comparison against it, so a row with none can never be known to be out of
  -- date and the paragraph becomes unfalsifiable. The route refuses to write
  -- either, and this counts the ones that got past.
  SELECT 'm063_inv_summary_empty' AS name, (SELECT COUNT(*) FROM inspection_summaries
    WHERE TRIM(COALESCE(summary, '')) = ''
       OR TRIM(COALESCE(source, '')) = '') AS value
UNION ALL


  -- 064. The hiring side's own leg of an appointment.
  SELECT 'm064_visit_manager_at' AS name, (SELECT COUNT(*) FROM pragma_table_info('visits')
    WHERE name = 'manager_at') AS value
UNION ALL


  -- 065. The auto-turnaround switch. A column rather than a table, so this is
  -- the one did-I-run-it check for it -- and it was missing until the paste
  -- steps were written out, which is how a migration with a route, a panel and
  -- a test suite behind it still had no way to answer "did I run that one?".
  SELECT 'm065_auto_turnaround' AS name, (SELECT COUNT(*) FROM pragma_table_info('accounts')
    WHERE name = 'auto_turnaround') AS value
UNION ALL


  -- 066. The three ways a job ends without recording that work was done.
  --
  -- FIVE NAMED COLUMNS, not the table name. `sqlite_master` tells you a table
  -- is there and `pragma_table_info` tells you it is the RIGHT one -- which is
  -- what the broken 052 cost once already, when a did-I-run-it check asked
  -- only whether the table existed and answered yes over a table nothing
  -- could write to.
  SELECT 'm066_job_endings' AS name, (SELECT COUNT(*) FROM pragma_table_info('job_endings')
    WHERE name IN ('job_id', 'kind', 'note', 'until', 'at')) AS value
UNION ALL


  -- Invariant, must read ZERO: an ending whose kind is not one of the four.
  --
  -- The column is plain TEXT on purpose -- a CHECK on a table this young is a
  -- full rebuild the first time a fifth word is wanted, which is 003's own
  -- trade -- so this is what stands in for one. A row nothing recognises reads
  -- as "not ended" to `jobEnding`, which is the direction that draws a
  -- cancelled job as live work.
  SELECT 'm066_inv_bad_kind' AS name, (SELECT COUNT(*) FROM job_endings
    WHERE kind NOT IN ('cancelled', 'deferred', 'no_work', 'resumed')) AS value
UNION ALL


  -- Invariant, must read ZERO: a cancelled or closed-out job with a work order
  -- nobody voided.
  --
  -- This is the one that costs somebody a wasted journey. The route voids
  -- every live order as it writes the ending, so a row here is a contractor
  -- who still has a price, a date and no idea the work is off. Scoped to the
  -- NEWEST ending per job, because a job deferred in January, resumed in
  -- March and running again legitimately has live orders.
  SELECT 'm066_inv_live_wo_on_ended' AS name, (SELECT COUNT(*) FROM work_orders w
    WHERE w.voided_at IS NULL
      AND (SELECT e.kind FROM job_endings e WHERE e.job_id = w.job_id
            ORDER BY e.at DESC, e.rowid DESC LIMIT 1) IN ('cancelled', 'no_work')) AS value
UNION ALL


  -- Invariant, must read ZERO: money settled against a job that was cancelled
  -- or closed with nothing done.
  --
  -- `no_work` writes `status = 'completed'`, which is exactly the state a
  -- release is normally paid against -- so without the gate in
  -- `jobEndingBlocksPay` it would be the most payable a job ever gets. A row
  -- here is a payment made for work nobody did, which is the one mistake in
  -- this schema that a word cannot undo.
  SELECT 'm066_inv_paid_on_ended' AS name, (SELECT COUNT(*) FROM wo_releases r
    JOIN work_orders w ON w.id = r.work_order_id
    WHERE r.status = 'paid'
      AND (SELECT e.kind FROM job_endings e WHERE e.job_id = w.job_id
            ORDER BY e.at DESC, e.rowid DESC LIMIT 1) IN ('cancelled', 'no_work')) AS value
UNION ALL


  -- Invariant, must read ZERO: a `resumed` row against a job whose newest
  -- OTHER ending was never a deferral.
  --
  -- Resuming is how a HOLD ends and nothing else: a cancellation is terminal,
  -- and a row claiming to have taken one off hold would make `jobEnding`
  -- answer "live" for work somebody called off -- which is the gate opening
  -- rather than merely a tidiness complaint. The route refuses it; this counts
  -- what got past.
  -- THE TIEBREAK IS PART OF "PREVIOUS", and leaving it out is what the
  -- feature's own suite caught on its first run: `at` is written as an ISO
  -- string from the route, so a hold and the resume that follows it seconds
  -- later can share one to the millisecond -- and `e.at < r.at` then finds
  -- nothing, reads the hold as absent, and counts an ORDINARY deferral as a
  -- fault. An invariant that fires on the common case is a bug report nobody
  -- can action. `(at, rowid)` is the same ordering every read above uses.
  SELECT 'm066_inv_resume_without_hold' AS name, (SELECT COUNT(*) FROM job_endings r
    WHERE r.kind = 'resumed'
      AND COALESCE((SELECT e.kind FROM job_endings e
                     WHERE e.job_id = r.job_id
                       AND (e.at < r.at OR (e.at = r.at AND e.rowid < r.rowid))
                     ORDER BY e.at DESC, e.rowid DESC LIMIT 1), 'none') <> 'deferred') AS value
UNION ALL


  -- 067. Invariant, must read ZERO: a live window the HIRING SIDE proposed
  -- with no record that they agreed to it.
  --
  -- There is no column for 067 to check -- it is a backfill, not a schema
  -- change -- so this is both the did-I-run-it and the stays-true. 064's rule
  -- is that proposing is agreeing, so a window somebody on the team put
  -- forward carries their agreement by definition; a row here is one where it
  -- was not recorded, and the cost is the chain waiting on a side that agreed
  -- weeks ago with no button anywhere to say so. Reported from a manager's own
  -- Jobs screen exactly that way.
  --
  -- It stays zero by itself: the propose route stamps the leg at write time,
  -- so only rows written before 064 shipped could be in here, and 067 clears
  -- those. A contractor's or a tenant's own proposal is NOT counted -- those
  -- legitimately leave the hiring side outstanding, which is the whole of what
  -- 064 added.
  SELECT 'm067_inv_manager_unstamped' AS name, (SELECT COUNT(*) FROM visits v
    WHERE v.manager_at IS NULL
      AND v.status IN ('proposed', 'confirmed')
      AND v.proposed_by IS NOT NULL
      AND EXISTS (SELECT 1 FROM memberships m
                   WHERE m.user_id = v.proposed_by
                     AND m.account_id = v.account_id
                     AND m.role IN ('admin', 'pm'))) AS value
)
-- Problems first: `verdict = 'ok'` is 1 when it is fine and 0 when it is not,
-- and ASC puts the 0s at the top. Then by name, so one database's answer is
-- always in the same order as another's.
ORDER BY verdict = 'ok', name;
  -- NO INVARIANT, AND THE REASON IS WORTH STATING rather than leaving the
  -- next person to wonder why 061 has one and this does not.
  --
  -- The obvious one -- a confirmed visit with no hiring-side agreement -- reads
  -- NON-ZERO on every live database, because every row written before this
  -- migration settled under the 061 rule and legitimately has none. An
  -- invariant that ships knowing it reads non-zero is a bug report nobody can
  -- action, which is this file's own rule about the untrimmed company names.
  --
  -- Scoping it to rows written after the column arrived would need a date this
  -- schema does not hold, and scoping it to "rows that had a contractor leg"
  -- catches exactly the 061-era rows it must not. The property is checked
  -- where it can be: `visit-party-test.mjs` drives the chain end to end, and
  -- whether a party is owed an answer at all depends on a live work order,
  -- which is `visitParties`'s to decide and not SQL's.
