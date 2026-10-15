// What Scale costs an account that keeps buildings.
//
// A general contractor and a subcontractor pay the flat $99 a month (or $990
// a year). A property manager, a portfolio manager and a building owner pay
// the same until their buildings hold more than UNIT_THRESHOLD units. Past
// that, the month is $1.25 for every OCCUPIED unit, never less than the flat
// $99, billed monthly only, with a one-time setup fee sized to the portfolio.
//
// One module, read by the Worker (checkout, the subscription sync, the
// billing read) and by the screens that quote the price, so the figure on a
// screen and the figure on the invoice cannot come from two rules.
//
// Units are counted over the buildings this account OPERATES. A building it
// owns and has appointed somebody else to run is billed to whoever runs it.

export const UNIT_PRICED_KINDS = ["property_manager", "portfolio_manager", "building_owner"];

export const UNIT_THRESHOLD = 80;          // more than this many units is per-unit
export const UNIT_PRICE_CENTS = 125;       // $1.25 per occupied unit, per month
export const MIN_MONTHLY_CENTS = 9900;     // never less than the flat $99

// The one-time setup fee, by the portfolio's TOTAL units when per-unit
// pricing starts. Each step doubles. Charged once per account: a portfolio
// that grows into a higher step later is not charged again.
export const SETUP_TIERS = [
  { upTo: 250, cents: 25000 },
  { upTo: 500, cents: 50000 },
  { upTo: 1000, cents: 100000 },
  { upTo: Infinity, cents: 200000 },
];

export const unitPriced = (kind) => UNIT_PRICED_KINDS.includes(kind || "");

const count = (v) => {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
};

// The setup step a portfolio of `units` falls in.
export function setupTierFor(units) {
  const n = Math.max(0, Math.floor(Number(units) || 0));
  const i = SETUP_TIERS.findIndex((t) => n <= t.upTo);
  const tier = SETUP_TIERS[i < 0 ? SETUP_TIERS.length - 1 : i];
  const from = i <= 0 ? 0 : SETUP_TIERS[i - 1].upTo + 1;
  return { ...tier, from, label: tier.upTo === Infinity
    ? `${from.toLocaleString("en-US")}+ units`
    : `${from.toLocaleString("en-US")}–${tier.upTo.toLocaleString("en-US")} units` };
}

// Totals over a list of buildings, each { units, occupiedUnits }.
//
// A building with no occupied count is counted as FULL, and said so. A blank
// cannot claim a vacancy, and counting it as empty would make leaving the box
// blank the cheapest answer -- which is the one answer that tells nobody
// anything. `unknown` is how many buildings that applied to, so the screen
// can name it rather than leave somebody wondering why the figure is higher
// than they expected.
export function portfolioUnits(buildings = []) {
  let total = 0, occupied = 0, unknown = 0;
  for (const b of buildings || []) {
    const units = count(b?.units) ?? 0;
    total += units;
    const occ = count(b?.occupiedUnits ?? b?.occupied_units);
    if (occ == null) { occupied += units; if (units > 0) unknown += 1; }
    else occupied += Math.min(occ, units);
  }
  return { total, occupied, unknown };
}

// The whole answer for one account: does per-unit pricing apply, what the
// month costs, and what the setup fee would be.
export function unitPricing(kind, buildings = []) {
  const { total, occupied, unknown } = portfolioUnits(buildings);
  const eligible = unitPriced(kind);
  const applies = eligible && total > UNIT_THRESHOLD;
  const perUnitCents = occupied * UNIT_PRICE_CENTS;
  const monthlyCents = applies ? Math.max(MIN_MONTHLY_CENTS, perUnitCents) : MIN_MONTHLY_CENTS;
  const tier = setupTierFor(total);
  return {
    eligible, applies, total, occupied, unknown,
    perUnitCents, monthlyCents,
    // Which Stripe line carries the month: the flat $99, or $1.25 x occupied.
    // Whichever is greater, so the bill is exactly monthlyCents.
    line: applies && perUnitCents >= MIN_MONTHLY_CENTS
      ? { kind: "unit", quantity: occupied }
      : { kind: "flat", quantity: 1 },
    setupCents: applies ? tier.cents : 0,
    setupLabel: applies ? tier.label : null,
    annualAllowed: !applies,
  };
}

