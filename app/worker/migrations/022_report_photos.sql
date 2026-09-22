-- Photos on a report, and the report's own answers kept apart from the prose.
--
-- `photos` is a JSON array of { id, key, name, type, size, at }; the files
-- themselves live in R2 and only ever come back through a route that
-- re-checks who is asking. Same shape jobs already uses for measurement_docs.
--
-- `report_detail` is the other half of the same problem. What a tenant
-- answers -- what it is, when it started, which unit, their own words -- was
-- composed into one `scope` sentence at submit time and the parts thrown
-- away. That is the right text for the person doing the work and the wrong
-- shape for everything else: the tenant could not see what they had said,
-- and editing could only offer a title and a blob. The parts are kept here
-- as JSON { problem, started, words, unit } and `scope` is composed from
-- them, so it stays exactly what a contractor reads.
ALTER TABLE jobs ADD COLUMN photos TEXT;
ALTER TABLE jobs ADD COLUMN report_detail TEXT;
