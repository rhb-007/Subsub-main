-- 098. One appointment per company on a job, not one for the whole job.
--
-- A job with three trades held by two companies used to have ONE visit, and
-- every company with accepted work had to agree to that one window -- so a
-- roofer and a plumber had to come the same morning. Now a visit can belong to
-- one company (`company_id`), and each company's time is proposed, confirmed
-- and declined on its own. The tenant confirms each one.
--
-- NULL is a visit for the whole job: every row written before this, and a
-- time put forward before anybody was assigned. A company with no visit of its
-- own falls back to it, so nothing that already exists changes meaning.
--
-- Two pastes. The ALTER TABLE cannot be run twice, so paste it on its own and
-- once; the index after it can be run again. Until it is run, scheduling works
-- exactly as before (one time per job).
ALTER TABLE visits ADD COLUMN company_id TEXT;

CREATE INDEX IF NOT EXISTS ix_visits_job_company ON visits(job_id, company_id);
