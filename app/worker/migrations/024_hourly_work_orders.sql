-- Paying by the hour, with a ceiling.
--
-- A work order could only carry one number: a fixed price. That is the
-- wrong shape for the work nobody can price in advance -- a leak somebody
-- has to open a wall to find -- and the alternative was guessing a fixed
-- figure and re-issuing when it turned out wrong.
--
--   pay_kind    'fixed' (the existing behaviour, and the default for every
--               row already written) or 'hourly'.
--   rate_cents  the hourly rate, when pay_kind is 'hourly'.
--   cap_hours   the most hours that may be billed at it. Not optional: an
--               hourly rate with no ceiling is an open cheque, which is the
--               thing a work order exists to avoid.
--
-- value_cents stays what it always was and keeps meaning the most this work
-- order can cost -- rate x cap for an hourly one -- so every total, report
-- and spend figure already written against it goes on working untouched.
ALTER TABLE work_orders ADD COLUMN pay_kind TEXT NOT NULL DEFAULT 'fixed';
ALTER TABLE work_orders ADD COLUMN rate_cents INTEGER;
ALTER TABLE work_orders ADD COLUMN cap_hours REAL;
