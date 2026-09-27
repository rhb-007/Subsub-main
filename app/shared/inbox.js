// One page for every pack a person has been sent.
//
// A general contractor asked three subcontractors for paperwork and got three
// unrelated links. The value of those links grows with every new one and
// nothing added them up -- so the person with the most reason to want SubSub
// had the least reason to notice it existed.
//
// This is the demand side of the loop, and the only half that pulls: the
// subcontractors do the data entry, the recipient accumulates a roster they
// did not build, and claiming it lands them in an account already populated.
//
// Imported by the Worker and the browser so both agree on what an inbox shows
// and what reaching one costs.

// Shorter than SHARE_DAYS on purpose. A share is one document somebody was
// sent; this is a key to everything they have ever been sent, so it earns a
// tighter window.
export const INBOX_DAYS = 3;

// How many inbox links one address may ask for in an hour. The request names
// no address -- it is read off the share -- so this bounds somebody hammering
// a token they hold, not enumeration.
export const INBOX_ASKS_PER_HOUR = 5;

// Reaching an inbox costs a second email, and this is why.
//
// A share token proves somebody holds one link that was emailed to an address.
// It does NOT prove they control that address now. Certificates get forwarded
// -- that is most of what they are for -- and without this step a forwarded
// link would open every pack ever sent to the person who forwarded it.
//
// So the flow is: hold a share token, ask, and the link goes to the address on
// the share. Nothing in the request may name an address, because an endpoint
// that takes one is an endpoint that mails anybody's inbox to anybody.
export const WHY_SECOND_EMAIL =
  "A forwarded share would otherwise open every pack ever sent to the forwarder.";

export function inboxState(row = {}, now = new Date()) {
  if (!row || !row.token) return "unknown";
  if (row.revokedAt) return "revoked";
  if (row.claimedAt) return "claimed";
  const ends = Date.parse(String(row.expiresAt || "").replace(" ", "T") + "Z");
  if (Number.isFinite(ends) && ends < now.getTime()) return "expired";
  return "active";
}

export const inboxUsable = (row, now) => inboxState(row, now) === "active";

// What an inbox shows about one subcontractor.
//
// The same shape the pack page already serves, because it IS the pack page's
// content -- nothing new crosses. What the inbox adds is that they are in one
// list with one expiry to watch, which is the whole product in miniature.
//
// Deliberately absent: anything about who ELSE that subcontractor works for.
// A recipient learning "Ridge Roofing also sends packs to four other
// contractors" would be reading Ridge's client list, which is the accumulation
// this product refuses everywhere.
export function inboxRow(share = {}, docs = []) {
  return {
    token: share.token,
    company: share.company,
    contact: share.contact || null,
    where: share.where || null,
    sentAt: share.createdAt || null,
    expiresAt: share.expiresAt || null,
    docs: docs.map((d) => ({
      kind: d.kind,
      onFile: !!d.onFile,
      expiresOn: d.expiresOn || null,
      gated: !!d.gated,
    })),
  };
}

// Sorted by what needs attention. A certificate lapsing on Friday is the
// reason to open this page at all, so it goes first; everything else falls
// back to most recently sent.
export function rankInbox(rows = [], today) {
  const soonest = (r) => (r.docs || [])
    .map((d) => d.expiresOn).filter(Boolean).sort()[0] || null;
  return [...rows].sort((a, b) => {
    const ea = soonest(a), eb = soonest(b);
    if (ea && eb && ea !== eb) return ea.localeCompare(eb);
    if (ea && !eb) return -1;
    if (!ea && eb) return 1;
    return String(b.sentAt || "").localeCompare(String(a.sentAt || ""));
  });
}

// How many of these are a problem right now, for the line at the top. A count
// and a date, never a list -- the same shape the waiver roll-up draws.
export function inboxSummary(rows = [], today) {
  const day = String(today || "").slice(0, 10);
  let expired = 0, soon = 0;
  for (const r of rows) {
    for (const d of r.docs || []) {
      if (!d.expiresOn) continue;
      if (d.expiresOn <= day) expired += 1;
      else if (daysTo(d.expiresOn, day) <= 30) soon += 1;
    }
  }
  return { companies: rows.length, expired, soon };
}

function daysTo(iso, from) {
  const a = Date.parse(`${from}T00:00:00Z`), b = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return Infinity;
  return Math.round((b - a) / 86400000);
}
