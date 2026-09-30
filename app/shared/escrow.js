// Money in, and money out, with the arithmetic in one place.
//
// The ledger has been written for a processor since 033: `wo_releases.method`
// and `.reference` are the seam, and the fee rate has been stamped onto every
// release from the first row so that changing it next year cannot rewrite what
// was charged last year. What was missing was the funded side. There was no
// money anywhere -- `settle` wrote `status = 'paid'` and a cheque number, which
// is bookkeeping about a payment that happened somewhere else.
//
// THE SHAPE IS SEPARATE CHARGES AND TRANSFERS, and that is a legal conclusion
// rather than a Stripe preference. It is the only arrangement that holds money
// between funding and release -- which is what "pay against verified work"
// requires, since the whole point is that the money is already there when the
// milestone is met. See EASY-PAY.md §10.3: it also means the funds sit in a
// balance attributed to the platform, with SubSub as merchant of record, and
// that tension is the question for counsel rather than a detail under it.
//
// WHAT FOLLOWS FROM THAT SHAPE, and it is why so little arithmetic is needed:
//
//   The FEE is not a Stripe concept here at all. The account funds the gross
//   and the subcontractor is transferred the net; the difference stays where
//   it already is. `application_fee_amount` belongs to destination charges,
//   which is a different arrangement. So money.js's existing cumulative cut IS
//   the fee, with nothing else to compute.
//
//   RETAINAGE is the same: it is money funded and not yet transferred. Which
//   means it is held, for months, and that is the sharpest edge of the escrow
//   question above. Recorded here rather than buried: holding retainage is
//   holding somebody else's money.
//
// AND MONEY IS NEVER LENT. A transfer larger than what has been funded would
// be SubSub advancing money to a subcontractor on a general contractor's
// promise, which is not a faster rail, it is credit -- and a different
// company. `available` is the whole of that guard.

import { releaseAmounts } from "./money.js";

// The states each row may be in. These are the same list as the CHECK clauses
// in migration 051, which makes them two records of one fact -- so a test
// compares them against the migration rather than leaving them as decoration.
// A list nothing reads is a comment pretending to be code.
//
// Funding, per attempt. `funded` is the only one that is money on hand.
export const FUND_STATES = ["pending", "funded", "failed", "refunded"];
// A transfer out, per attempt. A `failed` one may be retried; nothing else may
// -- which is why `ux_wo_transfer_live` is partial on exactly that value.
export const TRANSFER_STATES = ["pending", "paid", "failed", "reversed"];

// Stripe's own floor for a USD charge, and a ceiling that is a typo guard
// rather than a policy: nobody funds nine hundred thousand dollars of roofing
// by accident, and if they do it should take two presses.
export const MIN_FUND_CENTS = 50;
export const MAX_FUND_CENTS = 99_999_999;

export const CURRENCY = "usd";

// What a work order's money looks like.
//
//   fundedCents        every funding that landed
//   refundedCents      every funding that went back
//   transferredCents   every transfer that went out or is on its way
//   dueCents           releases owed and not yet paid
//
// `available` is what may be transferred right now. `shortfall` is what the
// account still has to put in to cover everything already owed -- which is the
// number the screen leads with, because "you owe $4,000 and have funded
// $1,500" is actionable and "insufficient funds" is not.
export function fundingState({ fundedCents = 0, refundedCents = 0,
                               transferredCents = 0, dueCents = 0 } = {}) {
  const inHand = Math.max(0, Math.round(fundedCents) - Math.round(refundedCents));
  const out = Math.round(transferredCents);
  const available = Math.max(0, inHand - out);
  const due = Math.round(dueCents);
  return {
    fundedCents: Math.round(fundedCents),
    refundedCents: Math.round(refundedCents),
    transferredCents: out,
    dueCents: due,
    availableCents: available,
    shortfallCents: Math.max(0, due - available),
    // Money funded, not owed to anybody, and returnable. Retainage is NOT in
    // here: it is owed, it is simply not owed yet, and offering it back as
    // "unspent" is how somebody refunds their way out of a holdback.
    refundableCents: Math.max(0, available - due),
  };
}

// May this release be paid out right now?
//
// Only the facts. The two paperwork gates (cover and the waiver chain) are
// overridable with a recorded reason and so live with the route; these are not
// overridable by anybody, because no reason makes an unverified payee reachable
// or makes unfunded money exist.
export function canPay({ release, funding, payable } = {}) {
  if (!release) return { ok: false, reason: "no_release" };
  if (release.status === "paid") return { ok: false, reason: "already_paid" };
  if (release.status === "void") return { ok: false, reason: "void" };
  const net = Math.round(release.netCents ?? release.net_cents ?? 0);
  if (net <= 0) return { ok: false, reason: "nothing_owed" };
  // Below Stripe's floor there is nothing to send, and it is not an error the
  // account can do anything about -- so it is named rather than reported as a
  // Stripe refusal further down.
  if (net < MIN_FUND_CENTS) return { ok: false, reason: "below_minimum", net };
  if (!payable) return { ok: false, reason: "payee_not_ready" };
  const avail = Math.round(funding?.availableCents ?? 0);
  if (avail < net) return { ok: false, reason: "not_funded", net, available: avail };
  return { ok: true, net };
}

const money = (cents) => "$" + (Math.round(cents) / 100).toLocaleString("en-US",
  { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Why not, in words. Each one says what to do, because "cannot pay" beside a
// dead button is the disabled-control-with-no-reason failure.
export function payRefusalText(r, { subName = "They" } = {}) {
  if (!r || r.ok) return "";
  if (r.reason === "already_paid") return "That one has already been paid.";
  if (r.reason === "void") return "That release was voided.";
  if (r.reason === "nothing_owed") return "There is nothing owed on this one.";
  if (r.reason === "below_minimum") {
    return `${money(r.net)} is under the ${money(MIN_FUND_CENTS)} minimum a transfer can carry.`
      + " Record it as paid outside SubSub instead.";
  }
  if (r.reason === "payee_not_ready") {
    return `${subName} have not finished telling Stripe who they are and where the money goes,`
      + " so there is nowhere to send it yet.";
  }
  if (r.reason === "not_funded") {
    return `${money(r.available)} is funded and ${money(r.net)} is owed.`
      + ` Add ${money(r.net - r.available)} to pay this one.`;
  }
  return "That cannot be paid yet.";
}

// What the next release on this work order will cost to fund, so the fund form
// can suggest a figure instead of asking somebody to do the arithmetic.
//
// Derived from money.js rather than reimplemented: a second opinion on what a
// release nets would put a figure on the fund screen that the release then
// disagrees with by a cent.
export function fundSuggestion({ milestones = [], priorGross = 0, retainageBps = 0,
                                 feeBps = 0, alreadyAvailable = 0 } = {}) {
  let running = Math.round(priorGross);
  let gross = 0;
  for (const m of milestones) {
    if (m.status === "paid" || m.released) continue;
    gross += Math.round(m.amountCents ?? m.amount_cents ?? 0);
  }
  if (gross <= 0) return { grossCents: 0, netCents: 0, topUpCents: 0 };
  const a = releaseAmounts({ gross, priorGross: running, retainageBps, feeBps });
  // Funding covers the GROSS: the retainage has to be on hand too, or the
  // final release has nothing behind it.
  return {
    grossCents: a.gross,
    netCents: a.net,
    retainageCents: a.retainage,
    feeCents: a.fee,
    topUpCents: Math.max(0, a.gross - Math.round(alreadyAvailable)),
  };
}
