// Money, in whole cents, with no drift.
//
// Everything here exists because a percentage taken repeatedly does not add
// up. Hold 5% of each of three $333.33 milestones, round each one, and the
// total held is not 5% of $1,000 -- it is 5% minus a cent or two that no
// ledger can account for. Over a year of retainage across thirty
// subcontractors that is a real number somebody has to explain.
//
// So every cut is computed CUMULATIVELY: what should have been held after
// this milestone, minus what was already held. The per-milestone figure is
// the difference. The pennies land where they land and the total is always
// exactly right, which is the only property that matters.
//
// Basis points, not percents, and never floats for a stored amount. 500 bps
// is 5%. A rate of 2.5% is 250 and not 0.025.
//
// Shared by the Worker and the browser so a figure shown on screen and a
// figure written to the database cannot disagree by a cent.

export const BPS = 10000;

// The integer floor, including for negatives. Math.floor(-0.5) is -1, which
// is what you want for a cut but not what JavaScript's `|0` or Math.trunc
// would give -- and a negative here means somebody passed a credit, which is
// a real case once change orders reduce a work order.
const floorDiv = (n, d) => Math.floor(n / d);

// What a rate takes out of a running total, without drift.
//
//   priorGross  everything already released on this work order
//   gross       what is being released now
//   bps         the rate
//
// Returns the cut for THIS release: the difference between what should have
// been taken by the end of it and what was taken before.
export function cumulativeCut(priorGross, gross, bps) {
  if (!bps) return 0;
  const before = floorDiv(priorGross * bps, BPS);
  const after = floorDiv((priorGross + gross) * bps, BPS);
  return after - before;
}

// One release, broken into its parts.
//
// Retainage is held back and paid at the end; the fee is SubSub's, taken on
// the gross. Both are computed cumulatively against what has already gone
// out, so a work order's totals are exact however many milestones it has.
//
// Net is what the subcontractor actually receives now. It is derived, never
// stored independently: two numbers that should agree eventually will not.
export function releaseAmounts({ gross, priorGross = 0, retainageBps = 0, feeBps = 0 }) {
  const g = Math.round(gross || 0);
  const prior = Math.round(priorGross || 0);
  const retainage = cumulativeCut(prior, g, retainageBps);
  const fee = cumulativeCut(prior, g, feeBps);
  return { gross: g, retainage, fee, net: g - retainage - fee };
}

// Split a total into n parts that sum to exactly the total.
//
// Largest-remainder: every part gets the floor, and the leftover cents go
// one each to the parts with the biggest fractional loss. Three ways of
// $1,000 is 333.34 / 333.33 / 333.33, not three of 333.33 and a cent nobody
// owns. Used when somebody asks for "three equal milestones".
export function splitEven(total, n) {
  const t = Math.round(total || 0);
  const count = Math.max(1, Math.floor(n || 1));
  const base = floorDiv(t, count);
  const parts = new Array(count).fill(base);
  let left = t - base * count;
  for (let i = 0; left > 0; i++, left--) parts[i % count] += 1;
  for (let i = 0; left < 0; i++, left++) parts[i % count] -= 1;
  return parts;
}

// Do these milestones account for the whole work order?
//
// The invariant that keeps a work order honest: the parts sum to the whole.
// Without it a work order can be "fully verified" having released less than
// its value, and the missing money is invisible rather than wrong.
//
// A work order with no value -- an hourly one whose ceiling is not yet known
// -- is exempt rather than broken.
export function milestonesCover(milestones, valueCents) {
  if (valueCents == null) return { ok: true, reason: "no_value" };
  const sum = (milestones || []).reduce((n, m) => n + Math.round(m.amountCents || 0), 0);
  const want = Math.round(valueCents);
  if (sum === want) return { ok: true, sum, want };
  return { ok: false, sum, want, reason: sum < want ? "short" : "over", by: sum - want };
}

// What is still held back on a work order, and therefore what the final
// release owes once every milestone is verified.
export const heldBack = (releases = []) =>
  releases.reduce((n, r) => n + Math.round(r.retainage || 0), 0);
