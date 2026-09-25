// Whether a chain of lien waivers is clear, and through when.
//
// Two ideas do all the work here, and both are easy to get wrong.
//
// THROUGH A DATE. A waiver covers work up to a date and no further. Material
// delivered the next morning is not covered. So nothing in here answers
// "clear" -- everything answers "clear through the 20th", and a chain
// re-opens as work continues. A green tick with no date against it is a lie
// waiting to happen.
//
// A STATUS, NOT A ROSTER. A general contractor is entitled to know their
// subcontractor's chain is clear. They are not entitled to the
// subcontractor's supplier list, which is that subcontractor's book -- their
// sources and, by inference, their margins. So the roll-up counts and dates
// and never names, and the shape of what comes back is what stops somebody
// rendering the list by accident.
//
// Shared by the Worker and the browser so a badge on screen and a decision
// about releasing money cannot disagree.

export const WAIVER_KINDS = [
  "conditional_progress", "unconditional_progress",
  "conditional_final", "unconditional_final",
];
export const SCOPE_KINDS = ["labor_only", "labor_materials", "materials_only"];

// Does this party have anybody below them worth asking about?
//
// Labour only means nobody: the hiring account bought the materials, which
// is how a great deal of this work is actually done. That is a DECLARATION
// and not an absence -- "I furnished labour only, no materials or
// equipment" is a thing somebody signs, and it is what makes skipping the
// chain safe rather than merely convenient.
//
// Even then it is only the usual case, never a guarantee: a labour-only
// subcontractor can still have subbed part of the labour out. So a declared
// party always counts, whatever the scope says.
export function needsLowerTier(scopeKind, declaredCount = 0) {
  if (declaredCount > 0) return true;
  return scopeKind !== "labor_only";
}

// ISO day strings compare correctly as strings; no Date, no timezone, no
// midnight-in-another-zone bug.
const covers = (throughDate, asOf) => !!throughDate && !!asOf && throughDate >= asOf;

// The roll-up.
//
//   root      the tier-0 waiver -- the contractor signing to the account
//   children  everything declared below them, at any tier
//   asOf      the day the answer is being asked about, usually the day
//             money is about to move
//
// Returns counts, the earliest date the whole chain covers, and WHY it is
// not clear when it is not -- by reason, never by naming anybody.
export function chainStatus({ root, children = [], asOf, scopeKind, declaredCount = 0 }) {
  const reasons = [];
  const signed = (w) => w && w.status === "signed";

  if (!root) reasons.push("no_waiver");
  else if (!signed(root)) reasons.push(root.status === "declined" ? "declined" : "unsigned");
  else if (!covers(root.throughDate, asOf)) reasons.push("stale");

  const wanted = needsLowerTier(scopeKind ?? root?.scopeKind, declaredCount);
  const kids = children || [];
  const kidsSigned = kids.filter((w) => signed(w) && covers(w.throughDate, asOf));

  // Declared but never asked is its own answer, and a different one from
  // asked and refused.
  if (wanted) {
    if (declaredCount > kids.length) reasons.push("not_requested");
    if (kids.some((w) => w.status === "declined")) reasons.push("lower_tier_declined");
    if (kidsSigned.length < kids.length) reasons.push("lower_tier_outstanding");
    // Nobody declared and nobody exempted: the question has not been asked.
    if (!kids.length && !declaredCount) reasons.push("no_declaration");
  }

  // The chain covers only as far as its shortest link.
  const dates = [root, ...kidsSigned].filter((w) => signed(w) && w.throughDate).map((w) => w.throughDate);
  const through = dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : null;

  return {
    clear: reasons.length === 0,
    reasons,
    through,
    // Counts, not names. Deliberately.
    lowerTierSigned: kidsSigned.length,
    lowerTierTotal: Math.max(kids.length, declaredCount),
    laborOnly: (scopeKind ?? root?.scopeKind) === "labor_only" && declaredCount === 0,
  };
}

// What to say about a chain, in words, without naming anybody.
export function chainReasonText(reason) {
  return {
    no_waiver: "No waiver has been requested yet.",
    unsigned: "Waiver requested and not signed yet.",
    declined: "They declined to sign.",
    stale: "The waiver on file does not cover work this recent.",
    no_declaration: "They have not said who supplied this job.",
    not_requested: "Somebody they named has not been asked yet.",
    lower_tier_outstanding: "Somebody below them has not signed yet.",
    lower_tier_declined: "Somebody below them declined.",
  }[reason] || "Something on this chain is outstanding.";
}

// Which waiver belongs at which point in a release's life. Conditional
// before the money, unconditional after it clears -- and "final" once this
// is the last release on the work order.
export const waiverKindFor = ({ settled, isFinal }) =>
  `${settled ? "unconditional" : "conditional"}_${isFinal ? "final" : "progress"}`;
