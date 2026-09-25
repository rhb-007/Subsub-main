-- Every day a crew is marked off, listed so it can be looked at.
--
-- Not a migration. This is here because of the timezone bug in the
-- availability calendar: the square a contractor tapped PRINTED the local
-- date and STORED the UTC one, so west of Greenwich, from about five in the
-- afternoon, tapping the 23rd marked the 24th off.
--
-- The code is fixed. The rows already written cannot be: whether any one of
-- them is a day out depends on what time of day it was tapped, and nothing
-- was recorded about that. Moving them all back a day would be as wrong as
-- leaving them, and wrong in a way nobody could see.
--
-- So: this lists them all, with whose they are, to be checked by eye. There
-- should not be many, and a contractor knows their own days off.
--
--   npx wrangler d1 execute subsub-db --config=wrangler.toml \
--     --file=./worker/migrations/OFFDAYS.sql --remote
--
-- Read-only. Safe to run whenever.
SELECT
  co.company                                   AS company,
  json_extract(crew.value, '$.name')           AS crew,
  d.value                                      AS marked_off,
  CASE WHEN d.value < date('now') THEN 'past' ELSE 'still ahead' END AS when_,
  co.id                                        AS company_id
FROM companies co
JOIN json_each(co.crews) AS crew
JOIN json_each(json_extract(crew.value, '$.unavailableDays')) AS d
ORDER BY (d.value >= date('now')) DESC, d.value, co.company;

-- And the older contractor-level list, which predates crews. Usually empty.
SELECT
  co.company        AS company,
  '(whole company)' AS crew,
  d.value           AS marked_off,
  co.id             AS company_id
FROM companies co
JOIN json_each(co.unavailable_days) AS d
ORDER BY d.value, co.company;
