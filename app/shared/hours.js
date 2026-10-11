// Hours on an hourly work order: what the subcontractor says they worked, what
// the hiring side approves, and asking for more than was estimated.
//
// THE RATE TIMES THE CAP WAS THE PAY, which is the bug this module exists to
// end. 024 stored a rate and a ceiling and nothing else, so an hourly job was
// paid as though every estimated hour had been used, and the only place the
// real number could go was a free-text note nothing read.
//
// So a SUBMISSION is the unit: one or more days, each with a number of hours,
// sent together when the sub says that stretch of work is done. It is stored
// as a milestone (what gets verified, released and paid -- one path for money,
// not two) plus one entry row per day (what the hours were). Approving it is
// the existing verify; sending it back is the existing reject, reason and all.
//
// THE ESTIMATE IS A CEILING ON WHAT IS APPROVED, NOT ON WHAT HAPPENED. A job
// that runs over is the commonest thing in the trade, so going over is a
// question the sub asks -- "6 more hours, found rot behind the wall" -- and
// the hiring side answers. The ceiling is DERIVED (the work order's own hours
// plus every approved extra), never written back onto the work order: a work
// order is not edited once accepted, and two records of one ceiling would
// disagree the first time somebody changed one.
//
// Used by the Worker and the browser, so the screen cannot offer a submission
// the route refuses.

// QUARTER HOURS, and the reason is arithmetic rather than taste. A quarter is
// exactly representable in binary, so a day's hours, a week's total and the
// amount (hours x rate in cents) come out the same in JavaScript, in SQLite
// and on the invariant that checks them against each other. 0.1 of an hour is
// not, and a sum of tenths that rounds differently in two places is an amount
// paid that the record cannot reproduce. Fifteen minutes is also how most
// people already round a timesheet.
export const HOUR_STEP = 0.25;
export const MAX_DAY_HOURS = 24;
export const MAX_ENTRIES = 31;      // a month of days in one submission
export const MAX_EXTRA_HOURS = 500; // one request; a typo, not a job

const DAY = /^\d{4}-\d{2}-\d{2}$/;

