// Moving a building between accounts.
//
// A building owner invited onto their property manager's account is a guest
// there. Fire the manager and, until this existed, they lost the building, its
// job history, its certificates and their own view of all three -- and could
// not even let themselves out, because the person they were leaving held the
// only button. "What happens to my building if I change agent" had a bad
// answer, and it is the same question a manager asks before putting a
// portfolio in here.
//
// TWO-PARTY, ALWAYS. One side asks, the other agrees. Neither can move a
// building alone, which is the same shape as completion (marked by one side,
// verified by the other) and connect (asked for, accepted) — and for the same
// reason: the thing being changed belongs to both of them.
//
// THE MANAGER KEEPS THEIR RECORD, and not by copying anything. A handover moves
// the PROPERTY and leaves the JOBS where they happened -- jobs.account_id is
// untouched -- so the outgoing manager still holds every job they ran, and the
// owner can read the whole history of their building across however many
// managers it has had. Nothing is duplicated, and nothing is deleted to
// satisfy a departing client. That last part is not a courtesy: a job the
// manager ran is a job the manager may later be asked to account for.
//
// WHAT DOES NOT FOLLOW THE BUILDING is the manager's contractor roster. Those
// are the manager's own relationships, built over years, and handing them to a
// departing client is precisely the accumulation this product refuses
// elsewhere. The owner gets their building and its history; they do not get
// their ex-manager's book.

// Who is asking. An owner wanting their building back and a manager resigning
// an instruction end in the same place, and the audit should not have to guess
// which happened.
export const DIRECTIONS = ["owner_requested", "manager_offered"];
// A handover gives the building to its owner. An appointment gives operation of
// it to a manager the owner chose. Same table, same two-party rule, opposite
// travel.
export const KINDS = ["handover", "appointment"];
export const STATUSES = ["pending", "accepted", "declined", "cancelled"];

// Can this building be handed to its owner at all?
//
// `property` carries accountId (who operates it) and ownerAccountId (who owns
// it). `ownerAccountId` being absent means nobody has claimed it, which is the
// ordinary state of a building a manager typed in.
export function canHandOver(property = {}, { ownerAccountId } = {}) {
  const owner = ownerAccountId || property.ownerAccountId;
  if (!owner) return { ok: false, reason: "no_owner_account" };
  if (owner === property.accountId) return { ok: false, reason: "already_theirs" };
  return { ok: true };
}

// Whose agreement is outstanding on a pending request.
//
// The side that asked has already agreed by asking, so it is always the OTHER
// side that decides. One rule, from the account that raised it.
//
// Written this way after the first version inferred the requester from
// `direction`, which does not survive both kinds: on a handover the owner is
// the `to` side, and on an appointment the owner is the `from` side. Any rule
// phrased in owner/manager terms therefore points at the requester for one of
// them, and a requester who can also approve moves a building alone -- the one
// thing this must never allow. The requesting account is recorded on the row
// instead, so there is nothing to infer.
export function awaitingFrom(transfer = {}) {
  if (transfer.status !== "pending") return null;
  const asked = transfer.requestedByAccountId;
  if (!asked) return null;
  if (asked === transfer.fromAccountId) return transfer.toAccountId;
  if (asked === transfer.toAccountId) return transfer.fromAccountId;
  return null;
}

// May this account decide this request?
export function canDecide(transfer = {}, accountId) {
  const waiting = awaitingFrom(transfer);
  return !!waiting && waiting === accountId;
}

// May this account withdraw it? Only whoever raised it.
export function canCancel(transfer = {}, accountId) {
  if (transfer.status !== "pending") return false;
  return !!transfer.requestedByAccountId && transfer.requestedByAccountId === accountId;
}

// What the two sides are told. Deliberately different text: the same event is
// a client leaving and an instruction ending, and pretending otherwise makes
// both messages vague.
export function transferText(transfer = {}, side) {
  const asked = transfer.direction === "owner_requested" ? "owner" : "manager";
  if (transfer.status === "accepted") {
    return side === "owner"
      ? "This building is yours now. The jobs run before the handover stay on your manager's record, and you can still read them."
      : "Handed over. Every job you ran stays on your record and nothing has been deleted.";
  }
  if (transfer.status === "declined") {
    return side === "owner"
      ? "Your manager has not agreed to hand this building over."
      : "You declined this handover.";
  }
  if (transfer.status === "cancelled") return "Withdrawn.";
  if (asked === "owner") {
    return side === "owner"
      ? "Waiting on your property manager to release this building."
      : "Your client has asked to take this building over.";
  }
  return side === "owner"
    ? "Your property manager has offered to hand this building over to you."
    : "Waiting on the owner to accept.";
}

