// A second business on one login (099).
//
// A general contractor that also manages buildings is two businesses, and
// SubSub keeps them as two accounts rather than one hybrid: the account kind
// decides the roster's word, the agreement's party names, whether there are
// buildings and tenants, whether a handyman can be engaged, whether the
// company can be hired, and the price. A third kind answering all of those
// at once has no sensible answer to several of them.
//
// So the pair is LINKED: one person is admin on both, the management side
// is connected to the construction side's company (so it can send its own
// buildings' work there with a real work order), and the cheaper of the two
// is LINKED_DISCOUNT_PERCENT off while the other one pays.
//
// One module, read by the Worker (creating the pair, the discount sync, the
// billing read) and by the screens that quote it, so the screen and the
// invoice cannot follow two rules.

import { unitPriced } from "./unitpricing.js";

export const LINKED_DISCOUNT_PERCENT = 50;
// The Stripe coupon that carries it. A fixed id, so every linked account is
// on the same coupon and it is created once, not once per account.
export const LINKED_COUPON_ID = "subsub-linked-business-50";

// The kinds that keep buildings (the management side).
const MANAGES = ["property_manager", "portfolio_manager", "building_owner"];
// The kinds that do the work and can be hired (the construction side).
const BUILDS = ["general_contractor", "subcontractor"];

export const managesBuildings = (kind) => MANAGES.includes(kind || "");
export const buildsForHire = (kind) => BUILDS.includes(kind || "");

// What a second business may be, given the first one's kind. Always the
// OTHER side: two general contractors are two companies that should each sign
// up, and pairing them would discount a business for being owned by somebody
// who owns another one like it.
export function secondKinds(kind) {
  if (buildsForHire(kind)) return [...MANAGES];
  if (managesBuildings(kind)) return [...BUILDS];
  return [];
}

// Why a pair of kinds cannot be linked, or null.
export function linkRefusal(fromKind, toKind) {
  if (!secondKinds(fromKind).length) return "not_linkable";
  if (!secondKinds(fromKind).includes(toKind)) return "same_side";
  return null;
}

// Which of the two (each { id, kind, paying, monthlyCents, second }) gets the
// discount, or null.
//
// ONLY WHILE BOTH PAY. The discount is for running two businesses on SubSub,
// so it needs two paying subscriptions: with one on Basic, or comped, there is
// nothing to discount against.
//
// THE CHEAPER ONE, by its own month: usually the construction side, which is
// the flat $99 where the management side is $1.25 per occupied unit and never
// less than $99. A tie goes to the side that is not unit-priced (a general
// contractor at $99 beside a property manager under 80 units), then to the
// business added second.
export function discountTarget(a, b) {
  if (!a || !b || !a.paying || !b.paying) return null;
  const ma = Number(a.monthlyCents) || 0, mb = Number(b.monthlyCents) || 0;
  if (ma !== mb) return ma < mb ? a.id : b.id;
  const ua = unitPriced(a.kind), ub = unitPriced(b.kind);
  if (ua !== ub) return ua ? b.id : a.id;
  return a.second ? a.id : b.id;
}

// What the discount takes off a month, in whole cents.
export const discountedCents = (cents) =>
  Math.round((Number(cents) || 0) * (100 - LINKED_DISCOUNT_PERCENT) / 100);
