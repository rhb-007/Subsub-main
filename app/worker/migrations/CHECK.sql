-- Which migrations has this database actually had?
--
-- Paste this into the D1 console ONE STATEMENT AT A TIME: statement 1, read it,
-- then statement 2. They are separated by a blank line and marked
-- `===== STATEMENT n of 2`. The first answers "did I run that one?" and the
-- second "is anything wrong?".
--
-- READ THE FIRST COLUMN AND NOTHING ELSE. `verdict` is 'ok', or it names what
-- to do, and the rows that are not ok sort to the TOP. If the first row of a
-- statement says ok then every row of it does.
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
-- a check query that quietly answers a different question.
--
-- WHY NEITHER STATEMENT CONTAINS A SINGLE `UNION ALL`.
--
-- D1 has refused this file four times, and three of those refusals were caused
-- by the fix for the one before:
--
--   ONE ROW OF 110 COLUMNS -> `too many columns in result set`. D1 refuses a
--   result set wider than 100. Unrunnable from migration 063, which took it
--   from 100 to 102, and nobody found out for five migrations because the only
--   place it is ever really run is an iPad.
--
--   110 ROWS VIA UNION ALL -> `too many terms in compound SELECT`. The note
--   written at the time said rows "have no ceiling" and "can never run the
--   file into a limit again". Simply wrong: every UNION ALL is a term and
--   terms are capped too.
--
--   31 TERMS -> the same error. That note had said 31 "accepts this", on no
--   evidence beyond 110 having been refused.
--
--   SEVEN TERMS -> the same error again. That one had been split deliberately
--   far under the number that failed, on the reasoning that far-under is safe.
--
-- Three guesses, three refusals. **A limit nobody has measured cannot be
-- respected by arithmetic**, so the answer is not a smaller number: it is no
-- compound SELECT anywhere. Both statements build a JSON array by
-- concatenating pieces with `||` and read it back through `json_each`, which is
-- the one shape D1 has ever been seen to accept -- 79 entries of it, in
-- statement 1, which ran cleanly when everything else was being refused.
--
-- `json_object` would have been the tidier spelling and is refused: it needs
-- two arguments per entry and D1 caps arguments per function far below
-- SQLite's own default, so the thing that grows would point straight at the
-- next ceiling along. `json_array(name, value)` is two arguments per call
-- whatever the list does.
--
-- ADDING EITHER KIND OF CHECK IS NOW ONE LINE and costs no term, so this file
-- cannot run into either limit again however long it gets. The comment above
-- each entry sits between the concatenated pieces, so each keeps the record of
-- why it exists.
--
-- It exists because "did I run that one?" came up after nearly every round,
-- and the honest answer from a chat thread is a guess. Safe to run as often
-- as you like: it reads nothing but the table definitions and changes
-- nothing.

