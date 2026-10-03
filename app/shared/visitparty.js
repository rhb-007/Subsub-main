// WHO HAS TO AGREE TO AN APPOINTMENT, and who is being waited on.
//
// 019 built a visit as manager-proposes, tenant-confirms. The party who
// physically drives to the address was never asked -- so a time could be
// agreed between a manager and a tenant for a morning the crew was already on
// another roof, and the first anybody found out was nobody turning up.
//
// Up to two sides answer, and WHICH of them applies is decided per job rather
// than globally:
//
//   THE TENANT, only when `access` says they have to be in (060). That is the
//   "or just the subcontractor" half of the request -- a repair fixed from
//   outside does not need them, and asking anyway is the whole process this
//   product was told not to make people go through.
//
//   THE CONTRACTOR, only once somebody actually holds the work. A window
//   proposed before anybody is assigned has nobody to ask; the hiring side's
//   own panel already says so and offers the way to fix it.
//
// ONE FUNCTION, because the two sides reading different rules is how both
// screens come to say "waiting on them" and nothing moves -- which is why
// `waitingOn` is one function for an agreement, and the same reason here.

import { accessFor, needsTenantConfirm, canAskTenant } from "./access.js";

export const VISIT_PARTIES = {
  tenant: { id: "tenant", label: "the tenant", mine: "You" },
  contractor: { id: "contractor", label: "the contractor", mine: "You" },
  // 064. The hiring side, which 061 left out because it had no leg of its own
  // to answer with. They agree to their OWN proposal by making it; they have
  // agreed to nothing when the contractor comes back with a different time.
  manager: { id: "manager", label: "the hiring side", mine: "You" },
};

// AND THE ORDER THEY ARE ASKED IN, WHICH IS THE WHOLE OF 064.
//
// 061 asked everybody at once. That treats the contractor and the tenant as
// symmetric and they are not: the contractor has a diary full of other jobs
// and is the CONSTRAINT, while the tenant is one person who may book a morning
// off work to be in. Asking the tenant to confirm a window the contractor has
// not committed to risks asking them twice, and the second ask is the
// expensive one -- by then they have arranged to be home for a time that has
// just evaporated.
//
// So: the crew first, then the hiring side when the time is one they did not
// choose, then the person who has to open the door. Asked for in exactly those
// words, and the reasoning is why it is worth the extra hop.
export const PARTY_ORDER = ["contractor", "manager", "tenant"];

// Has this side answered yet? The tenant's answer has lived in `responded_at`
// since 019 and keeps that meaning -- giving the column a second one would
// make every row written before 061 ambiguous about who it was that replied.
const tenantSaid = (v) => !!(v?.respondedAt || v?.responded_at);
const contractorSaid = (v) => !!(v?.contractorAt || v?.contractor_at);
const managerSaid = (v) => !!(v?.managerAt || v?.manager_at);
const SAID = { tenant: tenantSaid, contractor: contractorSaid, manager: managerSaid };
export const partySaid = (visit, party) => !!SAID[party]?.(visit);

// WHO MUST AGREE TO THIS ONE.
//
// `tenantReported` and `hasContractor` are facts the SERVER holds -- a seat
// role and a live work order -- so they are passed in rather than guessed at.
// A screen that derived either would be a second opinion about whose answer is
// still outstanding.
export function visitParties(job, { tenantReported = false, hasContractor = false,
  hasManagerLeg = true } = {}) {
  const access = accessFor(job, { tenantReported });
  const who = [];
  if (hasContractor) who.push("contractor");
  // THE HIRING SIDE IS ALWAYS A PARTY once there is a column to record it in.
  // They are committing the money and are very often the one letting the crew
  // in, so a time they have not agreed to is not a time -- and because they
  // agree by proposing, the ordinary path costs them nothing: they drop out of
  // what is outstanding the moment the row is written.
  //
  // `hasManagerLeg` is the 064 column's ABSENCE, not a preference. On a
  // database that has not run it `manager_at` can never be set, so a party
  // that can never answer would leave every appointment waiting for ever --
  // which is strictly worse than the gap it reports. Same signal and same
  // reason as 061's own guard.
  if (hasManagerLeg) who.push("manager");
  // Whether to ask, and whether there is anybody to ask, are two questions --
  // see access.js. A job nobody reported has no tenant to confirm a window
  // with, whatever the column says.
  if (needsTenantConfirm(access) && canAskTenant(job)) who.push("tenant");
  return who;
}

// Who has not answered yet. Empty means everybody who had to has -- which is
// the moment the visit is settled, and the only thing that should write
// `confirmed`.
export function waitingOn(visit, parties) {
  if (!visit) return [];
  return (parties || []).filter((p) => !partySaid(visit, p));
}

// WHOSE TURN IT IS, WHICH IS NOT THE SAME AS WHO IS OUTSTANDING.
//
// `waitingOn` is everybody who has not answered; this is the ONE that may
// answer now. That difference is the feature: a tenant who is third in the
// chain is outstanding from the moment the window is proposed and must not be
// asked until the crew has said they can come.
//
// Ordered by `PARTY_ORDER` rather than by the order `visitParties` happens to
// build, so the chain cannot be reordered by an edit somewhere else.
export function nextToAnswer(visit, parties) {
  if (!visit) return null;
  const left = waitingOn(visit, parties);
  return PARTY_ORDER.find((p) => left.includes(p)) || null;
}

// May this side answer this window right now? Read by the route and by both
// screens, so a button cannot offer what the server refuses and the server
// cannot refuse what a screen was told to offer.
export const mayAnswer = (visit, parties, party) =>
  !!party && nextToAnswer(visit, parties) === party;

// A DECLINE FROM EITHER SIDE ENDS IT, and that is deliberate rather than a
// simplification. A time one party cannot make is not a time -- carrying on
// collecting the other party's answer would leave a window with a tick against
// it that nobody is attending, which is the worst of the three states this can
// be in because it reads as settled.
export const visitSettled = (visit, parties) =>
  visit?.status === "declined" ? "declined"
    : waitingOn(visit, parties).length === 0 ? "confirmed" : "proposed";

// The sentence, from the reader's own side. "Waiting on you" and "waiting on
// the tenant" are the same fact and completely different instructions, and a
// screen that says the second to somebody it means the first about is a screen
// nobody acts on.
export function waitingText(visit, parties, me) {
  const left = waitingOn(visit, parties);
  if (!left.length) return null;
  const mine = left.includes(me);
  const others = left.filter((p) => p !== me).map((p) => VISIT_PARTIES[p]?.label).filter(Boolean);
  if (mine && !others.length) return "Waiting on you to confirm.";
  if (mine) return `Waiting on you and ${others.join(" and ")}.`;
  return `Waiting on ${others.join(" and ")} to confirm.`;
}
