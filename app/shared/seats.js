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
