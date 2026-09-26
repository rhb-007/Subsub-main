// Who is allowed to turn auto-schedule on.
//
// Auto-schedule means a job the hiring account assigns is booked to the
// subcontractor's calendar as ACCEPTED, with no response window and no
// accept/decline buttons on their side. It is not a hint and it is not a
// default that can be argued with afterwards: the work is theirs the moment
// it is assigned.
//
// That makes it a commitment, and a commitment is not something the other
// party can hand themselves. A general contractor who could flip this on
// from their roster could fill somebody else's week without ever asking
// them -- and the subcontractor's portal would show the jobs already
// accepted, with nothing to press.
//
// So the switch splits on one question: IS THERE ANYBODY TO ASK?
//
//   A subcontractor with a portal -- a seat on the account, or their own
//   SubSub account -- can answer for themselves, so it is theirs to grant.
//   The hiring account may ask, and may always switch it back off.
//
//   A subcontractor with no portal is a record the hiring account typed.
//   Nobody is going to press accept because nobody is there; the response
//   window just expires and the job sits pending until somebody notices. For
//   that row auto-schedule is not a promise extracted from anyone, it is the
//   hiring account declining to wait for a reply that was never coming. They
//   set it directly.
//
// TURNING IT OFF IS ALWAYS ALLOWED, from either side. "Ask me first" takes
// nothing from anybody: the worst it costs is a round trip. Only the ON
// direction needs a consenting party, which is why `canSet` cares which way
// the switch is going and not just who is holding it.
//
// Imported by both the Worker and the browser. The Worker's copy is the one
// that decides -- the browser's is so the button matches what the server
// will do instead of failing after the tap.

// Why a subcontractor can answer for themselves. Either is enough.
export function hasPortal({ hasSeat = false, ownsAccount = false } = {}) {
  return !!(hasSeat || ownsAccount);
}

// The side making the request. "hiring" is the account that engaged them
// (admin or pm); "contractor" is the subcontractor themselves.
export const SIDES = ["hiring", "contractor"];

// The decision. Returns { ok } or { ok: false, reason }, where reason is a
// code the API returns and the browser looks up in AUTO_DENY_TEXT.
export function canSet({ side, on, portal }) {
  if (side !== "hiring" && side !== "contractor") return { ok: false, reason: "unknown_side" };
  // Off is nobody's to withhold.
  if (!on) return { ok: true };
  if (side === "contractor") return { ok: true };
  // Hiring side, turning on: only when there is nobody who could have
  // answered.
  return portal ? { ok: false, reason: "contractor_consent_required" } : { ok: true };
}

export const AUTO_DENY_TEXT = {
  contractor_consent_required:
    "Auto-schedule books jobs straight onto their calendar as accepted, so it is theirs to switch on. Ask them and they can do it from their own account.",
  unknown_side: "You cannot change auto-schedule from here.",
};

// What the card says, so the two sides read as one feature rather than two.
export function autoStateText({ on, portal, side = "hiring" }) {
  if (side === "contractor") {
    return on
      ? "On — jobs matching your availability are booked directly, no approval needed."
      : "Off — you review and accept or decline every job request.";
  }
  if (on) {
    return portal
      ? "On — they agreed to this. Jobs you assign are booked to their calendar immediately, with no response window."
      : "On — jobs you assign are scheduled immediately. Nobody accepts on their side, so tell them yourself.";
  }
  return portal
    ? "Off — every job you assign waits for them to accept or decline."
    : "Off — every job you assign sits pending until the response window runs out, and nobody is there to answer it.";
}