// A real calendar date, not merely the right shape -- 2026-02-31 is the shape.
export function isDay(s) {
  if (typeof s !== "string" || !DAY.test(s)) return false;
  const d = new Date(`${s}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export const onStep = (h) => Number.isFinite(h) && Math.abs(h / HOUR_STEP - Math.round(h / HOUR_STEP)) < 1e-9;

// Hours as somebody typed them: "7.5", "7,5", " 8 ". A number that is not a
// quarter is refused rather than rounded -- rounding would pay for time nobody
// claimed, or not pay for time they did.
export function parseHours(v) {
  const n = Number(String(v ?? "").replace(",", ".").trim());
  return Number.isFinite(n) ? n : NaN;
}

// The day after `today` is allowed because a crew working late on the West
// Coast is already on tomorrow in UTC; anything past that is a date nobody has
// worked yet.
const addDays = (day, n) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// Check what a sub is about to send, and say what is wrong with the first bad
// row by its position, so the screen can point at it.
export function checkEntries(entries, { today } = {}) {
  if (!Array.isArray(entries) || !entries.length) return { error: "no_hours" };
  if (entries.length > MAX_ENTRIES) return { error: "too_many_days", max: MAX_ENTRIES };
  const seen = new Set();
  const clean = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i] || {};
    const date = String(e.date || "").trim();
    if (!isDay(date)) return { error: "bad_date", index: i };
    if (today && date > addDays(today, 1)) return { error: "future_date", index: i };
    // One row per day in one submission: two rows for the 3rd is a typo far
    // more often than a split shift, and a split shift is one row of 9 hours.
    if (seen.has(date)) return { error: "duplicate_day", index: i, date };
    seen.add(date);
    const hours = parseHours(e.hours);
    if (!(hours > 0)) return { error: "bad_hours", index: i };
    if (hours > MAX_DAY_HOURS) return { error: "too_many_hours", index: i };
    if (!onStep(hours)) return { error: "quarter_hours", index: i };
    clean.push({ date, hours, note: String(e.note || "").trim().slice(0, 300) || null });
  }
  clean.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { entries: clean, hours: totalHours(clean) };
}

export const totalHours = (entries = []) =>
  entries.reduce((n, e) => n + (Number(e.hours) || 0), 0);

// What a number of hours is worth. Whole cents, rounded once, from the total
// -- never per day and summed, which drifts a cent per row.
export const hoursAmountCents = (hours, rateCents) =>
  Math.round((Number(hours) || 0) * (Number(rateCents) || 0));

// The ceiling: the work order's own estimate plus every extra the hiring side
// approved. Declined, pending and withdrawn requests count for nothing.
export function ceilingHours(capHours, requests = []) {
  const extra = requests
    .filter((r) => r.status === "approved")
    .reduce((n, r) => n + (Number(r.hours) || 0), 0);
  return (Number(capHours) || 0) + extra;
}

// Hours already spoken for: every submission that has not been sent back.
// A submission waiting on approval counts, because approving it is the next
// thing that happens and a second one sent meanwhile must not squeeze past
// the ceiling on the strength of the first not having been answered yet.
export function hoursUsed(submissions = [], { except = null } = {}) {
  return submissions
    .filter((s) => s.status !== "rejected" && s.id !== except)
    .reduce((n, s) => n + (Number(s.hours) || 0), 0);
}

export const hoursApproved = (submissions = []) =>
  submissions.filter((s) => s.status === "verified").reduce((n, s) => n + (Number(s.hours) || 0), 0);

// The whole picture, one function, so the strip on the screen and the refusal
// from the route are the same arithmetic.
export function hoursPicture({ capHours, rateCents, submissions = [], requests = [] }) {
  const ceiling = ceilingHours(capHours, requests);
  const used = hoursUsed(submissions);
  const approved = hoursApproved(submissions);
  const extra = ceiling - (Number(capHours) || 0);
  return {
    estimateHours: Number(capHours) || 0,
    extraHours: extra,
    ceilingHours: ceiling,
    usedHours: used,
    approvedHours: approved,
    waitingHours: used - approved,
    remainingHours: Math.max(0, ceiling - used),
    overBy: Math.max(0, used - ceiling),
    ceilingCents: hoursAmountCents(ceiling, rateCents),
    approvedCents: hoursAmountCents(approved, rateCents),
    pendingRequest: requests.find((r) => r.status === "pending") || null,
  };
}

// Can this submission go? Over the ceiling is not refused as wrong -- the work
// may well have taken that long -- it is refused as NOT YET AGREED, with the
// exact number to ask for, so the screen can offer the request in one press.
export function submitRefusal({ hours, capHours, submissions = [], requests = [], replacing = null }) {
  const ceiling = ceilingHours(capHours, requests);
  const used = hoursUsed(submissions, { except: replacing });
  if (used + hours > ceiling + 1e-9) {
    return {
      error: "over_estimate",
      ceilingHours: ceiling,
      remainingHours: Math.max(0, ceiling - used),
      overBy: used + hours - ceiling,
    };
  }
  return null;
}

// Asking for more. One open question at a time: two pending requests is two
// numbers the hiring side has to add up, and the second is nearly always the
// first one retyped.
export function requestRefusal({ hours, reason, requests = [] }) {
  const h = parseHours(hours);
  if (!(h > 0)) return { error: "bad_hours" };
  if (!onStep(h)) return { error: "quarter_hours" };
  if (h > MAX_EXTRA_HOURS) return { error: "too_many_hours" };
  if (!String(reason || "").trim()) return { error: "reason_required" };
  if (requests.some((r) => r.status === "pending")) return { error: "already_pending" };
  return null;
}

// "7.5 h", "1 h", "0.25 h". No trailing zeros, because "8.00 h" on a
// timesheet reads as a number somebody computed rather than worked.
export function fmtHours(h) {
  const n = Number(h) || 0;
  const s = Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
  return `${s} h`;
}

// Words for each refusal, in one place, so the form and the request panel say
// the same thing about the same code.
export const HOURS_ERRORS = {
  no_hours: "Add at least one day with the hours worked.",
  too_many_days: `Up to ${MAX_ENTRIES} days in one go — send the rest separately.`,
  bad_date: "One of the dates isn't a real date.",
  future_date: "One of the dates hasn't happened yet.",
  duplicate_day: "The same day is in there twice — put that day's hours on one line.",
  bad_hours: "Each day needs a number of hours above zero.",
  too_many_hours: "That's more hours than there are in a day.",
  quarter_hours: "Hours go in quarter hours: 7, 7.25, 7.5 or 7.75.",
  over_estimate: "That's more than the approved hours. Ask for more hours first.",
  already_pending: "You've already asked for more hours. Wait for the answer first.",
  reason_required: "Say why it needs more hours — it's the first thing they'll ask.",
  not_hourly: "This work order is a fixed price, not hourly.",
  not_accepted: "Accept the work order before logging hours on it.",
  drawn_plan: "This work order was split into draws before hours were tracked, so it's paid by the draws.",
  not_yours_to_mark: "Only the contractor doing the work can log hours on it.",
  not_editable: "That one's already approved, so it can't be changed.",
  job_closed: "This job is closed.",
};
export const hoursErrText = (e) => {
  const code = e?.body?.error || e?.error;
  if (code === "over_estimate" && e?.body?.remainingHours != null) {
    return `That's ${fmtHours(e.body.overBy)} over the approved hours (${fmtHours(e.body.remainingHours)} left). Ask for more hours first.`;
  }
  if (code === "migration_needed") return `The database isn't migrated yet — run ${e.body.migration || "078_wo_hours"}.sql and reload.`;
  return HOURS_ERRORS[code] || (e?.status ? `That didn't go through (${code || e.status}).` : "No connection. Check your signal and try again.");
};
