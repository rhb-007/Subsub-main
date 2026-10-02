-- 054. Scope rows that belong to a role the seat no longer holds.
--
-- WHAT WENT WRONG. `PATCH /api/platform/accounts/:id/users/:userId` -- the
-- console's role control -- wrote `memberships.role` and nothing else. The
-- customer-side route has always gone through `setMembershipProperties` and
-- `setMembershipJobs`, which delete first and write back only for a role that
-- may carry a list; the console's did not. So promoting a project manager
-- scoped to named buildings left their buildings behind on an admin seat.
--
-- The Worker ignores them: `propertyScope` answers null for anything but a
-- pm, an owner or a tenant, so nothing was ever wrongly refused. But
-- `GET /api/account-users` hands the stored rows to the browser so the user
-- form can draw the picker, and `isScoped` there read the list without asking
-- about the role -- so `runsTheAccount` shut the whole account down around an
-- admin the API would let do anything. Reported as a property manager's own
-- building opening with no vendor list, no Edit, no Remove and no owners
-- panel, under a header reading "Your buildings".
--
-- Both halves are fixed in code: shared/propscope.js is now the one rule,
-- imported by the Worker and the browser, and the console's route carries the
-- scopes with the role. This clears what the old one already left.
--
-- Safe to run twice, and safe to run on a database that never had the
-- problem: it deletes only rows whose seat cannot carry them, which is a
-- shape nothing reads in either direction.
--
-- There is no ALTER TABLE here, so this is one paste.

DELETE FROM membership_properties
 WHERE membership_id IN (
   SELECT id FROM memberships WHERE role NOT IN ('pm', 'owner', 'tenant')
 );

-- The same one axis over. Only a project manager is narrowed by job --
-- shared/jobscope.js -- and 053's own invariant has counted this shape since
-- it shipped; this is the first thing that clears it.
DELETE FROM membership_jobs
 WHERE membership_id IN (
   SELECT id FROM memberships WHERE role <> 'pm'
 );
