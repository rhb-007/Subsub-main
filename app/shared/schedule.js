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
