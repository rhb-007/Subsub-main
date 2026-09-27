// Asking your own subcontractors to price a job, before committing to any.
//
// Imported by the Worker and the browser, so the two cannot disagree about who
// may ask, who may answer, and what an invited company is allowed to see.
//
// Part of "pre-award" already existed: a work order with status 'pending' IS a
// pre-award view -- the subcontractor sees the job, the scope and the price,
// and accepts or declines before anything is committed. What did not exist is
// the case where the account does not know the price yet. Work orders cannot
// express it: issuing one commits to a number, and issuing three for the same
// trade collides on the live-WO index.
//
// So this is overflow's shape pointed at the account's own roster. None of
// overflow's gates apply -- no opt-in, no three months, no rating floor, no
// fee -- because these are already your contractors, which is the product.

// Statuses, in one place, so nothing spells them differently.
export const REQUEST_STATUS = ["open", "awarded", "cancelled"];
export const INVITE_STATUS = ["invited", "quoted", "passed", "withdrawn"];

// How many companies one question may go to. Not a licence to broadcast: past
// a handful this stops being "which of my roofers" and starts being the thing
// overflow exists to do under its own rules, with its own eligibility.
export const MAX_INVITES = 8;

// ---- Asking -------------------------------------------------------------

// May this account ask for quotes on this trade of this job?
//
// The precondition is the mirror of overflow's. Overflow is refused when the
// account HAS somebody of their own who could be issued the work; this is only
// available then, because it asks the roster and nobody else.
export function canRequestQuotes(job = {}, { role, hasOpenRequest, liveWorkOrder } = {}) {
  if (role !== "admin" && role !== "pm") return { ok: false, reason: "not_your_call" };
  if (job.readOnly || job.atOwnedProperty || job.inherited) {
    return { ok: false, reason: "not_your_job" };
  }
  // A request that was never approved is not work anybody may be asked to
  // price: the account has not agreed to have it done.
  if (job.requestedBy && !job.approvedAt) return { ok: false, reason: "not_approved" };
  if (job.withdrawnAt) return { ok: false, reason: "withdrawn" };
  // Already committed. Asking for quotes on a trade somebody is already
  // issued would be asking companies to price work that is gone.
  if (liveWorkOrder) return { ok: false, reason: "already_issued" };
  if (hasOpenRequest) return { ok: false, reason: "already_asking" };
  return { ok: true };
}

// The companies an account may ask: its own roster, for that trade, still
// engaged. Never a search, never a lookup -- this is a filter over a list the
// caller already holds.
export function quotableSubs(subs = [], trade) {
  return subs.filter((s) =>
    s && s.id
    && s.status !== "ended"
    && (!trade || (s.categories || []).includes(trade)));
}

export function validInvitees(ids = [], subs = [], trade) {
  const allowed = new Set(quotableSubs(subs, trade).map((s) => s.id));
  const picked = [...new Set(ids.filter((id) => allowed.has(id)))];
  if (!picked.length) return { ok: false, reason: "nobody_to_ask" };
  if (picked.length > MAX_INVITES) return { ok: false, reason: "too_many" };
  return { ok: true, companyIds: picked };
}

// ---- Answering ----------------------------------------------------------

export function canQuote(invite = {}, request = {}) {
  if (request.status !== "open") return { ok: false, reason: "closed" };
  if (invite.status === "withdrawn") return { ok: false, reason: "withdrawn" };
  return { ok: true };
}

// A price is whole cents and must be a real number. Zero is refused: a free
// quote is either a mistake or a conversation, and neither is a number to
// award against.
export function validQuote({ priceCents, canStart, note } = {}) {
  if (priceCents == null || priceCents === "") return { ok: false, reason: "price_required" };
  const n = Number(priceCents);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    return { ok: false, reason: "invalid_price" };
  }
  if (canStart && !/^\d{4}-\d{2}-\d{2}$/.test(String(canStart))) {
    return { ok: false, reason: "invalid_date" };
  }
  return { ok: true, priceCents: n, canStart: canStart || null,
    note: (note || "").trim() || null };
}