// 086. WHAT THEY TOLD US AT SIGNUP. A property manager signing up has no
// buildings in SubSub yet, so without this a 500-unit portfolio would check
// out at the flat $99 -- or worse, $990 for a whole year -- on the day it
// joined, and the per-unit price would only arrive once somebody had typed in
// every building. So the signup form asks for the units and the occupied
// count, and the account is priced on that answer.
//
// ONLY UNTIL A BUILDING CARRIES UNITS. From the first building with a unit
// count on it, the buildings decide, which is the rule every bill after that
// follows. Deliberately not "until the buildings add up to it": an estimate
// somebody over-guessed would then bill them for units they do not have, with
// nothing on the screen they could change to stop it. The cost is the other
// direction -- a portfolio half typed in is billed on the half -- and that one
// favours the customer.
export const ESTIMATE_MAX_UNITS = 100000;

// The answer from the form, checked. Blank is null (they did not say, and the
// buildings will decide); anything else must be whole numbers, with no more
// occupied than there are units. A blank occupied count is counted as full,
// which is the rule for a building too.
export function validEstimate(v) {
  if (v == null || v === "" || (typeof v === "object" && (v.total === "" || v.total == null))) {
    return { estimate: null };
  }
  if (typeof v !== "object") return { error: "invalid_units" };
  const whole = (x) => typeof x === "number" ? x : (String(x).trim() === "" ? NaN : Number(x));
  const total = whole(v.total);
  if (!Number.isInteger(total) || total < 0 || total > ESTIMATE_MAX_UNITS) return { error: "invalid_units" };
  let occupied = null;
  if (v.occupied !== undefined && v.occupied !== null && String(v.occupied).trim() !== "") {
    occupied = whole(v.occupied);
    if (!Number.isInteger(occupied) || occupied < 0) return { error: "invalid_units" };
    if (occupied > total) return { error: "occupied_over_units" };
  }
  return { estimate: { total, occupied } };
}

// Which rows price this account: the buildings, or the signup estimate while
// no building carries a unit count.
export function pricingRows(buildings = [], estimate = null) {
  const typed = portfolioUnits(buildings).total;
  if (typed > 0 || !estimate || !(Number(estimate.total) > 0)) return { rows: buildings || [], fromEstimate: false };
  return { rows: [{ units: estimate.total, occupiedUnits: estimate.occupied ?? "" }], fromEstimate: true };
}

const usd = (cents) => `$${(cents / 100).toLocaleString("en-US",
  { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

// The rule in words, for the plan card and the pricing page. One sentence per
// part, read off the constants above so a screen cannot quote another price.
export function unitTermsText() {
  const tiers = SETUP_TIERS.map((t, i) => {
    const from = i === 0 ? 0 : SETUP_TIERS[i - 1].upTo + 1;
    return t.upTo === Infinity
      ? `${usd(t.cents)} above ${SETUP_TIERS[i - 1].upTo.toLocaleString("en-US")}`
      : `${usd(t.cents)} for ${from === 0 ? "up to " : `${from.toLocaleString("en-US")}–`}${t.upTo.toLocaleString("en-US")}`;
  });
  return {
    threshold: `Up to ${UNIT_THRESHOLD} units: ${usd(MIN_MONTHLY_CENTS)} a month.`,
    perUnit: `Over ${UNIT_THRESHOLD} units: ${usd(UNIT_PRICE_CENTS)} per occupied unit a month, never less than ${usd(MIN_MONTHLY_CENTS)}, billed monthly.`,
    setup: `One-time setup fee over ${UNIT_THRESHOLD} units, by total units: ${tiers.join(", ")}.`,
  };
}

export const formatUsd = usd;
