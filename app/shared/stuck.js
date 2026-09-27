// Subcontractors who were asked to join and never arrived.
//
// A subcontractor on a roster and a subcontractor who can SIGN IN are two
// different rows, and the gap between them is invisible from every screen that
// exists. A `companies` row plus an `engagements` row is what an account gets
// the moment it adds or invites somebody -- that is what the Contractors screen
// draws. A login is a `users` row plus a `memberships` row with role
// 'contractor', and it is only written when somebody opens the invite link and
// fills the form in. So an account can have a roster of ten and nine of them
// cannot get in, and nothing says so.
//
// That gap cost a real afternoon: a roofer invited by a property manager, told
// on the sign-in page that a reset link was coming, with no account behind the
// address to reset and no screen anywhere showing they were stuck. Staff could
// not see it either, because the console reads accounts and their own users and
// has never carried sub invites at all.
//
// Shared with the tests so "what counts as stuck" has one answer.

// In the order staff should work them: the ones where SubSub itself is at
// fault come first, because those are not the customer's to chase.
export const STAGES = [
  ["send_failed", "Email failed",
    "SubSub tried and the send failed. Ours to fix, not theirs to chase."],
  ["never_sent", "Never sent",
    "No send was ever attempted — either the invite carries no address, or mail is not configured."],
  ["invite_expired", "Invite expired",
    "The link has lapsed. Resend is refused by design; this one needs re-issuing."],
  ["invite_open", "Waiting on them",
    "Sent, still valid, not opened yet."],
  ["no_login", "On the roster, no login",
    "Engaged as a company with no seat behind it. Nobody can sign in as them."],
  ["never_signed_in", "Seat made, never used",
    "A login exists and has never been signed in to."],
];

export const STAGE_LABEL = Object.fromEntries(STAGES.map(([k, label]) => [k, label]));
export const STAGE_NOTE = Object.fromEntries(STAGES.map(([k, , note]) => [k, note]));
const ORDER = Object.fromEntries(STAGES.map(([k], i) => [k, i]));

// Ours or theirs. The distinction is the point of the screen: an invite nobody
// has opened is a customer nudging a contractor, while a send that failed is
// SubSub owing somebody an email.
export const OURS = new Set(["send_failed", "never_sent"]);
export const isOurs = (stage) => OURS.has(stage);

export function inviteStage(invite = {}, { now } = {}) {
  if (invite.usedAt) return null;                 // arrived; not stuck
  if (invite.revokedAt) return null;              // withdrawn on purpose
  const today = now ? new Date(now) : new Date();
  if (invite.expiresAt && new Date(invite.expiresAt) < today) return "invite_expired";
  // A link made to hand over in person has no address and no failure -- it was
  // never going to be emailed. Same shape as a send that never happened,
  // because from the outside both are "nothing has gone anywhere".
  if (!invite.sentAt) return "never_sent";
  if (invite.lastEmail && invite.lastEmail.status === "failed") return "send_failed";
  return "invite_open";
}

// A row is only worth showing once. An invite and a roster entry for the same
// company are the same person stuck in the same place, and listing both reads
// as two problems.
export const rowKey = (r) =>
  `${r.accountId}:${(r.email || "").toLowerCase() || r.companyId || r.inviteId}`;

export function dedupe(rows = []) {
  const seen = new Map();
  for (const r of rows) {
    const k = rowKey(r);
    const had = seen.get(k);
    // Keep whichever is further left in STAGES: the more actionable reading of
    // the same person.
    if (!had || ORDER[r.stage] < ORDER[had.stage]) seen.set(k, r);
  }
  return [...seen.values()];
}

// Ours first, then oldest first inside each stage -- somebody stuck for three
// weeks is worse than somebody stuck since this morning, and a list ordered by
// account name buries them.
export function rank(rows = []) {
  return [...rows].sort((a, b) =>
    (isOurs(b.stage) ? 1 : 0) - (isOurs(a.stage) ? 1 : 0)
    || (ORDER[a.stage] ?? 99) - (ORDER[b.stage] ?? 99)
    || String(a.since || "").localeCompare(String(b.since || ""))
    || String(a.company || "").localeCompare(String(b.company || "")));
}

export function summarise(rows = []) {
  const byStage = {};
  for (const r of rows) byStage[r.stage] = (byStage[r.stage] || 0) + 1;
  return {
    total: rows.length,
    ours: rows.filter((r) => isOurs(r.stage)).length,
    accounts: new Set(rows.map((r) => r.accountId)).size,
    byStage,
  };
}
