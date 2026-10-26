// ONE APPOINTMENT PER COMPANY ON A JOB, NOT ONE FOR THE WHOLE JOB (098).
//
// Asked as *"if a job has 5 different work orders with multiple vendors, we
// need to schedule each of them individually, not one schedule for all work
// orders and all vendors"*. A job had one visit, and every company with
// accepted work had to agree to that one window, so a roofer and a plumber
// had to turn up the same morning.
//
// A visit now carries `companyId`. Each company's time is proposed, answered
// and confirmed on its own, and the tenant confirms each one. A visit with no
// company is one for the whole job: every row written before 098, and a time
// put forward before anybody was assigned. A company with no visit of its own
// falls back to it, so nothing that already existed changes meaning.
//
// Per COMPANY, not per trade: one company holding three trades on a job is one
// crew arriving once, and asking the tenant three times about it would be
// three confirmations for one van.
//
// The rules live here because the server, the hiring side's job card, the
// tenant's screen and the crew's card all have to agree about which visit is
// "the" visit for a company -- two readers choosing differently is a booked
// window on one screen and a missing one on another.

export const LIVE_VISIT = ["proposed", "confirmed"];

// Whose appointment a visit is. Reads both spellings: the browser holds
// `companyId`, the Worker passes raw rows with `company_id`.
export const visitCompany = (v) => (v?.companyId ?? v?.company_id) || null;

const created = (v) => String(v?.createdAt || v?.created_at || "");
const jobOf = (v) => v?.jobId || v?.job_id;

// Newest first. A visit list from the server is already in that order; this
// is for the ones built in the browser, where a fresh proposal is prepended.
export const newestFirst = (list) =>
  [...(list || [])].sort((a, b) => created(b).localeCompare(created(a)));

// THE VISIT THAT IS THIS COMPANY'S APPOINTMENT: its own newest one, else the
// newest one for the whole job. `live` narrows to proposed and confirmed; off,
// it is the newest that is not superseded, which is what a screen asking
// "what happened to it" (declined, missed, happened) wants.
export function appointmentFor(visits, jobId, companyId, { live = false } = {}) {
  const ok = (v) => jobOf(v) === jobId && v.status !== "superseded"
    && (!live || LIVE_VISIT.includes(v.status));
  const mine = companyId
    ? newestFirst((visits || []).filter((v) => ok(v) && visitCompany(v) === companyId))[0]
    : null;
  if (mine) return mine;
  return newestFirst((visits || []).filter((v) => ok(v) && !visitCompany(v)))[0] || null;
}

// The appointments on a job, one per company that holds work on it. With no
// company on the job there is one: the whole-job visit, if any.
//
// `companies` is the list of company ids holding live work (offered,
// accepted, or auto-scheduled; not declined). Order is kept, so the screen
// lists them in the order the trades are on the job.
export function jobAppointments(visits, jobId, companies = [], opts = {}) {
  const ids = [...new Set((companies || []).filter(Boolean))];
  if (!ids.length) return [{ companyId: null, visit: appointmentFor(visits, jobId, null, opts) }];
  return ids.map((id) => ({ companyId: id, visit: appointmentFor(visits, jobId, id, opts) }));
}

// IS THE JOB SCHEDULED? Only once EVERY company on it has a confirmed time.
// One crew booked and another still to agree is a job half arranged, and
// reading it as scheduled is the screen-that-lies rule on the dashboard.
export const jobFullyBooked = (appts) =>
  (appts || []).length > 0 && appts.every((a) => a.visit?.status === "confirmed");

// The newest non-superseded visit per company group on each job:
// `{ [jobId]: [visit, ...] }`. Read by the dashboards, which ask a question of
// every appointment ("is any of these waiting on me") rather than of one.
export function latestPerCompany(visits) {
  const out = {};
  const seen = new Set();
  for (const v of newestFirst(visits)) {
    if (v.status === "superseded") continue;
    const key = `${jobOf(v)}|${visitCompany(v) || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    (out[jobOf(v)] ||= []).push(v);
  }
  return out;
}

// ONE VISIT TO STAND FOR THE JOB, for the readers that draw a single line
// (the schedule panel, the tenant list). The one that most needs somebody:
// a proposal before a refusal before a booking, and among equals the earliest
// date, because that is the next thing that happens.
const PRESS = { proposed: 0, declined: 1, confirmed: 2 };
export function pressingVisit(list) {
  return [...(list || [])].sort((a, b) =>
    ((PRESS[a.status] ?? 3) - (PRESS[b.status] ?? 3))
    || String(a.date || "").localeCompare(String(b.date || "")))[0] || null;
}

// The earliest confirmed date across a job's appointments, which is what
// `jobs.date` carries once anything is booked: the next time somebody is due.
export function earliestBooked(visits) {
  return (visits || []).filter((v) => v.status === "confirmed" && v.date)
    .sort((a, b) => String(a.date).localeCompare(String(b.date))
      || String(a.startTime || a.start_time || "").localeCompare(String(b.startTime || b.start_time || "")))[0] || null;
}
