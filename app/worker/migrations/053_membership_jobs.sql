-- 053. A project manager scoped to named jobs.
--
-- Seat scoping already existed and did nothing for a general contractor:
-- membership_properties narrows a property manager to named buildings, and a
-- general contractor has no buildings at all (ACCOUNT_KINDS.properties is
-- false). So the one account kind whose pm seat is called a PROJECT manager
-- had nothing to be scoped by. The unit of work there is the job.
--
-- Same shape as membership_properties, deliberately, down to the cascade: a
-- seat that goes takes its list with it, and so does a job that is deleted.
--
-- NO ROWS MEANS NO RESTRICTION, which is what makes this safe to run against
-- a live database. Every existing pm seat has no rows here and therefore sees
-- everything, exactly as it did before this table existed.
--
-- One paste. Every statement is IF NOT EXISTS and there is no ALTER TABLE, so
-- running the file twice does nothing.
CREATE TABLE IF NOT EXISTS membership_jobs (
  membership_id TEXT NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
  job_id        TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  PRIMARY KEY (membership_id, job_id)
);
CREATE INDEX IF NOT EXISTS idx_mj_membership ON membership_jobs(membership_id);
CREATE INDEX IF NOT EXISTS idx_mj_job ON membership_jobs(job_id);
