// HOW LONG EACH TRADE TAKES, AND THEREFORE HOW LONG THE JOB TAKES.
//
// Asked for as *"right now we have just a start ... it's just showing start
// dates for everything. I think we need to have a start/end date estimate so
// that the calendar can be more of a Gantt chart with beginning and ending
// estimates for each job."* A three-week remodel and a tap washer were both a
// dot on one day, and the auto-scheduler could book a crew onto day two of a
// job they were already in the middle of.
//
// THE ESTIMATE LIVES ON THE TRADE, NOT THE JOB. A job with demo, plumbing and
// paint runs them in order, and one start and one end for the whole job would
// show every trade busy for every day of it -- overstating who is busy when,
// which is the opposite of what a schedule is for. So each trade carries a
// start and a length in WORKING days, and the job's span is DERIVED from them:
// earliest start to latest finish. Derived rather than stored, because a job
// span beside its trade spans is two records of one fact.
//
// THE LENGTH IS IN WORKING DAYS AND THE FINISH IS COMPUTED, NEVER TYPED.
// "Five days" from a Thursday means the following Wednesday, which is what a
// crew means when they say it. Weekends are skipped unless the estimate says
// the crew works them, and so are the days the crew holding the work has
// marked themselves off -- a holiday in the middle of a job pushes its end,
// it does not shorten the work.
//
// AND IT IS AN ESTIMATE, said as one. A visit is still the appointment -- the
// agreed day and time somebody turns up -- and lives inside the span. The span
// is what the timeline draws and what the auto-scheduler treats as busy.

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MS = 86400000;
export const MAX_SPAN_DAYS = 365;
// A year of calendar days is far past any job and is the guard against a crew
// that has marked every working day off for ever.
const WALK_LIMIT = 800;

export const isDayKey = (s) => DAY_RE.test(String(s || "")) && !Number.isNaN(parse(s).getTime())
  && iso(parse(s)) === String(s);
const parse = (s) => new Date(`${String(s).slice(0, 10)}T00:00:00Z`);
const iso = (d) => d.toISOString().slice(0, 10);
export const addDays = (key, n) => iso(new Date(parse(key).getTime() + n * MS));
const weekend = (key) => { const g = parse(key).getUTCDay(); return g === 0 || g === 6; };

// The number a person types, as a whole count of working days, or null when it
// is not one. Fractions are refused rather than rounded: half a day is a
// visit, not a span, and rounding would quietly add or drop a day of somebody's
// diary.
export function spanDaysFrom(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > MAX_SPAN_DAYS) return null;
  return n;
}

// THE WORKING DAYS A SPAN COVERS, in order. The first is the first day work
// can actually happen on or after `start`: a start typed on a Saturday with
// weekends off begins on Monday, which is what would happen on site.
export function spanDates({ start, days, weekends = false, off = [] } = {}) {
  const n = spanDaysFrom(days);
  if (!isDayKey(start) || !n) return [];
  const skip = new Set((off || []).filter((d) => DAY_RE.test(String(d))));
  const out = [];
  let k = String(start);
  for (let i = 0; i < WALK_LIMIT && out.length < n; i += 1) {
    if ((weekends || !weekend(k)) && !skip.has(k)) out.push(k);
    k = addDays(k, 1);
  }
  return out;
}

// The finish, or null when there is no estimate to finish.
export function spanEnd(span) {
  const d = spanDates(span);
  return d.length ? d[d.length - 1] : null;
}

// ONE TRADE'S SPAN AS EVERY SCREEN READS IT. `start` is what was typed and
// `end` the computed finish; `first` is the first day work happens, which can
// be later than `start` when the start falls on a day off. The proposal rides
// along when the crew has suggested different figures.
export function spanView(row, { off = [] } = {}) {
  if (!row) return null;
  const start = row.start_date ?? row.start;
  const days = spanDaysFrom(row.work_days ?? row.days);
  const weekends = !!(row.weekends);
  if (!isDayKey(start) || !days) return null;
  const dates = spanDates({ start, days, weekends, off });
  const pDays = spanDaysFrom(row.proposed_days ?? row.proposal?.days);
  const pStart = row.proposed_start ?? row.proposal?.start;
  const proposal = pDays && isDayKey(pStart) ? {
    start: pStart, days: pDays,
    end: spanEnd({ start: pStart, days: pDays, weekends, off }),
    note: row.proposed_note ?? row.proposal?.note ?? null,
    by: row.proposed_by_name ?? row.proposal?.by ?? null,
    at: row.proposed_at ?? row.proposal?.at ?? null,
  } : null;
  return {
    start, days, weekends,
    first: dates[0] || start,
    end: dates[dates.length - 1] || start,
    ...(proposal ? { proposal } : {}),
  };
}

// THE JOB'S SPAN, rolled up from its trades. Null when no trade has an
// estimate, so a screen can tell "nobody has said how long" from a one-day job.
export function jobSpan(spans = {}, trades = null) {
  const list = Object.entries(spans || {})
    .filter(([t, s]) => s && s.start && s.end && (!trades || trades.includes(t)))
    .map(([, s]) => s);
  if (!list.length) return null;
  const start = list.map((s) => s.start).sort()[0];
  const end = list.map((s) => s.end).sort().slice(-1)[0];
  const calendarDays = Math.round((parse(end) - parse(start)) / MS) + 1;
  return { start, end, calendarDays, trades: list.length };
}

// WHAT A REQUEST MAY STORE. One shape, read by the route and by the form, so
// the screen cannot offer a figure the server refuses. Returns
// { span } or { error } -- a refusal is named, because "that didn't save" over
// a 400 day estimate says nothing about which box is wrong.
export function validSpan(b) {
  if (!b || typeof b !== "object") return { error: "bad_span" };
  const start = String(b.start || "").slice(0, 10);
  if (!isDayKey(start)) return { error: "bad_span_start" };
  const days = spanDaysFrom(b.days);
  if (!days) return { error: "bad_span_days" };
  return { span: { start, days, weekends: b.weekends === true || b.weekends === 1 } };
}

// THE DAYS A COMPANY IS ALREADY ON SITE, from the spans of the work it holds.
// What the auto-scheduler reads as busy alongside the visits: a crew five days
// into a seven-day job is not free on day six because nobody booked a visit
// for it.
export function busyFromSpans(rows = [], { off = [] } = {}) {
  const out = new Set();
  for (const r of rows || []) {
    for (const d of spanDates({ start: r.start_date ?? r.start, days: r.work_days ?? r.days,
      weekends: !!r.weekends, off })) out.add(d);
  }
  return [...out].sort();
}

// THE FIGURES IN WORDS, for a trade row, a line and a work order. "Oct 14 –
// Oct 18 · 5 working days" -- the year only when it is not the current one,
// the rule the compliance pack's date column already follows. The formatter is
// the caller's, because the Worker answers in UTC and the browser in the
// reader's own zone; this decides only the shape.
export function spanText(s, fmt = (k) => k) {
  if (!s || !s.start) return "";
  const n = s.days;
  const unit = s.weekends ? (n === 1 ? "day" : "days") : (n === 1 ? "working day" : "working days");
  const range = s.first === s.end ? fmt(s.first) : `${fmt(s.first)} – ${fmt(s.end)}`;
  return `${range} · ${n} ${unit}`;
}
