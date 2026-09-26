// Overflow: the one place SubSub reaches past an account's own roster.
//
// It exists for a real moment. A pipe bursts on a Sunday, the account's two
// plumbers are both booked, and the alternative to this feature is a
// property manager ringing round strangers off a search engine. So an
// account with nobody of their own may put the job out to opted-in
// companies.
//
// IT IS A BROADCAST, NOT A DIRECTORY, and every rule below exists to keep
// that true:
//
//   The posting account never sees who it went to. They see the ones who
//   ANSWER. There is no candidate list, no ranking, no profiles, no count of
//   how many were asked -- that count is a measure of the platform's roster
//   and is nobody's to have.
//
//   Nothing is browsable. There is no endpoint that takes a trade and
//   returns companies. The server decides who a post reaches and never says.
//
//   It is only for overflow. An account with an eligible contractor of their
//   own for that trade cannot broadcast: that is what "overflow" means, and
//   without the precondition this is a marketplace with extra steps.
//
// ELIGIBILITY IS EARNED, on the receiving side. Overflow work is handed to
// somebody the posting account has never met and cannot check, so the
// platform does the checking: a real rating, time served, jobs actually
// finished, documents in force and a licence somebody verified. Opting in is
// necessary and nowhere near sufficient.
//
// THE FEE IS MODELLED AND SWITCHED OFF. It is zero until payment processing
// exists, and stamped onto each post at the moment it is made, so turning it
// on next year cannot rewrite what was charged this year. That is the same
// reasoning as wo_releases.fee_bps, for the same reason: a rate that is not
// recorded when it is applied is a rate nobody can reconstruct.

import { BPS, cumulativeCut } from "./money.js";

// Zero at launch. The column exists from the first row so switching it on is
// a config change rather than a migration plus a backfill nobody can verify.
export const OVERFLOW_FEE_BPS = 0;

// What a company has to have before the platform will put a stranger's
// emergency in front of them.
export const ELIGIBILITY = {
  // Out of five. Below this and somebody else's emergency is not the place
  // to find out why.
  minRating: 4.0,
  // A rating from two jobs is not a rating.
  minRatedJobs: 3,
  // Finished work, not accepted work.
  minCompletedJobs: 5,
  // Long enough that the account is not a week old. Counted from when the
  // company JOINED SubSub, not from when they opted in to overflow -- see
  // overflowStanding() in the Worker. Counting from opt-in made a
  // subcontractor who had been working through SubSub for two years "too new"
  // for three months, and meant the feature could reach nobody at all for a
  // quarter after launch.
  minDaysOnPlatform: 90,
};

// How long a post stays open before it stops being an emergency. Past this
// nobody is helping anybody by answering.
export const POST_WINDOW_HOURS = { "911": 2, urgent: 8, standard: 48 };
export const postWindowHours = (sev) => POST_WINDOW_HOURS[sev] || POST_WINDOW_HOURS.standard;

// Is this company allowed to be reached by a broadcast?
//
// Returns { ok } or { ok: false, reasons: [...] }. The reasons are for the
// COMPANY'S OWN screen -- "here is what you still need" -- and never for the
// posting account, who must not learn anything about anybody.
export function eligible(co = {}, { asOf } = {}) {
  const reasons = [];
  if (!co.overflowOptIn) reasons.push("not_opted_in");
  if (!(co.overflowTrades || []).length) reasons.push("no_trades_chosen");
  if (!co.licenseVerified) reasons.push("license_not_verified");
  if (!co.docsCurrent) reasons.push("documents_not_current");

  const rated = Number(co.ratedJobs || 0);
  const rating = Number(co.rating || 0);
  if (rated < ELIGIBILITY.minRatedJobs) reasons.push("too_few_ratings");
  else if (rating < ELIGIBILITY.minRating) reasons.push("rating_too_low");

  if (Number(co.completedJobs || 0) < ELIGIBILITY.minCompletedJobs) reasons.push("too_few_jobs");

  const days = co.daysOnPlatform ?? (co.joinedOn && asOf ? daysBetween(co.joinedOn, asOf) : null);
  if (days === null || days < ELIGIBILITY.minDaysOnPlatform) reasons.push("too_new");

  return reasons.length ? { ok: false, reasons } : { ok: true, reasons: [] };
}

const daysBetween = (from, to) =>
  Math.round((Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10))
    - Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10))) / 86400000);

// What to tell the COMPANY about their own standing. Written for them,
// because these are things they can act on.
export const ELIGIBILITY_TEXT = {
  not_opted_in: "You have not opted in to overflow work.",
  no_trades_chosen: "Choose which trades you want overflow work for.",
  license_not_verified: "Your licence has not been verified yet.",
  documents_not_current: "Your insurance or bond is not current.",
  too_few_ratings: `You need at least ${ELIGIBILITY.minRatedJobs} rated jobs.`,
  rating_too_low: `Overflow work goes to contractors rated ${ELIGIBILITY.minRating.toFixed(1)} and above.`,
  too_few_jobs: `You need at least ${ELIGIBILITY.minCompletedJobs} completed jobs.`,
  too_new: `Overflow opens after ${ELIGIBILITY.minDaysOnPlatform} days on SubSub — counted from when you joined, not from when you opted in.`,
};

// May this account broadcast this trade at all?
//
// `ownRoster` is the account's OWN contractors for that trade, each with
// whether they could actually take it. If any could, this is not overflow and
// the answer is no -- with the ones who could named, because they are the
// account's own contractors and telling them to use their own roster is the
// whole point.
export function canBroadcast({ ownRoster = [], trade } = {}) {
  const usable = ownRoster.filter((s) =>
    (s.categories || []).includes(trade) && s.available !== false && s.assignable !== false);
  if (usable.length) {
    return { ok: false, reason: "own_roster_available", companies: usable.map((s) => s.company) };
  }
  return { ok: true };
}

// The platform's cut of an overflow job, at the rate stamped on the post.
// Whole cents, through the same arithmetic as every other cut here, so a
// percentage is never computed twice in two places.
export function overflowFee(valueCents, bps = OVERFLOW_FEE_BPS) {
  return cumulativeCut(0, Math.max(0, Math.round(valueCents || 0)), bps || 0);
}

// What the contractor would actually clear, so the offer they answer is the
// number they get rather than the number before a deduction nobody mentioned.
export function overflowSplit(valueCents, bps = OVERFLOW_FEE_BPS) {
  const gross = Math.max(0, Math.round(valueCents || 0));
  const fee = overflowFee(gross, bps);
  return { gross, fee, net: gross - fee, bps: bps || 0 };
}

export function feeText(bps = OVERFLOW_FEE_BPS) {
  if (!bps) return "No platform fee on overflow work while this is in launch.";
  return `SubSub takes ${(bps / 100).toFixed(bps % 100 ? 2 : 0)}% of the job value on overflow work.`;
}

// A response is an offer, not an assignment. The posting account still picks,
// and picking is what issues the work order -- so a company answering has not
// committed their calendar to anything yet.
export const RESPONSE_STATUSES = ["offered", "withdrawn", "passed"];
export const POST_STATUSES = ["open", "filled", "cancelled", "expired"];

// Has this post stopped being live?
export function postClosed(post = {}, nowIso) {
  if (post.status && post.status !== "open") return true;
  if (post.expiresAt && nowIso && post.expiresAt <= nowIso) return true;
  return false;
}
