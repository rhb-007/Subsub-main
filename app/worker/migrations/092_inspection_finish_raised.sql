-- 092. Finish the inspections whose job is already raised.
--
-- Raising the job from an inspection now finishes the walk when every room
-- has an answer (see POST /api/inspections/:id/job). Walks raised before that
-- stayed Draft for ever, because finishing was a separate press nobody came
-- back to make once the work was out. This finishes those, by the same rule:
-- a job raised, at least one room, and no room left unchecked.
--
-- A walk somebody REOPENED is left alone: reopening is a deliberate act with
-- a reason on the record, and it goes back to a draft on purpose until they
-- finish it again.
--
-- One statement, safe to run twice: a finished row no longer matches.
UPDATE inspections
   SET status = 'finished', finished_at = CURRENT_TIMESTAMP
 WHERE status = 'draft'
   AND job_id IS NOT NULL
   AND EXISTS (SELECT 1 FROM inspection_rooms r WHERE r.inspection_id = inspections.id)
   AND NOT EXISTS (SELECT 1 FROM inspection_rooms r
                    WHERE r.inspection_id = inspections.id AND r.status = 'unchecked')
   AND NOT EXISTS (SELECT 1 FROM events e
                    WHERE e.kind = 'inspection.reopened' AND e.subject_id = inspections.id);
