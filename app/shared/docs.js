// Whether a document is current, and how long that stays true.
//
// "Compliant" used to mean a file exists. That is the wrong question: an
// expired certificate of insurance that still reads as approved is worse
// than a missing one, because a missing one makes somebody ask and an
// expired one makes everybody stop asking.
//
// Two things here are load-bearing and both are easy to get wrong.
//
// NULL IS NOT UNKNOWN. A W-9 and a signed contract do not expire. If a
// missing date meant "we don't know", two thirds of every roster would sit
// permanently amber and people would learn to ignore the colour, which is
// the failure this whole feature exists to prevent. So NULL means does not
// expire, and the kinds that genuinely do are named.
//
// THE DATE THAT MATTERS IS THE JOB'S, NOT TODAY'S. A certificate current
// today and expiring Friday does not cover a job booked for the following
// Tuesday, and the moment to say so is when somebody is assigning it.
//
// ISO day strings compare correctly as strings. No Date arithmetic, no
// timezone, no midnight-in-another-zone bug.

export const DOC_KINDS = ["insurance", "bond", "contract", "w9"];
// The ones with a shelf life. A contract and a W-9 are signed once.
export const EXPIRING_KINDS = ["insurance", "bond"];
// How close counts as close. Thirty days is a renewal cycle; three is a
// phone call.
export const WARN_DAYS = 30;
export const CHASE_AT = [30, 14, 3, 0];

const day = (d) => String(d || "").slice(0, 10);
export const addDaysIso = (iso, n) => {
  const t = Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) + n * 86400000;
  return new Date(t).toISOString().slice(0, 10);
};
export const daysBetween = (from, to) =>
  Math.round((Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10))
    - Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10))) / 86400000);

// One document, as of a date.
//
//   missing   no file at all
//   current   in force, with room
//   expiring  in force, and not for long
//   expired   not in force
//
// `asOf` is whatever date the question is being asked about -- today for a
// roster, the job's date when somebody is assigning it.
export function docStatus(doc, asOf) {
  const on = day(asOf);
  if (!doc || !doc.fileName) return { state: "missing", days: null };
  if (!doc.expiresOn) return { state: "current", days: null, neverExpires: true };
  const until = day(doc.expiresOn);
  const days = daysBetween(on, until);
  if (days < 0) return { state: "expired", days, until };
  if (days <= WARN_DAYS) return { state: "expiring", days, until };
  return { state: "current", days, until };
}

// A company's whole paperwork position, as of a date.
//
// `docs` is the current document per kind, keyed by kind.
export function companyDocStatus(docs = {}, asOf, kinds = DOC_KINDS) {
  const per = {};
  for (const k of kinds) per[k] = docStatus(docs[k], asOf);
  const states = Object.values(per).map((p) => p.state);
  // Worst wins. A roster that says "fine" because three of four are fine is
  // a roster nobody can act on.
  const worst = states.includes("missing") ? "missing"
    : states.includes("expired") ? "expired"
    : states.includes("expiring") ? "expiring"
    : "current";
  const soonest = Object.values(per)
    .filter((p) => p.until).map((p) => p.until).sort()[0] || null;
  return {
    state: worst,
    ok: worst === "current",
    // Good enough to be assigned work: nothing missing and nothing lapsed.
    // Expiring is a warning, not a bar -- refusing to book somebody whose
    // certificate runs out in three weeks would stop a business working.
    assignable: worst !== "missing" && worst !== "expired",
    per,
    soonest,
    problems: kinds.filter((k) => per[k].state !== "current"),
  };
}

// Is this company good for a job on this date?
//
// Asked with the JOB'S date, which is the whole point. A certificate that
// lapses the day before the work is not cover, and today's roster colour
// will not tell anybody that.
export function coversJob(docs, jobDate, kinds = DOC_KINDS) {
  const s = companyDocStatus(docs, jobDate, kinds);
  return {
    ok: s.assignable,
    state: s.state,
    problems: s.problems,
    // Which of them actually lapse before the job, so the warning can name
    // them rather than saying "documents".
    lapsing: kinds.filter((k) => {
      const d = docs?.[k];
      return d?.expiresOn && day(d.expiresOn) < day(jobDate);
    }),
  };
}

// Which chase is due for a document, given what has already been sent.
//
// Returns the milestone to send now, or null. -1 is the urgent one: a
// certificate that has lapsed while a job is already booked. That job is
// NOT blocked -- stranding scheduled work over paperwork helps nobody --
// but it is chased harder than a routine renewal.
export function dueReminder({ doc, asOf, alreadySent = [], hasBookedWork = false }) {
  if (!doc?.expiresOn) return null;
  const days = daysBetween(day(asOf), day(doc.expiresOn));
  if (days < 0) {
    if (!hasBookedWork) return alreadySent.includes(0) ? null : 0;
    return alreadySent.includes(-1) ? null : -1;
  }
  // The closest milestone this has passed and not yet been chased at.
  const due = CHASE_AT.filter((d) => days <= d).sort((a, b) => a - b)[0];
  if (due === undefined) return null;
  return alreadySent.includes(due) ? null : due;
}

export function docStatusText(kind, s) {
  const name = { insurance: "Insurance", bond: "Bond", contract: "Contract", w9: "W-9" }[kind] || kind;
  if (s.state === "missing") return `${name} has not been uploaded.`;
  if (s.state === "expired") return `${name} expired ${Math.abs(s.days)} day${Math.abs(s.days) === 1 ? "" : "s"} ago.`;
  if (s.state === "expiring") {
    return s.days === 0 ? `${name} expires today.`
      : `${name} expires in ${s.days} day${s.days === 1 ? "" : "s"}.`;
  }
  return s.neverExpires ? `${name} is on file.` : `${name} is current.`;
}
