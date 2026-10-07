// AUTO-SCHEDULING A TURNAROUND: who to send, and when.
//
// Asked for as: *"the property manager [should] be able to select in their
// settings auto-schedule for jobs meaning that upon approval by them of the
// move-in, move-out job (these jobs only) it will auto schedule and assign the
// job to the most optimized qualified tradesman and the best possible time and
// then automate back and forth with tenant and tradesman until it's booked."*
//
// A turnaround is the one kind of job where this is safe to automate, and the
// reason is what makes the whole feature defensible: a unit between tenancies
// is EMPTY and the work is known. Nobody is waiting in it, the scope came off
// a walk somebody already did, and the date is driven by the next tenancy
// rather than by a leak. That is not true of a repair, which is why this is
// deliberately not offered for one.
//
// WHAT THIS MODULE DOES AND DOES NOT DO. It chooses and it ranks; it does not
// assign. The assignment goes through the ordinary assign route, with every
// gate it carries -- the roster status, the documents, the handyman trade
// list, the cover on the job date, the value ceiling. An automatic path that
// re-implemented those would be a second set of rules to keep in step, and the
// one that drifted would be the one nobody watches.

import { mayCover } from "./engaged.js";

// WHICH JOBS. "These jobs only", in those words, and it is a short list on
// purpose: everything here assumes an empty unit and a known scope.
export const TURNAROUND_KINDS = ["move_in", "move_out"];
export const isTurnaroundKind = (k) => TURNAROUND_KINDS.includes(String(k || ""));

// HOW MANY WINDOWS IT WILL PUT FORWARD BEFORE IT STOPS AND ASKS.
//
// Bounded, and this is the number that keeps the feature from becoming a
// machine that pesters two people. "Automate the back and forth until it's
// booked" cannot mean *for ever*: a contractor and a tenant who keep declining
// are telling us something no amount of re-proposing will fix, and the third
// refusal is where a person needs to look at it rather than the system
// trying a fourth date nobody asked for.
export const AUTO_TRIES = 3;

// The earliest a window may be put forward. Not today: somebody has to be told
// and the crew has to get there, and a slot proposed for this afternoon is one
// that gets declined and spends a try.
export const AUTO_LEAD_DAYS = 1;
export const AUTO_START = "09:00";
export const AUTO_END = "12:00";
// Monday to Friday. 0 is Sunday, as `Date#getUTCDay` has it.
export const WORK_DAYS = [1, 2, 3, 4, 5];

const DAY = 86400000;
const iso = (d) => d.toISOString().slice(0, 10);
const parse = (s) => new Date(`${String(s || "").slice(0, 10)}T00:00:00Z`);
const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));

// THE NEXT WINDOW THIS COMPANY COULD ACTUALLY TAKE.
//
// Working days only, never in the past, never a day they are already out on,
// and never a day they already have one of this account's appointments on --
// which is the whole of what "the best possible time" can honestly mean from
// here. SubSub sees this account's bookings and the days they have marked
// themselves unavailable; it does not see the other four accounts' diaries, so
// the slot is an OFFER and the chain is what settles it. Pretending otherwise
// would be the confident-and-wrong answer this project refuses.
//
// `from` is passed rather than read off the clock, so the same inputs always
// give the same answer and a test is not a race against midnight.
export function slotFor({ from, busy = [], unavailable = [], skip = 0, days = WORK_DAYS } = {}) {
  if (!isDay(from)) return null;
  const out = new Set([...(busy || []), ...(unavailable || [])].filter(isDay));
  let d = parse(from);
  d = new Date(d.getTime() + AUTO_LEAD_DAYS * DAY);
  let found = 0;
  // A year is far past any sensible turnaround and is the guard against a
  // company that has marked itself unavailable for ever.
  for (let i = 0; i < 400; i += 1) {
    const day = iso(d);
    if (days.includes(d.getUTCDay()) && !out.has(day)) {
      if (found === skip) return day;
      found += 1;
    }
    d = new Date(d.getTime() + DAY);
  }
  return null;
}

