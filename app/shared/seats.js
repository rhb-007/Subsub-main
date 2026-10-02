// Which seat to open an account as, when staff press "Sign in as this
// account" without naming one.
//
// IT USED TO BE `role = 'admin'` AND NOTHING ELSE, which stranded exactly the
// accounts staff most need to look at. Reported from the console on an account
// whose header read "1 Team users" over the message "That account has nobody
// on it to sign in as" -- two queries disagreeing about the same account, in
// front of somebody who could see both.
//
// They disagree because they ask different questions. The KPI counts
// `memberships WHERE role <> 'contractor'`, so a project manager counts; the
// impersonation route wanted an admin. And an account can genuinely have no
// admin: the console's account INSERT only writes one when it is given an
// owner email, and the console's add-user defaults to `pm`. So an account
// created without an owner address and then given one user is exactly this
// state -- and nobody could get into it to find out.
//
// The route has always accepted a named `userId` for ANY role, deliberately,
// so support can see what a subcontractor sees. Restricting the DEFAULT to
// admin therefore gated nothing: it only decided what happened when nobody
// said. Preferring an admin and falling back is the same access with a better
// answer.

// Most able to least. An admin sees the whole account, which is what somebody
// pressing that button is asking for. A pm is the next most complete view of
// the account's own work. Owner and tenant are guest seats scoped to named
// buildings, and a contractor seat is a different app entirely -- all three
// are a long way from "the account", so they are last and the caller is told
// which one it landed on.
export const SEAT_ORDER = ["admin", "pm", "owner", "tenant", "contractor"];

export const seatRank = (role) => {
  const i = SEAT_ORDER.indexOf(role);
  // An unknown role sorts last rather than first. A seat nobody recognises is
  // the worst guess at "the account", and ranking it 0 would make it the
  // default the day a new role is added -- silently.
  return i < 0 ? SEAT_ORDER.length : i;
};

// The seat to open, or null when there is genuinely nobody. Rows may be the
// Worker's (`user_id`, `role`) or the browser's (`userId`, `role`); both call
// this, and a conversion to forget at one call site is a conversion that reads
// as "no seats".
export function pickSeat(rows = []) {
  const live = (rows || []).filter((r) => r && (r.user_id || r.userId));
  if (!live.length) return null;
  return [...live].sort((a, b) => seatRank(a.role) - seatRank(b.role)
    // Stable beyond the rank, so one account gives one answer rather than two.
    || String(a.user_id || a.userId).localeCompare(String(b.user_id || b.userId)))[0];
}

// Whether the account can actually be run by the people on it. An account
// whose only seat is a pm cannot reach users, billing or branding, which is a
// real problem for the CUSTOMER rather than only for support -- and nothing
// anywhere said so.
export const hasAdminSeat = (rows = []) => (rows || []).some((r) => r && r.role === "admin");

// WHO IS ON THE TEAM, as opposed to who merely holds a seat here.
//
// `memberships WHERE role <> 'contractor'` is NOT the team, and the console's
// Team panel has filtered that way since it was written: a building owner
// invited onto a managing agent's account, and a tenant of one of its
// buildings, both pass it. They are guests — scoped to named buildings,
// there to watch their own property or report a leak — and the account they
// are guests ON belongs to somebody else.
//
// That matters the moment a role becomes editable. Promoting a guest is not a
// smaller version of promoting a project manager: it hands a client, or a
// tenant, admin of their agent's whole business — every other building, every
// contractor on the roster, the billing. A contractor seat was already
// refused for exactly this reason and the other two were missed, because the
// panel they appear on is called Team.
export const TEAM_ROLES = ["admin", "pm"];
export const isTeamSeat = (role) => TEAM_ROLES.includes(role);

