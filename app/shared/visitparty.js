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
};

// Has this side answered yet? The tenant's answer has lived in `responded_at`
// since 019 and keeps that meaning -- giving the column a second one would
// make every row written before 061 ambiguous about who it was that replied.
const tenantSaid = (v) => !!(v?.respondedAt || v?.responded_at);
const contractorSaid = (v) => !!(v?.contractorAt || v?.contractor_at);

// WHO MUST AGREE TO THIS ONE.
//
// `tenantReported` and `hasContractor` are facts the SERVER holds -- a seat
// role and a live work order -- so they are passed in rather than guessed at.
// A screen that derived either would be a second opinion about whose answer is
// still outstanding.
export function visitParties(job, { tenantReported = false, hasContractor = false } = {}) {
  const access = accessFor(job, { tenantReported });
  const who = [];
  // Whether to ask, and whether there is anybody to ask, are two questions --
  // see access.js. A job nobody reported has no tenant to confirm a window
  // with, whatever the column says.
  if (needsTenantConfirm(access) && canAskTenant(job)) who.push("tenant");
  if (hasContractor) who.push("contractor");
  return who;
}

// Who has not answered yet. Empty means everybody who had to has -- which is
// the moment the visit is settled, and the only thing that should write
// `confirmed`.
export function waitingOn(visit, parties) {
  if (!visit) return [];
  return (parties || []).filter((p) =>
    p === "tenant" ? !tenantSaid(visit) : !contractorSaid(visit));
}

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
