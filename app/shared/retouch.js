// When a subcontractor's paperwork renews, tell the people they already sent
// it to.
//
// The pack page's whole pitch is that it stays current -- "when they renew,
// this page shows the new certificate rather than the one that has lapsed,
// and that is the part an emailed PDF cannot do". That promise was only kept
// for somebody who happened to open the link again, and the link expires in
// SHARE_DAYS. A year later, when the certificate actually renews, every
// recipient is holding a dead URL and the promise quietly went unkept.
//
// So the renewal sends a fresh link. It is the cheapest recurring reach this
// product has: wanted (they asked for that document), automatic, and annual
// per recipient per document -- landing on a general contractor who mostly has
// no account, at the moment they are being reminded they have a compliance
// problem.
//
// Which is why the rules below matter more than the feature does. Every one of
// them exists to keep this a service rather than a mailing list.

// How long after a renewal the sweep will still send. A certificate uploaded
// three weeks ago is not news, and a backlog discovered by a sweep that has
// been failing must not all go out at once.
export const RETOUCH_WINDOW_DAYS = 7;

// One email per recipient per this many days, however many documents renewed.
// A subcontractor who renews insurance, bond and contract in the same week
// sends one message, not three.
export const RETOUCH_QUIET_DAYS = 30;

// A document only earns a re-touch if it has an expiry. A W-9 and a signed
// contract do not expire, so "we renewed it" is not news anybody asked for --
// and a blank expiry means "does not expire", never "unknown".
export const RETOUCHABLE = new Set(["insurance", "bond"]);
export const retouchable = (kind) => RETOUCHABLE.has(kind);

const day = (d) => String(d || "").slice(0, 10);

// Is this row a RENEWAL rather than a first upload? Telling somebody their
// contractor "renewed" a certificate they have never seen is nonsense, and
// the first upload already gets a send when somebody actually shares it.
export function isRenewal({ hasPrior, expiresOn } = {}) {
  return !!hasPrior && !!expiresOn;
}

// Everything that has to be true before one email goes out. Written as one
// function returning a reason, so the sweep logs WHY it skipped rather than
// silently sending nothing -- a growth loop that is quietly off is worse than
// one that is on and wrong, because nobody finds out.
export function mayRetouch({
  kind, hasPrior, expiresOn, uploadedAt, today,
  alreadySentForThisDoc, lastTouchedAt, optedOut, shareRevoked,
} = {}) {
  if (!retouchable(kind)) return { ok: false, reason: "does_not_expire" };
  if (!isRenewal({ hasPrior, expiresOn })) return { ok: false, reason: "not_a_renewal" };
  // Nothing goes out about a certificate that is already out of date.
  if (day(expiresOn) <= day(today)) return { ok: false, reason: "already_expired" };
  if (alreadySentForThisDoc) return { ok: false, reason: "already_told_them" };
  if (optedOut) return { ok: false, reason: "opted_out" };
  // They withdrew the link. Re-sending one they revoked would undo a decision
  // the subcontractor made about their own paperwork.
  if (shareRevoked) return { ok: false, reason: "share_revoked" };

  const age = daysBetween(day(uploadedAt), day(today));
  if (age == null || age > RETOUCH_WINDOW_DAYS) return { ok: false, reason: "too_old" };

  const since = lastTouchedAt == null ? null : daysBetween(day(lastTouchedAt), day(today));
  if (since != null && since < RETOUCH_QUIET_DAYS) return { ok: false, reason: "too_soon" };

  return { ok: true };
}

export function daysBetween(from, to) {
  if (!from || !to) return null;
  const a = Date.parse(`${from}T00:00:00Z`), b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86400000);
}

// An opt-out is per recipient, and may be about one subcontractor or all of
// them. Saying "stop" about one is not saying it about the others.
export function isOptedOut(rows = [], companyId) {
  return rows.some((r) => !r.companyId || r.companyId === companyId);
}
