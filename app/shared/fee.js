// SubSub's fee on a payment it moves, and the words for it.
//
// 0.05% of the payment, at most $500 a payment, charged to the HIRING account
// on top of what it pays -- never taken out of what the subcontractor receives
// -- and NOTHING on the first $50,000 an account sends through SubSub. See
// releaseAmounts in money.js for why it is on top, and why the cap is per
// payment rather than per work order.
//
// ONLY ON MONEY THAT GOES THROUGH SUBSUB. A release recorded as paid by check
// or by a bank transfer somebody made themselves carries no fee: nothing went
// through us, so nothing is charged, and it does not use up the free $50,000
// either -- that allowance is for payments SubSub actually made.
//
// PER ACCOUNT, ADJUSTABLE FROM THE STAFF CONSOLE. The three figures here are
// the defaults; `account_fee_terms` (071) holds an account's own where staff
// have set one, and `feeTerms` is the one place the two are merged, so the
// route that charges and the screen that shows the charge read one answer.
//
// THE FREE ALLOWANCE IS COUNTED AGAINST WHAT HAS BEEN PAID, NOT WHAT IS OWED.
// "Processed" means releases paid through SubSub. A payment straddling the
// line is charged only on the part above it -- $45,000 already sent and a
// $10,000 payment is a fee on $5,000 -- because charging the whole payment
// because part of it crossed is a cliff nobody would agree to.
//
// The fee is STAMPED on the release when it is verified, so the account sees
// it before funding, and RE-WORKED when it is paid, from what has actually
// been processed by then. Those can differ -- a release stamped while another
// was still owed, paid after it -- and the payment is the one that counts.

export const PLATFORM_FEE_BPS = 5;               // 0.05%
export const PLATFORM_FEE_CAP_CENTS = 50_000;    // $500 per payment
export const PLATFORM_FEE_FREE_CENTS = 5_000_000; // the first $50,000, free

// The limits a staff member may set. A typo guard rather than a policy: 10%
// is far past any rate anybody means, and an override wildly outside these is
// a slipped decimal point, which is the mistake this fee has already had once.
export const FEE_LIMITS = { maxBps: 1000, maxCapCents: 10_000_000, maxFreeCents: 1_000_000_000 };

export const DEFAULT_FEE_TERMS = Object.freeze({
  bps: PLATFORM_FEE_BPS, capCents: PLATFORM_FEE_CAP_CENTS, freeCents: PLATFORM_FEE_FREE_CENTS,
});

// An account's terms: its own where set, the defaults where not. Each figure
// falls back on its own, so an account given a lower rate keeps the default
// cap and free allowance rather than losing them.
export function feeTerms(row) {
  const pick = (v, d) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? d : Math.round(Number(v)));
  return {
    bps: pick(row?.fee_bps ?? row?.bps, PLATFORM_FEE_BPS),
    capCents: pick(row?.cap_cents ?? row?.capCents, PLATFORM_FEE_CAP_CENTS),
    freeCents: pick(row?.free_cents ?? row?.freeCents, PLATFORM_FEE_FREE_CENTS),
  };
}

// Is a set of terms one a staff member may save? Returns null or a reason.
export function feeTermsRefusal({ bps, capCents, freeCents } = {}) {
  const whole = (v) => Number.isInteger(v) && v >= 0;
  if (!whole(bps) || bps > FEE_LIMITS.maxBps) return "bad_rate";
  if (!whole(capCents) || capCents > FEE_LIMITS.maxCapCents) return "bad_cap";
  if (!whole(freeCents) || freeCents > FEE_LIMITS.maxFreeCents) return "bad_free";
  return null;
}

// The fee on one payment.
//
//   gross            what this payment is for
//   processedBefore  what this account has already paid through SubSub
//   terms            the account's terms (feeTerms)
//
// Only the part above the free allowance is charged, and that is floored to
// the cent and capped. Per payment rather than cumulative across a work order,
// because the allowance and the cap are both promises about each payment; the
// cost is that a run of payments can fall a cent short in SubSub's disfavour,
// never the account's.
export function feeFor({ gross, processedBefore = 0, terms = DEFAULT_FEE_TERMS } = {}) {
  const g = Math.max(0, Math.round(gross || 0));
  const freeLeft = Math.max(0, terms.freeCents - Math.max(0, Math.round(processedBefore)));
  const freeUsed = Math.min(g, freeLeft);
  const chargeable = g - freeUsed;
  let fee = Math.floor((chargeable * terms.bps) / 10000);
  if (terms.capCents != null) fee = Math.min(fee, terms.capCents);
  return { fee: Math.max(0, fee), chargeable, freeUsed, freeLeft };
}

const pct = (bps) => `${(bps / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
const dollars = (cents) => "$" + (Math.round(cents) / 100).toLocaleString("en-US",
  { minimumFractionDigits: 0, maximumFractionDigits: 2 });

// "0.05% of each payment, at most $500 a payment, and nothing on the first
// $50,000" -- one sentence, read by the fund form, the pay window and the
// marketing test, so three screens cannot quote three fees. Takes the
// account's own terms, because a sentence quoting the default to an account
// on a negotiated rate is the screen telling them the wrong price.
export function feeTermsText(terms = DEFAULT_FEE_TERMS) {
  if (!terms.bps) return "no fee";
  const parts = [`${pct(terms.bps)} of each payment`];
  if (terms.capCents != null) parts.push(`at most ${dollars(terms.capCents)} a payment`);
  const s = parts.join(", ");
  return terms.freeCents > 0 ? `${s}, after the first ${dollars(terms.freeCents)} free` : s;
}

export const FEE_TERMS = feeTermsText(DEFAULT_FEE_TERMS);