// WHEN A STAFF SESSION STANDS IN FOR AN ADMIN THE ACCOUNT HAS NOT GOT.
//
// `pickSeat` made an admin-less account OPENABLE. It did not make it usable,
// and the difference is the whole of this. Landing in the pm seat it picked,
// the console's own banner has to explain that Account, billing and branding
// are gone -- and the screens that remain are quietly wrong in the same
// direction: `runsTheAccount` is false, so a property opens with no vendor
// list, no Edit, no owners panel and one sentence telling the manager to add
// an owner who will appoint a manager, which is the opposite of what a
// managing agent is looking at it for. Reported as exactly that: "it says
// assign someone to manage it -- the admin should be able to access
// everything within this account".
//
// There is nobody inside the account who can fix it either: every door to
// granting the admin role is requireRole("admin"), which this file already
// records. So the one seat that could repair it is the staff one, and it was
// the seat being refused.
//
// Two conditions, and both are load-bearing.
//
// A TEAM SEAT, never a guest. An owner or a tenant on somebody's account is
// their client, and standing in their seat is how support sees what a client
// sees -- the same rule `isTeamSeat` carries for the role control, reused
// rather than restated. A contractor seat is a different app again.
//
// NO ADMIN ANYWHERE ON THE ACCOUNT. On an account that has one, nothing is
// widened: staff who name a pm seat get a pm's view, so reproducing "a
// project manager cannot see X" stays possible, which is the reason naming a
// seat was added in the first place.
//
// It is deliberately NOT conditional on whether a seat was named, and that is
// a trade rather than an oversight: the session row records which seat, not
// how it was chosen, and adding a column to tell the two apart would buy the
// ability to reproduce a pm's view on an account where a pm's view and the
// account's view are already the same thing. Nothing distinct is lost.
//
// What it does NOT do is change the account. The membership still says pm,
// because that is true of the PERSON, whose role and buildings are theirs;
// what is replaced is who is sitting in the seat, for thirty minutes, in a
// row staff can be held to. Promoting somebody for real is a separate,
// explicit act with its own route.
export const staffStandsIn = (role, seats = []) =>
  isTeamSeat(role) && !hasAdminSeat(seats);

// MAY THIS CALLER WRITE A COMPANY ROW SOMEBODY ELSE ANSWERS FOR?
//
// `companyAnswersForItself` is deliberately unscoped and the reason is
// recorded at length: `companies` is a shared row, so "I have them on my
// roster" is enough to correct a record I typed in myself and is NOT enough to
// rewrite a business that has its own people. That rule is right and does not
// move.
//
// What it was never meant to refuse is SUPPORT. A staff member standing in an
// account is not another hiring account trying to overwrite somebody's
// business: they are the one party who can fix a record while the customer is
// on the telephone, and this project has already written down what the
// alternative is -- *"The only remaining remedy was SQL against D1, which is
// the answer this file refuses everywhere else."*
//
// Three things make it safe, and all three are load-bearing:
//
//   IT READS `impersonatedBy`, WHICH IS SET FROM THE SESSION ROW and never
//   from a header. The caller names a token, never an identity, so there is
//   nothing a customer can send to claim this. The row expires, and ending it
//   stops this working on the next request.
//
//   IT IS A TEAM SEAT ONLY. Staff sitting in a tenant's or a contractor's seat
//   are there to see what that person sees, and widening those would make
//   "reproduce the customer's view" impossible -- which is the entire reason
//   naming a seat exists.
//
//   AND IT IS NOT A SILENT POWER. The route that reads this records who really
//   wrote the row, because the banner over the whole screen promises that
//   actions are recorded and a promise the product does not keep is worse than
//   one it never made.
//
// The field this reads has existed since impersonation shipped, with a comment
// saying nothing read it yet and that it was set because *a session whose real
// actor is unrecoverable is the one thing this table exists to prevent*. This
// is it being spent.
export const staffMayWriteShared = (ctx) =>
  !!ctx && !!ctx.impersonatedBy && isTeamSeat(ctx.role);
