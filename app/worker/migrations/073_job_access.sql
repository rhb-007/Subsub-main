-- 073. HOW THE CREW GETS IN, said in words: "meet at the front door", "the
-- garage door will be open", "key in the lockbox". 060 records WHO lets them
-- in; this is the sentence the two people at the door actually need.
--
-- Its own table rather than a column on jobs, for the reason 048, 057 and 063
-- give: ALTER TABLE ... ADD COLUMN cannot be run twice, so this paste can.
-- One row per job; the latest answer wins, and who wrote it is kept because
-- "the tenant said the side gate" and "the office said the side gate" are
-- different things to have been told.

CREATE TABLE IF NOT EXISTS job_access (
  job_id      TEXT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
  how         TEXT,
  updated_by  TEXT,
  updated_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
