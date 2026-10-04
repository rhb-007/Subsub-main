// WHEN IS THIS WORK, in one place, because three screens were answering it
// from different columns and one of them was answering it with nothing.
//
// Reported as *"the proposed date of the job never made it to pacific
// apartment maintenance… it's just the job without [a date] attached to it
// that pacific is asked to accept or decline"*. A manager proposed
// Oct 4, 11am–1:15pm on the job; the contractor's own portal read **No date**
// on the card they were being asked to accept.
//
// THERE ARE TWO PLACES A TIME CAN LIVE AND THE CONTRACTOR COULD SEE ONLY ONE.
// `jobs.date` is the target date somebody typed on the job. A row in `visits`
// is the actual appointment -- proposed by the manager or the contractor, and
// confirmed by the tenant, because somebody has to be in. 019 built that as a
// manager-to-tenant conversation and `/api/my-work` never joined it, so the
// one party who physically turns up was the only party not told when.
//
// So this module decides WHICH of the two a row means and WHAT it means, and
// the screens format it with their own helpers. One rule, because a card
// saying Saturday beside a strip saying nothing is how somebody drives to a
// job on the wrong day.

// A visit that is still a live appointment. `superseded` is a replaced
// proposal, `declined` is one the tenant refused, and `missed`/`happened` are
// after the fact -- none of them is a time anybody should be driving to.
export const LIVE_VISIT = ["proposed", "confirmed"];
export const isLiveVisit = (v) => LIVE_VISIT.includes(String(v?.status || ""));

// The four answers, in the order they outrank each other.
//
//   confirmed  the tenant agreed it. This is the appointment.
//   proposed   somebody asked for it and nobody has agreed yet.
//   target     a date on the job and no appointment. Where this product
//              started, and still the honest answer for work with nobody to
//              let anybody in.
//   none       nothing anywhere. Said out loud rather than drawn as a blank,
//              because a contractor accepting work with no date needs to know
//              that is what they are accepting.
export const WHEN_KINDS = {
  // 061. NOT "the tenant confirmed", because the tenant is no longer the only
  // party and on plenty of jobs they are not a party at all -- a repair fixed
  // from outside needs nobody in. Who actually agreed it is decided per job by
  // shared/visitparty.js; what every reader of this line needs is whether it
  // is settled.
  confirmed: { id: "confirmed", tone: "ok", lead: "Confirmed",
    note: "Agreed by everybody who has to be there." },
  proposed: { id: "proposed", tone: "wait", lead: "Proposed",
    note: "Proposed, not confirmed yet — don't travel on it until it is." },
  target: { id: "target", tone: "plain", lead: "Target date",
    note: "The date on the job. No visit time has been agreed." },
  none: { id: "none", tone: "wait", lead: "No date yet",
    note: "No date on this job and no visit time proposed." },
};

// A CONFIRMED VISIT BEATS THE JOB'S OWN DATE, deliberately, and getting that
// backwards is the whole trap. `jobs.date` is what somebody typed when the
// job was raised; the visit is what the tenant actually agreed to, and it is
// the later fact. The tenant's own screen has drawn it that way since 019 --
// *"A date on the job is not a date with the tenant"* -- so reading the job
// column here would put two dates in front of two parties to one appointment.
export function workWhen(row) {
  const v = row?.visit;
  if (isLiveVisit(v)) {
    return { kind: v.status, date: v.date || null,
      startTime: v.startTime || null, endTime: v.endTime || null,
      visitId: v.id || null, note: v.note || null,
      // 061. Whether the side reading this has already answered. A Confirm
      // button on a window you confirmed an hour ago is a button that does
      // nothing, and the honest thing to draw there is who is still owed.
      mine: !!(v.contractorAt || v.contractor_at),
      // 064. WHOSE TURN IT IS, and who is still owed, carried from the server
      // rather than derived here. Whether the tenant is a party at all depends
      // on the access answer and on there being a seat to ask, which a screen
      // does not hold -- so a card deriving it would offer a Confirm button
      // the route refuses with `not_your_turn`.
      //
      // Absent on a row from a route that does not carry it, which reads as
      // "not known" rather than as "not your turn": the screens fall back to
      // their own 061 question, which is whether THIS side has answered.
      turn: v.turn || null, waitingOn: v.waitingOn || null };
  }
  const date = row?.date || null;
  if (date) {
    return { kind: "target", date, startTime: row?.time || null, endTime: null,
      visitId: null, note: null };
  }
  return { kind: "none", date: null, startTime: null, endTime: null,
    visitId: null, note: null };
}

// What day to put it on. A PROPOSED time counts, which is a decision rather
// than an oversight: a contractor needs to know somebody has asked for
// Saturday as much as they need to know Saturday is agreed, and a strip that
// showed only confirmed ones would be the same silence this module exists to
// end. Every row says which it is, so nothing is being passed off as settled.
export const scheduledOn = (row) => workWhen(row).date;

// Is it still ahead? Used to split "what is coming" from "what has gone past
// with nobody having said what happened" -- a date in the past is the one
// thing on a schedule worth saying out loud, which the hiring side's own
// panel already learnt.
export function whenIsPast(when, todayKey) {
  return !!when?.date && String(when.date) < String(todayKey);
}

// HOW LONG A PROPOSED WINDOW IS, which was written inside the propose form
// and is now needed on the server too.
//
// Reported as *"it should have showed an accept or decline option when I
// updated it from the property manager side"*: changing a job's date on the
// edit form wrote `jobs.date` and told nobody, so the crew's card read
// "Target date. No visit time has been agreed" over a date the manager had
// already moved. The fix makes that edit propose a window, which means the
// server has to know how long one is -- and a second copy of this arithmetic
// is two records of one fact, with the one that drifts being whichever door
// is used less.
export const WINDOW_MINS = 60;
const mins = (hhmm) => {
  const [h, m] = String(hhmm || "").split(":").map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
};
// KEEPS THE LENGTH SOMEBODY ALREADY CHOSE. A 2h15m window moved from 11am to
// 1pm is still 2h15m, and overwriting that would be the screen deciding
// something they had decided. One hour when there is nothing to keep, and
// clamped to the end of the day, because a window past midnight is one the
// route refuses and two dates in one row.
export function windowEnd(start, wasStart, wasEnd) {
  const from = mins(start);
  if (from === null) return null;
  const a = mins(wasStart), b = mins(wasEnd);
  const len = a !== null && b !== null && b > a ? b - a : WINDOW_MINS;
  const to = Math.min(from + len, 23 * 60 + 59);
  return `${String(Math.floor(to / 60)).padStart(2, "0")}:${String(to % 60).padStart(2, "0")}`;
}

// IS THERE ANYBODY BUT US TO PUT A NEW DATE TO?
//
// `visitParties` always carries the hiring side on a 064 database, because
// proposing is agreeing for whoever proposed it -- so a list of just
// `manager` settles the moment it is written and tells nobody. Proposing one
// of those would turn a target date into a card reading "Confirmed. Agreed by
// everybody who has to be there" over a job with no crew on it, which is the
// screen-that-lies rule pointed at the one line a contractor reads to decide
// whether to get in the van.
//
// So a date change asks somebody only when there IS somebody: a crew who has
// accepted, or a tenant who has to be in. Otherwise `jobs.date` is a target
// and saying so is the honest answer, which is what it has always done.
export const othersMustAgree = (parties) =>
  (parties || []).some((p) => p !== "manager");
