-- 067. THE HIRING SIDE'S AGREEMENT ON WINDOWS PROPOSED BEFORE 064 EXISTED.
--
-- Reported from a property manager's own Jobs screen: *"Proposed Oct 16, 2026
-- · 9 AM–10 AM — waiting on the contractor and the hiring side to confirm"*,
-- on a job they had proposed the time for themselves, with no button anywhere
-- to answer it. They are being told they are waiting on themselves.
--
-- NOTHING IS WRONG WITH THE SCREEN. 064's rule is *proposing is agreeing, for
-- whoever proposed it*, and the propose route has stamped `manager_at` since
-- the day it shipped. These are rows written BEFORE that: under 061 a manager
-- proposing stamped nothing at all, because the hiring side had no leg. So
-- `manager_at` is NULL on them, 064 counts the hiring side as a party who has
-- not answered, and the chain waits on somebody who agreed weeks ago.
--
-- And it cannot resolve itself. The chain asks the crew FIRST, so until the
-- contractor answers it is not the manager's turn and no button is drawn --
-- the appointment sits there with both sides apparently outstanding and no
-- way for either to be wrong about it.
--
-- `proposed_by` IS THE RECORD, so this is not a guess about history. The
-- column has said who put the window forward since 019; joining it to their
-- seat says whether that was the hiring side. Setting `manager_at` to the row's
-- own `created_at` is exactly what the route would have written had the column
-- existed: the moment they proposed it.
--
-- SCOPED THREE WAYS, because a backfill that reaches one row too far is worse
-- than one that reaches none:
--
--   LIVE WINDOWS ONLY. A superseded, declined, missed or happened visit is
--   finished business and nothing reads its legs.
--
--   `manager_at IS NULL` only, so a row the route already stamped is untouched
--   and running this file twice does nothing.
--
--   AND THE PROPOSER MUST HOLD A HIRING-SIDE SEAT ON THAT ACCOUNT. A window a
--   CONTRACTOR proposed is their agreement, not the manager's -- those rows
--   stamp `contractor_at` and must go on waiting for the hiring side, which is
--   the whole of what 064 added. The membership is matched on the visit's own
--   `account_id`, never globally: the same person can be an admin of one
--   account and a contractor seat on another.
--
-- `status` IS DELIBERATELY NOT TOUCHED, and that is safe rather than an
-- omission. The rows this matches had NO leg stamped at all -- under 061 a
-- manager proposing recorded nothing -- so the contractor is still outstanding
-- on every one of them and `proposed` remains the correct verdict. A row where
-- the contractor HAD answered was proposed by the contractor, which this
-- WHERE clause excludes.

UPDATE visits
   SET manager_at = COALESCE(created_at, datetime('now'))
 WHERE manager_at IS NULL
   AND status IN ('proposed', 'confirmed')
   AND proposed_by IS NOT NULL
   AND EXISTS (
     SELECT 1 FROM memberships m
      WHERE m.user_id = visits.proposed_by
        AND m.account_id = visits.account_id
        AND m.role IN ('admin', 'pm'));