-- ===== STATEMENT 1 of 2 -- did I run that one? =====================
--
-- A few rows count SEVERAL columns at once, so they answer with how many they
-- found rather than 1. That is why the list carries a column NAME LIST rather
-- than a count: the check is "these columns are present", and a number in the
-- file would be a second record of the same fact.
WITH spec(j) AS (SELECT
  '[["m018_user_notify","col","users",["notify"]]' ||
  ',["m019_visits","table","visits",null]' ||
  ',["m020_withdrawn","col","jobs",["withdrawn_at"]]' ||
  ',["m021_declined","col","jobs",["declined_at"]]' ||
  ',["m022_photos","col","jobs",["photos"]]' ||
  ',["m022_report_detail","col","jobs",["report_detail"]]' ||
  ',["m023_severity","col","jobs",["severity"]]' ||
  ',["m023_emergency_sub","col","accounts",["emergency_company_id"]]' ||
  ',["m024_pay_kind","col","work_orders",["pay_kind"]]' ||
  ',["m024_rate_cents","col","work_orders",["rate_cents"]]' ||
  ',["m024_cap_hours","col","work_orders",["cap_hours"]]' ||
  ',["m025_updated_at","col","jobs",["updated_at"]]' ||
  ',["m026_supplier","col","jobs",["material_supplier"]]' ||
  ',["m026_branch","col","jobs",["material_branch"]]' ||
  ',["m027_invite_email","col","sub_invites",["email"]]' ||
  ',["m027_invite_sent","col","sub_invites",["sent_at"]]' ||
  ',["m028_user_invites","table","user_invites",null]' ||
  ',["m029_invite_phone","col","sub_invites",["phone"]]' ||
  ',["m030_connect_requests","table","connect_requests",null]' ||
  ',["m030_connect_code","col","companies",["connect_code"]]' ||
  ',["m031_account_company","col","accounts",["company_id"]]' ||
  ',["m032_avatar","col","users",["avatar_key"]]' ||
  ',["m033_milestones","table","wo_milestones",null]' ||
  ',["m033_events","table","wo_events",null]' ||
  ',["m033_releases","table","wo_releases",null]' ||
  ',["m034_retainage","col","work_orders",["retainage_bps"]]' ||
  ',["m035_waivers","table","lien_waivers",null]' ||
  ',["m035_lower_tier","table","lower_tier_parties",null]' ||
  ',["m036_scope","col","work_orders",["scope_kind"]]' ||
  ',["m037_docs","table","company_docs",null]' ||
  ',["m037_reminders","table","doc_reminders",null]' ||
  ',["m038_optin","col","companies",["overflow_opt_in"]]' ||
  ',["m038_trades","col","companies",["overflow_trades"]]' ||
  ',["m038_since","col","companies",["overflow_since"]]' ||
  ',["m038_posts","table","overflow_posts",null]' ||
  ',["m038_invites","table","overflow_invites",null]' ||
  ',["m038_responses","table","overflow_responses",null]' ||
  ',["m039_owner","col","properties",["owner_account_id"]]' ||
  ',["m039_transfers","table","property_transfers",null]' ||
  ',["m040_declared_at","col","properties",["owner_declared_at"]]' ||
  ',["m040_declared_by","col","properties",["owner_declared_by"]]' ||
  ',["m041_doc_shares","table","doc_shares",null]' ||
  ',["m043_quote_requests","table","quote_requests",null]' ||
  ',["m043_quote_invites","table","quote_invites",null]' ||
  ',["m044_retouches","table","doc_retouches",null]' ||
  ',["m044_optouts","table","doc_share_optouts",null]' ||
  ',["m045_inboxes","table","doc_inboxes",null]' ||
  -- 047. Whether this company has been ASKED to be hireable. NULL on a row
  -- means not answered, never "no", and the effective default is open -- so
  -- this counts the column, not the answers.
  ',["m047_open_to_hire","col","companies",["open_to_hire"]]' ||
  -- 048. The CRM API: the tokens, and the row that makes a retried webhook
  -- return the job it already made. ux_job_sources_external is counted
  -- separately because it is the constraint doing that work -- the table
  -- without it takes the duplicate and reports success.
  ',["m048_api_tokens","table","api_tokens",null]' ||
  ',["m048_job_sources","table","job_sources",null]' ||
  ',["m048_dedupe_index","index","ux_job_sources_external",null]' ||
  -- 049. The account's CRM vocabulary, and the words that meant nothing.
  ',["m049_trade_rules","table","crm_trade_rules",null]' ||
  ',["m049_unmapped","table","crm_unmapped",null]' ||
  -- 050. Where a subcontractor's money goes. Both indexes are counted
  -- separately from the table because each one is doing work the table alone
  -- does not: the first stops a company growing a second connected account
  -- (two places money could go, nothing saying which), and the second is the
  -- column the Connect webhook looks a row up by, so a duplicate there is an
  -- ambiguous answer at the moment money is involved.
  ',["m050_payout_accounts","table","payout_accounts",null]' ||
  ',["m050_one_per_company","index","ux_payout_account_company",null]' ||
  ',["m050_one_per_acct","index","ux_payout_account_processor",null]' ||
  -- 051. Money in against a work order, money out per release. The live-
  -- transfer index is counted separately because it is the half that holds
  -- when two people press pay at once -- the table alone takes the second
  -- transfer and reports success, which is the one failure this whole ledger
  -- exists to make impossible. It is PARTIAL (status <> 'failed') so a
  -- declined attempt can be retried; a plain unique index there would leave
  -- somebody unpayable because a card bounced once.
  ',["m051_wo_funding","table","wo_funding",null]' ||
  ',["m051_wo_transfers","table","wo_transfers",null]' ||
  ',["m051_one_live_transfer","index","ux_wo_transfer_live",null]' ||
  ',["m051_one_per_intent","index","ux_wo_funding_intent",null]' ||
  -- 052. An agreement is between TWO PARTIES, so it hangs off the pair rather
  -- than sitting as one boolean on the shared company row. The live index is
  -- counted separately because it is the half that holds when two people
  -- issue one at once, and it is PARTIAL ('sent','signed','countersigned') so
  -- a relationship whose first agreement was declined can have another.
  ',["m052_agreements","table","agreements",null]' ||
  ',["m052_agreement_terms","table","agreement_terms",null]' ||
  ',["m052_one_live_agreement","index","ux_agreement_live",null]' ||
  -- 053. A project manager scoped to named jobs, which is what a general
  -- contractor has instead of buildings. No rows means no restriction, so
  -- there is nothing here that must be non-zero -- the table existing is the
  -- whole of what the migration did.
  ',["m053_membership_jobs","table","membership_jobs",null]' ||
  -- 055. Move-in and move-out unit inspections. Three tables; no rows is the
  -- ordinary state of a fresh database, so what is checked is that they are
  -- there and carry the columns the routes read.
  ',["m055_inspections","col","inspections",["kind","status","property_id","unit","job_id","finished_at"]]' ||
  ',["m055_inspection_rooms","col","inspection_rooms",["inspection_id","name","status","note","position"]]' ||
  ',["m055_inspection_photos","col","inspection_photos",["room_id","file_key","content_type"]]' ||
  -- 056. Who has been sent an inspection report. No rows is the ordinary
  -- state, so what is checked is the shape.
  ',["m056_inspection_sends","col","inspection_sends",["inspection_id","user_id","sent_by","emailed","sent_at"]]' ||
  -- 057. What is written about a photograph. No rows until somebody drafts
  -- or captions one, so what is checked is the shape.
  ',["m057_photo_notes","col","inspection_photo_notes",["photo_id","caption","draft","draft_unclear","drafted_at","drafted_by"]]' ||
  -- 058. What somebody is to the account that engaged them.
  ',["m058_engaged_as","col","engagements",["engaged_as"]]' ||
  -- 059. What they will be to you, carried on the invite until they arrive.
  ',["m059_invite_engaged_as","col","sub_invites",["engaged_as"]]' ||
  -- 060. Who has to be there to let somebody in.
  ',["m060_job_access","col","jobs",["access"]]' ||
  -- 061. The contractor's half of an appointment.
  ',["m061_visit_contractor_at","col","visits",["contractor_at"]]' ||
  ',["m061_visit_contractor_note","col","visits",["contractor_note"]]' ||
  -- 062. Which tenant has to be let in, when it is not the person who asked.
  ',["m062_job_access_user","col","jobs",["access_user_id"]]' ||
  -- 063. The summary the work order carries.
  --
  -- Counted by its COLUMNS and not by the table name, which is the lesson 052
  -- paid for against a live database: `sqlite_master` tells you a table is
  -- there and `pragma_table_info` tells you it is the right one. Must read 5.
  ',["m063_inspection_summary","col","inspection_summaries",["summary","source","model","written_at","written_by"]]' ||
  -- 064. The hiring side's own leg of an appointment.
  ',["m064_visit_manager_at","col","visits",["manager_at"]]' ||
  -- 065. The auto-turnaround switch. A column rather than a table, so this is
  -- the one did-I-run-it check for it -- and it was missing until the paste
  -- steps were written out, which is how a migration with a route, a panel and
  -- a test suite behind it still had no way to answer "did I run that one?".
  ',["m065_auto_turnaround","col","accounts",["auto_turnaround"]]' ||
  -- 066. The three ways a job ends without recording that work was done.
  --
  -- FIVE NAMED COLUMNS, not the table name. `sqlite_master` tells you a table
  -- is there and `pragma_table_info` tells you it is the RIGHT one -- which is
  -- what the broken 052 cost once already, when a did-I-run-it check asked
  -- only whether the table existed and answered yes over a table nothing
  -- could write to.
  ',["m066_job_endings","col","job_endings",["job_id","kind","note","until","at"]]' ||
  -- 068. Inspections arriving from somebody else's system: the retry key, the
  -- account's dictionary for condition words, and the queue of words that meant
  -- nothing. Three tables, counted by their COLUMNS -- 052's lesson.
  ',["m068_inspection_sources","col","inspection_sources",["inspection_id","source","external_id","token_id"]]' ||
  ',["m068_inspection_status_rules","col","inspection_status_rules",["source","match_value","status"]]' ||
  ',["m068_inspection_unmapped","col","inspection_unmapped",["source","match_value","hits","last_seen"]]' ||
  -- The two unique indexes, named because neither is a convenience. Dropping
  -- the first does not slow anything down, it silently allows one walk to
  -- arrive four times; dropping the second turns a counted queue into one row
  -- per room per walk.
  ',["m068_inspection_sources_unique","index","ux_inspection_sources_external",[]]' ||
  ',["m068_inspection_unmapped_unique","index","ux_inspection_unmapped",[]]' ||
  -- 069. The paper each waiver is made of. Counted by its columns -- 052's
  -- lesson -- and the open-request index named, because without it two
  -- presses ask a subcontractor for the same waiver twice.
  ',["m069_waiver_forms","col","waiver_forms",["waiver_id","source","template_id","template_version","parties","uploaded_side"]]' ||
  ',["m069_waiver_open_unique","index","ux_waiver_open",[]]' ||
  -- 070. Texts past the included 2,500, charged on the 1st, and the switch to
  -- turn texts off. Until it is run texts still go; the nightly sweep cannot
  -- record a bill and says so, and the switch answers migration_needed.
  ',["m070_sms_overage","col","sms_overage",["account_id","month","blocks","amount_cents","status","processor_ref"]]' ||
  ',["m070_sms_overage_unique","index","ux_sms_overage_month",[]]' ||
  ',["m070_sms_settings","col","account_sms_settings",["account_id","sms_off","updated_by","updated_at"]]' ||
  -- 071. An account's own fee terms from the staff console. Until it is run
  -- every account is on the defaults and the console's fee panel says so.
  ',["m071_fee_terms","col","account_fee_terms",["account_id","fee_bps","cap_cents","free_cents","updated_by"]]' ||
  ']'),