// ---- What an invited company sees --------------------------------------

// The job, to somebody who has been asked to price it and nothing more.
//
// This is a key to ONE job, never to the account's job list -- /api/jobs is
// scoped to the work orders a company holds, and a quote request must not be
// a second door into it.
//
// Withheld, and each for its own reason:
//   - the other trades' assignments, which name other companies on this
//     account's roster and what they are paid;
//   - every other quote, and the fact that there are any. These are competing
//     bids and one of them is the price the account is about to pay;
//   - who else was asked, which is the roster one name at a time;
//   - the account's own notes and the tenant's report.
//
// `assignments` is EMPTY, not absent: every screen does
// `j.trades.filter((t) => j.assignments[t])` and a job without the map white-
// screens the jobs list. Empty is also the honest answer -- nobody is assigned,
// which is exactly why they are being asked.
export function quoteJobShape(job = {}, request = {}) {
  return {
    id: job.id,
    title: job.title,
    address: job.address || null,
    area: job.area || null,
    zip: job.zip || null,
    date: job.date || null,
    time: job.time || null,
    severity: job.severity || null,
    // The one trade they are pricing, never the job's full list -- the others
    // are somebody else's to quote.
    trades: [request.trade].filter(Boolean),
    // The request's scope when there is one, because that is what every
    // invited company was given; the job's own only as a fallback.
    scope: request.scope || job.scope || null,
    assignments: {},
    quoting: true,
    readOnly: true,
  };
}

// ---- Comparing and awarding --------------------------------------------

// Cheapest first, then soonest, then who answered first. A pass is not a
// quote and sorts out of the way rather than being hidden: "three asked, one
// passed, two quoted" is the shape of the answer.
export function rankQuotes(invites = []) {
  const answered = invites.filter((i) => i.status === "quoted");
  const rest = invites.filter((i) => i.status !== "quoted");
  answered.sort((a, b) =>
    (Number(a.priceCents) - Number(b.priceCents))
    || String(a.canStart || "9999").localeCompare(String(b.canStart || "9999"))
    || String(a.answeredAt || "").localeCompare(String(b.answeredAt || "")));
  return [...answered, ...rest];
}

// A spread is only meaningful once two people have answered. One quote is a
// price, not a comparison, and showing "lowest of 1" invites reading it as one.
export function quoteSpread(invites = []) {
  const prices = invites.filter((i) => i.status === "quoted")
    .map((i) => Number(i.priceCents)).filter(Number.isFinite);
  if (prices.length < 2) return null;
  const low = Math.min(...prices), high = Math.max(...prices);
  return { low, high, spread: high - low, count: prices.length };
}

export function canAward(request = {}, invite = {}) {
  if (request.status !== "open") return { ok: false, reason: "closed" };
  if (invite.requestId !== request.id) return { ok: false, reason: "wrong_request" };
  // Awarding to somebody who never answered would issue a work order at a
  // price nobody agreed to. The pre-award view exists precisely so that the
  // number on the work order is one they gave.
  if (invite.status !== "quoted") return { ok: false, reason: "no_quote" };
  return { ok: true };
}

// What the account is told about a request at a glance.
export function requestState(request = {}, invites = []) {
  if (request.status === "awarded") return "awarded";
  if (request.status === "cancelled") return "cancelled";
  const quoted = invites.filter((i) => i.status === "quoted").length;
  const passed = invites.filter((i) => i.status === "passed").length;
  if (quoted) return "quotes_in";
  if (passed && passed === invites.length) return "all_passed";
  return "waiting";
}

export function stateLabel(state, { quoted = 0, asked = 0 } = {}) {
  if (state === "awarded") return "Awarded";
  if (state === "cancelled") return "Cancelled";
  if (state === "all_passed") return "Everyone passed";
  if (state === "quotes_in") return `${quoted} of ${asked} quoted`;
  return `Waiting on ${asked}`;
}