// What moves, and what does not. Written down because it is the whole design
// and because the tempting shortcut -- moving the jobs too -- destroys the
// outgoing manager's record.
export const MOVES = ["the property row", "who operates it", "tenants at the building"];
export const STAYS = [
  "jobs, and every work order, completion and release under them",
  "the manager's contractor roster and their engagements",
  "documents the manager verified, which belong to the contractor anyway",
];

// ---- Work that is still in flight when the building moves ----------------
//
// The gap this closes: jobs do not move, so a building could change hands with
// a repair half done and the incoming manager saw NOTHING. No sign that a
// contractor was coming Tuesday, nobody to let them in, nobody to verify the
// work, and a tenant waiting on a leak that the new manager had never heard
// of. The contractor turns up at a building whose manager has no record of
// them. That is the worst moment this product can produce, and it happened
// silently.
//
// The fix is NOT to move the jobs. The outgoing manager issued the work order,
// owes the money and is the party the contractor has an agreement with -- and
// moving them would hand a departing client their ex-manager's book, which is
// the accumulation refused everywhere else here.
//
// So the incoming manager gets the same shape the lien-waiver roll-up uses: a
// COUNT, A TRADE AND A DATE, never a list of who. Enough to run the building
// -- do not double-book the roof, let somebody in on Tuesday, tell the tenant
// their leak is being dealt with -- and nothing that is a lead.

// A job still in flight is one nobody has finished and nobody has called off.
// `completed` is the end state; a withdrawn or declined request never started.
export function isOpenWork(job = {}) {
  if (job.status === "completed") return false;
  if (job.withdrawnAt || job.declinedAt) return false;
  return true;
}

// What the incoming operator may see of one job the previous one is running.
//
// Everything here is about the BUILDING: what is wrong, when somebody is due,
// whether anybody is coming at all. Everything withheld is about the previous
// manager's RELATIONSHIP and their CONTRACT: which company, for how much,
// against which work order, with which crew. The new manager has neither, and
// being handed them is not a side effect of taking on a building.
export function inheritedShape(job = {}, previousManager = null) {
  const booked = Object.keys(job.assignments || {});
  return {
    id: job.id, title: job.title, propertyId: job.propertyId,
    address: job.address || null, area: job.area || null, zip: job.zip || null,
    date: job.date || null, time: job.time || null,
    // What is wrong with the building, which is theirs to know now.
    trades: job.trades || [], scope: job.scope || null, severity: job.severity || null,
    reportDetail: job.reportDetail || null, photos: job.photos || [],
    status: job.status, createdAt: job.createdAt || null,
    // Somebody IS coming for these trades. Who, for how much, and on whose
    // work order are the previous manager's business -- so this is the trade
    // and nothing else, and there is no assignments object to read through.
    bookedTrades: booked,
    // Empty, not absent. Every screen in the app assumes a job HAS an
    // assignments object -- `j.trades.filter((t) => j.assignments[t])` in a
    // dozen places -- and handing it one without crashed the jobs list
    // outright. Empty is also the honest answer: THIS account has assigned
    // nobody, and who the previous manager assigned is not in here.
    assignments: {},
    // The tenant who reported it is this account's tenant now, so their name
    // is not somebody else's to withhold.
    ...(job.requestedByName ? { requestedByName: job.requestedByName } : {}),
    previousManager,
    inherited: true, readOnly: true,
  };
}

// The one line each side needs at the moment of transfer, so neither walks
// away assuming the other picked it up. Silence here is how a repair gets
// dropped between two companies that both thought it was handled.
export function openWorkText(n, side) {
  if (!n) return side === "incoming"
    ? "Nothing is outstanding at this building."
    : "You have no open work at this building.";
  const what = n === 1 ? "1 open repair" : `${n} open repairs`;
  return side === "incoming"
    ? `${what} at this building ${n === 1 ? "is" : "are"} being finished by the previous manager. `
      + "You can see what and when, but it stays theirs to complete and to pay."
    : `${what} at this building ${n === 1 ? "stays" : "stay"} yours to finish. `
      + "The new manager can see that it is outstanding, not who is doing it.";
}