want(name, kind, on_, cols) AS (
  SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]'),
         json_extract(value, '$[2]'), json_extract(value, '$[3]')
    FROM spec, json_each(spec.j)
)
-- EVERY ROW HERE IS A DID-I-RUN-IT CHECK, so the verdict needs no special
-- cases: the tri-state and the invariants are all in statement 2. A rule with
-- branches that can never fire is a rule somebody later reads as load-bearing.
SELECT
  CASE WHEN value >= 1 THEN 'ok' ELSE 'NOT RUN' END AS verdict,
  name,
  value
FROM (
  SELECT w.name AS name, CASE w.kind
    WHEN 'col'   THEN (SELECT COUNT(*) FROM pragma_table_info(w.on_) p
                        WHERE EXISTS (SELECT 1 FROM json_each(w.cols) c WHERE c.value = p.name))
    WHEN 'table' THEN (SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = w.on_)
    WHEN 'index' THEN (SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = w.on_)
    END AS value
    FROM want w
)
-- Problems first: `verdict = 'ok'` is 1 when it is fine and 0 when it is not,
-- and ASC puts the 0s at the top. Then by name, so one database's answer is
-- always in the same order as another's.
ORDER BY verdict = 'ok', name;

-- ===== STATEMENT 2 of 2 -- is anything WRONG? ======================
--
-- These are not migrations. Every one counts BROKEN ROWS, so 0 is the good
-- answer and anything above 0 is a bug report about a route rather than a
-- missing paste.
--
-- ONE STATEMENT AND NOT ONE TERM OF COMPOUND SELECT, for the reason the
-- header gives: D1 refused 110 UNION ALL terms, then 31, then SEVEN. The
-- limit is below seven and nobody here has measured it, so the only safe
-- number of terms is none. Each invariant is a json_array(name, (SELECT …))
-- pair, the pairs are joined with || into one JSON array, and json_each turns
-- that array back into rows -- which is exactly the shape statement 1 uses and
-- the only shape D1 has ever been seen to accept, at 79 entries.
--
-- Adding one is ONE PIECE in the list below, and it costs no term, so this
-- cannot run into either limit again however many arrive. Two arguments per
-- json_array call, never a 62-argument json_object, because D1 caps arguments
-- per function far below SQLite's own default and that would be the next
-- ceiling along.
--
-- THESE ARE NOT ALL INVARIANTS, which is why the verdict keeps the full rule.
-- Two of the rows are did-I-run-it checks that could not be written as data:
-- `m046_kind_check` is a tri-state read off the table's own DDL, and
-- `m046_subdomain_unique` has to ask which COLUMN an index covers, because
-- schema.sql gets its uniqueness from an inline UNIQUE whose autoindex has no
-- name to look up. Reading either as "0 is good" would report a healthy
-- database as broken.
--
-- m031_hireable_without, m031_others_with and m039_unowned predate the
-- `_inv_` marker and are named in the verdict for that reason; nothing new
-- should join them without it.
WITH inv(j) AS (SELECT '['
  -- Not a column check: the point of 031 is that every account that can BE
  -- HIRED has one, and no other kind does. It read `general_contractor` alone
  -- until `subcontractor` was added -- at which point the invariant would have
  -- flagged every subcontractor account as an illegal company row while
  -- silently allowing one with no company to be hired as. The list here has to
  -- stay in step with HIREABLE_KINDS in worker/index.js; nothing enforces that
  -- but this comment and the migration-gap test.
  || json_array('m031_hireable_without', (SELECT COUNT(*) FROM accounts
    WHERE kind IN ('general_contractor','subcontractor')
      AND company_id IS NULL))
  || ',' || json_array('m031_others_with', (SELECT COUNT(*) FROM accounts
    WHERE kind NOT IN ('general_contractor','subcontractor')
      AND company_id IS NOT NULL))
  -- Not a column check: 039's backfill must have left every building owned by
  -- whoever holds it, or an unclaimed property can never be handed over.
  || ',' || json_array('m039_unowned', (SELECT COUNT(*) FROM properties WHERE owner_account_id IS NULL))
  -- 046 is the one migration here that MOST DATABASES MUST NOT RUN, so this
  -- reads the shape rather than asking whether a column arrived.
  --
  --   0  no CHECK on accounts.kind -- 003 added it as plain TEXT on purpose.
  --      The subcontractor kind stores with nothing run. Do not run 046.
  --   1  the OLD constraint, from a database built out of schema.sql. It
  --      REFUSES 'subcontractor', and a subcontractor signing up gets a 409
  --      and no account. Run 046's rebuild.
  --   2  already widened. Nothing to do.
  || ',' || json_array('m046_kind_check', (SELECT CASE
     WHEN (SELECT sql FROM sqlite_master WHERE type='table' AND name='accounts')
            NOT LIKE '%CHECK (kind IN%' THEN 0
     WHEN (SELECT sql FROM sqlite_master WHERE type='table' AND name='accounts')
            LIKE '%''subcontractor''%' THEN 2
     ELSE 1 END))
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
  || ',' || json_array('m046_subdomain_unique', (SELECT COUNT(*) FROM pragma_index_list('accounts') il
    WHERE il."unique" = 1
      AND EXISTS (SELECT 1 FROM pragma_index_info(il.name) ii
                   WHERE ii.name = 'subdomain')))
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
  || ',' || json_array('m050_inv_verified_but_stuck', (SELECT COUNT(*) FROM payout_accounts
    WHERE kyc_status = 'verified'
      AND (payouts_enabled = 0 OR transfers_active = 0)))
  -- Invariants, both of which must read ZERO.
  --
  -- A release marked paid with no transfer behind it is the ORIGINAL bug in a
  -- new place: somebody was told their money went and nothing carries it.
  -- Scoped to Stripe-settled releases, because a cheque legitimately has no
  -- transfer row -- `method` is the seam and 'manual' still means what it
  -- always meant.
  || ',' || json_array('m051_inv_paid_without_transfer', (SELECT COUNT(*) FROM wo_releases r
    WHERE r.status = 'paid' AND r.method = 'stripe'
      AND NOT EXISTS (SELECT 1 FROM wo_transfers t
                       WHERE t.release_id = r.id AND t.status IN ('paid','pending'))))
  -- And the reverse, which is worse: money that left against a release
  -- nothing says was paid. That is a transfer nobody can reconcile.
  || ',' || json_array('m051_inv_transfer_without_paid', (SELECT COUNT(*) FROM wo_transfers t
    JOIN wo_releases r ON r.id = t.release_id
    WHERE t.status = 'paid' AND r.status <> 'paid'))
  -- Must read ZERO. SubSub's fee is charged only on money that went through
  -- SubSub, so a release recorded as paid any other way -- a cheque, a bank
  -- transfer somebody made themselves -- must carry none. The settle route
  -- zeroes it in the same write that closes the release; a row here is a
  -- release whose fee the account would be told it paid and never did.
  -- COALESCE, because a NULL method is "not stripe" and must be counted.
  || ',' || json_array('m033_inv_fee_off_platform', (SELECT COUNT(*) FROM wo_releases
    WHERE status = 'paid' AND COALESCE(method, '') <> 'stripe' AND fee_cents > 0))
  -- Invariants, both of which must read ZERO.
  --
  -- In force means BOTH signed. A row saying countersigned with either
  -- signature missing is a contract the product would enforce -- gating
  -- compliance, and soon payment -- on a document nobody can show was agreed.
  || ',' || json_array('m052_inv_countersigned_unsigned', (SELECT COUNT(*) FROM agreements
    WHERE status = 'countersigned'
      AND (signed_at IS NULL OR countersigned_at IS NULL)))
  -- And a signature with no record of WHAT was signed. The hash is the whole
  -- difference between proving somebody signed something and proving what;
  -- an uploaded agreement is excused only until it has been uploaded, so this
  -- counts the ones that carry neither a hash nor a file.
  || ',' || json_array('m052_inv_signed_without_doc', (SELECT COUNT(*) FROM agreements
    WHERE signed_at IS NOT NULL
      AND COALESCE(doc_sha256, '') = '' AND COALESCE(file_name, '') = ''))
  -- Invariant, must read ZERO: a scope row against a seat that is not scoped
  -- by job at all. `jobScopeFrom` ignores those, so such a row is a list
  -- somebody built that narrows nobody -- and it would start narrowing them
  -- the day that role joined JOB_SCOPED_ROLES, silently.
  || ',' || json_array('m053_inv_scoped_wrong_role', (SELECT COUNT(*) FROM membership_jobs mj
     JOIN memberships m ON m.id = mj.membership_id
    WHERE m.role <> 'pm'))
  -- And a scope row pointing at a job on a different account from the seat.
  -- The cascade cannot catch this one: both rows are real, and the pair is
  -- what is wrong. A seat narrowed to somebody else's job either sees nothing
  -- or sees across accounts, and which one it is depends on a JOIN elsewhere.
  || ',' || json_array('m053_inv_scope_crosses_account', (SELECT COUNT(*) FROM membership_jobs mj
     JOIN memberships m ON m.id = mj.membership_id
     JOIN jobs j ON j.id = mj.job_id
    WHERE j.account_id <> m.account_id))
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
  || ',' || json_array('m054_inv_scoped_wrong_role', (SELECT COUNT(*) FROM membership_properties mp
     JOIN memberships m ON m.id = mp.membership_id
    WHERE m.role NOT IN ('pm', 'owner', 'tenant')))
  -- Invariant, must read ZERO: a room on an inspection that is not there.
  -- The cascade covers a deleted inspection; this covers a row written
  -- against an id that never existed, which is what a route taking an id from
  -- the body without joining it back to the account produces.
  || ',' || json_array('m055_inv_orphan_rooms', (SELECT COUNT(*) FROM inspection_rooms r
    WHERE NOT EXISTS (SELECT 1 FROM inspections i WHERE i.id = r.inspection_id)))
  -- And a finished inspection with a room nobody answered. `whyNotFinish`
  -- refuses that, so a row here is a route that stopped asking it.
  || ',' || json_array('m055_inv_finished_unchecked', (SELECT COUNT(*) FROM inspections i
    WHERE i.status = 'finished'
      AND EXISTS (SELECT 1 FROM inspection_rooms r
                   WHERE r.inspection_id = i.id AND r.status = 'unchecked')))
  -- Invariant, must read ZERO: a report sent from an inspection that is not
  -- finished. `canSendInspection` refuses it, because a half-walked document
  -- says nothing while looking like it says everything -- a row here is a
  -- route that stopped asking.
  || ',' || json_array('m056_inv_sent_unfinished', (SELECT COUNT(*) FROM inspection_sends s
     JOIN inspections i ON i.id = s.inspection_id
    WHERE i.status <> 'finished'))
  -- Invariant, must read ZERO: a note against a photograph that is not
  -- there. The foreign key says it cannot happen and this is here because
  -- m055_inv_orphan_rooms is -- a route that takes an id from the body
  -- without joining it back is what produces one.
  || ',' || json_array('m057_inv_orphan_notes', (SELECT COUNT(*) FROM inspection_photo_notes n
    WHERE NOT EXISTS (SELECT 1 FROM inspection_photos p WHERE p.id = n.photo_id)))
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
  || ',' || json_array('m057_inv_drafted_after_finish', (SELECT COUNT(*) FROM inspection_photo_notes n
     JOIN inspection_photos p ON p.id = n.photo_id
     JOIN inspection_rooms r  ON r.id = p.room_id
     JOIN inspections i       ON i.id = r.inspection_id
    WHERE n.drafted_at IS NOT NULL AND i.finished_at IS NOT NULL
      AND (datetime(n.drafted_at) IS NULL
        OR datetime(i.finished_at) IS NULL
        OR datetime(n.drafted_at) > datetime(i.finished_at))))
  -- Invariant, must read ZERO: a value the product does not produce. NULL is
  -- the ordinary state and reads as subcontractor, so this counts only rows
  -- carrying a word that is neither -- which is a route that stopped
  -- validating against ENGAGED_AS.
  || ',' || json_array('m058_inv_unknown_engaged_as', (SELECT COUNT(*) FROM engagements
    WHERE engaged_as IS NOT NULL
      AND engaged_as NOT IN ('subcontractor','handyman')))
  -- Invariant, must read ZERO: a handyman on an account that has no buildings
  -- to maintain. `mayEngageHandyman` refuses it, so a row here is a route
  -- that stopped asking -- and it would be a maintenance worker excused their
  -- insurance on a general contractor's roster.
  || ',' || json_array('m058_inv_handyman_wrong_kind', (SELECT COUNT(*) FROM engagements e
     JOIN accounts a ON a.id = e.account_id
    WHERE e.engaged_as = 'handyman'
      AND a.kind NOT IN ('property_manager','building_owner','portfolio_manager')))
  -- Invariant, must read ZERO: the same two faults 058 counts, one table
  -- earlier. They are counted again rather than trusted to the engagement
  -- check, because an invite is where the word is DECIDED and an engagement
  -- is only where it ends up -- a bad value sitting on an unredeemed invite
  -- shows up here today and on `engagements` the day somebody opens the link.
  || ',' || json_array('m059_inv_unknown_engaged_as', (SELECT COUNT(*) FROM sub_invites
    WHERE engaged_as IS NOT NULL
      AND engaged_as NOT IN ('subcontractor','handyman')))
  -- Invariant, must read ZERO: a handyman invite from an account with no
  -- buildings to maintain. Counted on every invite, spent or not: a spent one
  -- has already written the word onto an engagement, and an outstanding one
  -- is about to.
  || ',' || json_array('m059_inv_handyman_wrong_kind', (SELECT COUNT(*) FROM sub_invites i
     JOIN accounts a ON a.id = i.account_id
    WHERE i.engaged_as = 'handyman'
      AND a.kind NOT IN ('property_manager','building_owner','portfolio_manager')))
  -- Invariant, must read ZERO: a value the product does not produce. NULL is
  -- the ordinary state and means "not answered", so this counts only a job
  -- carrying a word that is none of the three -- which is a route that stopped
  -- validating against ACCESS_KINDS.
  || ',' || json_array('m060_inv_unknown_access', (SELECT COUNT(*) FROM jobs
    WHERE access IS NOT NULL
      AND access NOT IN ('tenant','manager','none')))
  -- Invariant, must read ZERO: a visit marked confirmed that somebody who had
  -- to agree never answered. Scoped to visits on a job whose access answer
  -- asks the tenant, because that is the only side this can be checked for
  -- from SQL alone -- whether a contractor was owed an answer depends on a
  -- live work order, and `visitParties` is where that is decided.
  --
  -- A confirmed window with a tick against it that nobody is attending is the
  -- worst of the three states this can be in, because it reads as settled.
  || ',' || json_array('m061_inv_confirmed_unanswered', (SELECT COUNT(*) FROM visits v
     JOIN jobs j ON j.id = v.job_id
    WHERE v.status = 'confirmed'
      AND v.responded_at IS NULL
      AND j.access = 'tenant'
      AND j.requested_by IS NOT NULL))
  -- Invariant, must read ZERO: a job naming somebody who is not a tenant on
  -- that job's own account. NULL is the ordinary state and means "the only
  -- person who can confirm a window is whoever reported the repair", so this
  -- counts only a row a route actually wrote -- and the whole point of the
  -- column is that the named person can answer a visit, which an id with no
  -- tenant seat behind it cannot. It would be a confirmation step waiting on
  -- nobody, which is the failure 060 refused to ship.
  || ',' || json_array('m062_inv_access_not_a_tenant', (SELECT COUNT(*) FROM jobs j
    WHERE j.access_user_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM memberships m
                       WHERE m.user_id = j.access_user_id
                         AND m.account_id = j.account_id
                         AND m.role = 'tenant')))
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
  || ',' || json_array('m063_inv_summary_empty', (SELECT COUNT(*) FROM inspection_summaries
    WHERE TRIM(COALESCE(summary, '')) = ''
       OR TRIM(COALESCE(source, '')) = ''))
  -- Invariant, must read ZERO: an ending whose kind is not one of the four.
  --
  -- The column is plain TEXT on purpose -- a CHECK on a table this young is a
  -- full rebuild the first time a fifth word is wanted, which is 003's own
  -- trade -- so this is what stands in for one. A row nothing recognises reads
  -- as "not ended" to `jobEnding`, which is the direction that draws a
  -- cancelled job as live work.
  || ',' || json_array('m066_inv_bad_kind', (SELECT COUNT(*) FROM job_endings
    WHERE kind NOT IN ('cancelled', 'deferred', 'no_work', 'resumed')))
  -- Invariant, must read ZERO: a cancelled or closed-out job with a work order
  -- nobody voided.
  --
  -- This is the one that costs somebody a wasted journey. The route voids
  -- every live order as it writes the ending, so a row here is a contractor
  -- who still has a price, a date and no idea the work is off. Scoped to the
  -- NEWEST ending per job, because a job deferred in January, resumed in
  -- March and running again legitimately has live orders.
  || ',' || json_array('m066_inv_live_wo_on_ended', (SELECT COUNT(*) FROM work_orders w
    WHERE w.voided_at IS NULL
      AND (SELECT e.kind FROM job_endings e WHERE e.job_id = w.job_id
            ORDER BY e.at DESC, e.rowid DESC LIMIT 1) IN ('cancelled', 'no_work')))
  -- Invariant, must read ZERO: money settled against a job that was cancelled
  -- or closed with nothing done.
  --
  -- `no_work` writes `status = 'completed'`, which is exactly the state a
  -- release is normally paid against -- so without the gate in
  -- `jobEndingBlocksPay` it would be the most payable a job ever gets. A row
  -- here is a payment made for work nobody did, which is the one mistake in
  -- this schema that a word cannot undo.
  || ',' || json_array('m066_inv_paid_on_ended', (SELECT COUNT(*) FROM wo_releases r
    JOIN work_orders w ON w.id = r.work_order_id
    WHERE r.status = 'paid'
      AND (SELECT e.kind FROM job_endings e WHERE e.job_id = w.job_id
            ORDER BY e.at DESC, e.rowid DESC LIMIT 1) IN ('cancelled', 'no_work')))
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
  || ',' || json_array('m066_inv_resume_without_hold', (SELECT COUNT(*) FROM job_endings r
    WHERE r.kind = 'resumed'
      AND COALESCE((SELECT e.kind FROM job_endings e
                     WHERE e.job_id = r.job_id
                       AND (e.at < r.at OR (e.at = r.at AND e.rowid < r.rowid))
                     ORDER BY e.at DESC, e.rowid DESC LIMIT 1), 'none') <> 'deferred'))
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
  || ',' || json_array('m067_inv_manager_unstamped', (SELECT COUNT(*) FROM visits v
    WHERE v.manager_at IS NULL
      AND v.status IN ('proposed', 'confirmed')
      AND v.proposed_by IS NOT NULL
      AND EXISTS (SELECT 1 FROM memberships m
                   WHERE m.user_id = v.proposed_by
                     AND m.account_id = v.account_id
                     AND m.role IN ('admin', 'pm'))))
  -- 068. A CONDITION RULE NAMING A STATUS THAT DOES NOT EXIST. It fires,
  -- matches the word, and sets nothing -- so the room lands `unchecked`
  -- exactly as it would have with no rule at all, and the screen shows a rule
  -- somebody set up and believes is working. The route validates against
  -- ROOM_STATUSES, so a row here is a route that stopped.
  || ',' || json_array('m068_inv_bad_status', (SELECT COUNT(*) FROM inspection_status_rules
    WHERE status NOT IN ('unchecked', 'ok', 'follow_up', 'fail')))
  -- 068. A PROVENANCE ROW AGAINST ANOTHER ACCOUNT'S INSPECTION. The id in a
  -- webhook body is a claim and the insert is what makes it true, so a row
  -- here is the retry key of one account pointing at another's walk -- which
  -- would make the second delivery hand back somebody else's inspection.
  || ',' || json_array('m068_inv_source_cross_account', (SELECT COUNT(*) FROM inspection_sources s
    JOIN inspections i ON i.id = s.inspection_id
    WHERE i.account_id <> s.account_id))
  -- 069. A WAIVER MARKED SIGNED WITH NOTHING BEHIND IT. Signing in the app
  -- writes the hash of the text shown; an upload writes the file and the hash
  -- of its bytes. A signed row with neither is a lien release nobody can
  -- produce -- the gate reads it as clear and money moves on it.
  || ',' || json_array('m069_inv_signed_unrecorded', (SELECT COUNT(*) FROM lien_waivers w
    JOIN waiver_forms f ON f.waiver_id = w.id
    WHERE w.status = 'signed' AND w.doc_sha256 IS NULL AND w.doc_key IS NULL))
  -- 069. SUBSUB'S OWN FORM SIGNED IN A STATUTORY STATE. Twelve states set the
  -- wording of a lien waiver in statute and a waiver on any other form can be
  -- void; the route offers only an upload there until a state's verbatim text
  -- is loaded. A row here is a waiver that may release nothing.
  || ',' || json_array('m069_inv_standard_in_statutory', (SELECT COUNT(*) FROM lien_waivers w
    JOIN waiver_forms f ON f.waiver_id = w.id
    WHERE f.source = 'subsub_standard' AND f.template_id = 'subsub_standard_waiver'
      AND w.governing_state IN ('AZ','CA','FL','GA','MA','MI','MS','MO','NV','TX','UT','WY')))
  -- Must read ZERO. A month marked billed with no Stripe line behind it is an
  -- account told it was charged for texts with nothing anywhere carrying the
  -- charge -- the sweep writes the reference in the same UPDATE as the status.
  || ',' || json_array('m070_inv_billed_unrecorded', (SELECT COUNT(*) FROM sms_overage
    WHERE status = 'billed' AND (processor_ref IS NULL OR processor_ref = '')))
  || ']'),
found(name, value) AS (
  SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]')
    FROM inv, json_each(inv.j)
)
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
FROM found
ORDER BY verdict = 'ok', name;