// WHY A CANDIDATE IS OUT. Named rather than filtered silently, because the
// manager is handing a decision to the machine and the one thing it owes them
// is an account of what it did -- including who it could not use and why.
export const AUTO_SKIP = {
  not_this_trade: "not engaged for this trade",
  documents: "documents outstanding",
  no_slot: "no free day in range",
};

// THE RANKING. Ordered, and each criterion is here for a reason rather than
// because it was available.
//
//   SOONEST FIRST, because "the best possible time" is the request and an
//   empty unit costs money every day it stays empty.
//   THEN RATING, because among crews who can come on the same day the better
//   one is the right answer and this is the only quality signal the product
//   holds.
//   THEN FEWER OPEN JOBS, which spreads the work rather than giving every
//   turnaround to the same company -- and a crew with less on is likelier to
//   keep the slot they just agreed to.
//   THEN THE NAME, so the same roster always produces the same answer. A
//   tie broken at random is a feature nobody can test and nobody can explain.
//
// Deliberately NOT ranked on whether they have granted auto-schedule. That
// would quietly steer every turnaround to the crews who gave up their
// accept/decline, which is paying for consent with work.
export function rankCandidates(cands = [], { trade, from } = {}) {
  const skipped = [];
  const ok = [];
  for (const cnd of cands || []) {
    // The same two questions the assign route asks, asked here first so a
    // candidate is not put forward only to be refused -- the screen-looser-
    // than-the-route lie, pointed at a machine.
    // Which of the two it was rides along, because the way out differs: a
    // trade missing from their card is one tick on Edit, a handyman cannot be
    // given the trade at all.
    if (!(cnd.categories || []).includes(trade) || !mayCover(cnd.engagedAs, trade)) {
      skipped.push({ companyId: cnd.companyId, company: cnd.company, why: "not_this_trade",
        handyman: !mayCover(cnd.engagedAs, trade) });
      continue;
    }
    // And WHICH documents, because "documents outstanding" sends somebody to
    // chase a contractor for a certificate this account has simply not
    // verified yet -- the two need opposite actions.
    if ((cnd.blockers || []).length) {
      skipped.push({ companyId: cnd.companyId, company: cnd.company, why: "documents",
        kinds: [...cnd.blockers] });
      continue;
    }
    const day = slotFor({ from, busy: cnd.busy, unavailable: cnd.unavailable });
    if (!day) {
      skipped.push({ companyId: cnd.companyId, company: cnd.company, why: "no_slot" });
      continue;
    }
    ok.push({ ...cnd, day });
  }
  ok.sort((a, b) =>
    (a.day < b.day ? -1 : a.day > b.day ? 1 : 0)
    || (Number(b.rating || 0) - Number(a.rating || 0))
    || (Number(a.openJobs || 0) - Number(b.openJobs || 0))
    || String(a.company || "").localeCompare(String(b.company || "")));
  return { picked: ok[0] || null, ranked: ok, skipped };
}

// WHY THIS JOB IS NOT ONE TO AUTOMATE. One predicate, read by the hook and by
// the tests, so "it did nothing and said nothing" is never the answer.
export function whyNotAuto({ on = false, kind = null, trades = [], assigned = 0 } = {}) {
  if (!on) return "not_switched_on";
  // "These jobs only" -- a repair is somebody's home with somebody in it, and
  // the date is driven by how bad the leak is rather than by a tenancy.
  if (!isTurnaroundKind(kind)) return "not_a_turnaround";
  if (!trades.length) return "no_trades";
  // Somebody has already been put on it by hand, and a machine that assigns
  // over a person's decision is one they switch off.
  if (assigned) return "already_assigned";
  return null;
}

// WHAT HAPPENED, in words, for the feed and for the card. The manager handed
// a decision over; the least it owes them is a sentence saying what it chose
// and why it chose that one.
export function autoPickText(picked, { trade, skipped = [] } = {}) {
  if (!picked) return "Nobody on the roster could take it.";
  const why = [`soonest free day (${picked.day})`];
  if (picked.rating) why.push(`rated ${picked.rating}`);
  const also = skipped.length ? ` ${skipped.length} other${skipped.length === 1 ? "" : "s"} skipped.` : "";
  return `${picked.company} for ${trade} — ${why.join(", ")}.${also}`;
}
