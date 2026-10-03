-- 061. The contractor's half of an appointment.
--
-- 019 built a visit as a two-party thing: the manager proposes a window and
-- the TENANT confirms it, because somebody has to be in. The party who
-- physically drives to the address was never asked -- so a time could be
-- agreed between a manager and a tenant for a morning the crew was already on
-- another roof, and the first anybody found out was nobody turning up.
--
-- Reported as: *"we need to allow it to be edited and [a] new time [proposed]
-- by [the] subcontractor, or the other way -- the property manager needs to
-- send it to [the] subcontractor and tenant, or just [the] subcontractor, to
-- be confirmed."*
--
-- The "or just the subcontractor" half is already answered by 060: who has to
-- be IN decides whether the tenant is asked at all. What was missing is the
-- subcontractor leg, in both directions -- they could neither accept a time
-- nor say it does not work.
--
-- So a visit now carries each side's answer separately and `status` is the
-- COMBINED verdict: proposed while anybody who must agree has not, confirmed
-- once everybody who must has. The rules are in app/shared/visitparty.js, in
-- one place, so the two sides cannot both draw "waiting on them" and stall
-- forever -- the same reason `waitingOn` is one function for an agreement.
--
-- `responded_at` and `tenant_note` stay the TENANT's, which is what they have
-- always been. Giving them a second meaning would make every row written
-- before today ambiguous about who it was that answered.
--
-- NULL means not answered, and on every existing row that is exactly right:
-- nobody ever asked the contractor, so nobody ever answered. No backfill.
--
-- TWO `ALTER TABLE ... ADD COLUMN` statements, which is the one statement that
-- cannot be run twice -- so they are one paste EACH. Run the first, then the
-- second. If either answers "duplicate column name", it has already been run
-- and there is nothing to do.

ALTER TABLE visits ADD COLUMN contractor_at TEXT;

-- (second paste)
ALTER TABLE visits ADD COLUMN contractor_note TEXT;
