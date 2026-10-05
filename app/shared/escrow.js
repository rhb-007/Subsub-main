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
//   AND the fee, the subcontractor is transferred the net, and the fee is
//   simply what stays where it already is. `application_fee_amount` belongs to
//   destination charges, which is a different arrangement. So the fee is a
//   figure stamped on the release (shared/fee.js) and spent by the transfer
//   going out, with nothing else to compute.
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
import { DEFAULT_FEE_TERMS, feeFor } from "./fee.js";

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
//   dueCents           releases owed and not yet paid -- the NET, what the
//                      subcontractor will receive
//   feesTakenCents     SubSub's fee on releases already paid through SubSub:
//                      money that is in, and is no longer the account's
//   feesDueCents       the fee on releases still owed, which the account has
//                      to have on hand before each one can be sent
//
// The two fee figures are separate from the net on purpose. "$4,000 owed" over
// a release that sends $3,980 is a screen arguing with itself; the sentence is
// "$3,980 to them and $20 to SubSub", and only separate figures can say it.
//
// `available` is what may be transferred right now. `shortfall` is what the
// account still has to put in to cover everything already owed -- which is the
// number the screen leads with, because "you owe $4,000 and have funded
// $1,500" is actionable and "insufficient funds" is not.
export function fundingState({ fundedCents = 0, refundedCents = 0,
                               transferredCents = 0, dueCents = 0,
                               feesTakenCents = 0, feesDueCents = 0 } = {}) {
  const inHand = Math.max(0, Math.round(fundedCents) - Math.round(refundedCents));
  const out = Math.round(transferredCents);
  const taken = Math.round(feesTakenCents);
  const available = Math.max(0, inHand - out - taken);
  const due = Math.round(dueCents);
  const feesDue = Math.round(feesDueCents);
  const owed = due + feesDue;
  return {
    fundedCents: Math.round(fundedCents),
    refundedCents: Math.round(refundedCents),
    transferredCents: out,
    dueCents: due,
    feesTakenCents: taken,
    feesDueCents: feesDue,
    // Everything the account still has to cover: what goes to the
    // subcontractor and what goes to SubSub. The number the panel leads with.
    owedCents: owed,
    availableCents: available,
    shortfallCents: Math.max(0, owed - available),
    // Money funded, not owed to anybody, and returnable. Retainage is NOT in
    // here: it is owed, it is simply not owed yet, and offering it back as
    // "unspent" is how somebody refunds their way out of a holdback. Nor is
    // the fee on a release still due: refunding it would leave that release
    // unpayable through SubSub over money the account just took back.
    refundableCents: Math.max(0, available - owed),
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
  // The fee rides with the transfer, so the money behind it has to be there
  // too. Read off the RELEASE, where it was stamped, never recomputed here --
  // a rate changed since would otherwise ask for a figure the release never
  // carried.
  const fee = Math.max(0, Math.round(release.feeCents ?? release.fee_cents ?? 0));
  const avail = Math.round(funding?.availableCents ?? 0);
  if (avail < net + fee) return { ok: false, reason: "not_funded", net, fee, available: avail };
  return { ok: true, net, fee };
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
    const fee = Math.round(r.fee || 0);
    const need = r.net + fee;
    return `${money(r.available)} is funded and ${money(need)} is needed`
      + (fee ? ` -- ${money(r.net)} to them and SubSub's ${money(fee)} fee.` : ".")
      + ` Add ${money(need - r.available)} to pay this one.`;
  }
  return "That cannot be paid yet.";
}

// What the next release on this work order will cost to fund, so the fund form
// can suggest a figure instead of asking somebody to do the arithmetic.
//
// Derived from money.js rather than reimplemented: a second opinion on what a
// release nets would put a figure on the fund screen that the release then
// disagrees with by a cent.
//
// Milestone by milestone rather than as one lump, because the fee's cap and
// its free allowance are both per payment: two capped draws are two capped
// fees, and the first $50,000 is used up in order. A lump would suggest one
// fee, and the account would fund a figure that then cannot pay the second
// draw.
//
// `terms` and `processedCents` are the account's -- what it is charged and how
// much it has already sent through SubSub -- because a suggestion worked out
// on the default rate for an account on its own rate is a figure the release
// then disagrees with.
//
// `owedCents` is what is already owed and unpaid -- net and fee -- because the
// top-up has to cover that as well as the work still to come, or funding to
// the suggested figure leaves a release that was already due short.
export function fundSuggestion({ milestones = [], priorGross = 0, retainageBps = 0,
                                 terms = DEFAULT_FEE_TERMS, processedCents = 0,
                                 owedCents = 0, alreadyAvailable = 0 } = {}) {
  let running = Math.round(priorGross);
  let processed = Math.max(0, Math.round(processedCents));
  let gross = 0, net = 0, retainage = 0, fee = 0;
  for (const m of milestones) {
    if (m.status === "paid" || m.released) continue;
    const g = Math.round(m.amountCents ?? m.amount_cents ?? 0);
    if (g <= 0) continue;
    const a = releaseAmounts({ gross: g, priorGross: running, retainageBps });
    const f = feeFor({ gross: g, processedBefore: processed, terms }).fee;
    gross += a.gross; net += a.net; retainage += a.retainage; fee += f;
    running += g; processed += g;
  }
  const owed = Math.max(0, Math.round(owedCents));
  if (gross <= 0 && owed <= 0) return { grossCents: 0, netCents: 0, feeCents: 0, topUpCents: 0 };
  // Funding covers the GROSS: the retainage has to be on hand too, or the
  // final release has nothing behind it. And the fee, which is paid with
  // each release rather than after.
  return {
    grossCents: gross,
    netCents: net,
    retainageCents: retainage,
    feeCents: fee,
    topUpCents: Math.max(0, gross + fee + owed - Math.round(alreadyAvailable)),
  };
}
