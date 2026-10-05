// SubSub's fee on a payment it moves, and the words for it.
//
// 0.05% of the payment, at most $500 a payment, charged to the HIRING account
// on top of what it pays -- never taken out of what the subcontractor receives.
// See releaseAmounts in money.js for why it is on top, and why the cap is per
// payment rather than per work order.
//
// ONLY ON MONEY THAT GOES THROUGH SUBSUB. A release recorded as paid by cheque
// or by a bank transfer somebody made themselves carries no fee: nothing went
// through us, so nothing is charged. The rate is stamped onto each release
// when it is verified, so the figure is on screen before anybody funds or
// pays, and the settle route zeroes it when the money moved somewhere else.
//
// Here rather than in the Worker so the screen that shows the fee and the
// route that charges it read one number. The rate was a constant in the Worker
// alone while it was zero, which was fine while there was nothing to show.
//
// Stamped, never read live: changing either figure here changes what NEW
// releases are charged, and nothing already verified moves.

import { releaseAmounts } from "./money.js";

export const PLATFORM_FEE_BPS = 5;               // 0.05%
export const PLATFORM_FEE_CAP_CENTS = 50_000;    // $500 per payment

// The fee on one release, with the cap, from the same arithmetic the release
// itself is cut with -- a second formula would put a figure on the fund screen
// that the release then disagrees with by a cent.
export function platformFee({ gross, priorGross = 0,
                              bps = PLATFORM_FEE_BPS, capCents = PLATFORM_FEE_CAP_CENTS } = {}) {
  return releaseAmounts({ gross, priorGross, feeBps: bps, feeCapCents: capCents }).fee;
}

const pct = (bps) => `${(bps / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
const dollars = (cents) => "$" + (Math.round(cents) / 100).toLocaleString("en-US",
  { minimumFractionDigits: 0, maximumFractionDigits: 2 });

// "0.05%, at most $500 a payment" -- one sentence, read by the fund form, the
// pay modal and the marketing copy's test, so the three cannot quote three
// different fees.
export const FEE_TERMS = `${pct(PLATFORM_FEE_BPS)} of each payment, at most ${dollars(PLATFORM_FEE_CAP_CENTS)} a payment`;
