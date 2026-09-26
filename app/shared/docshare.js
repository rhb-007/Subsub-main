// Sending your own compliance paperwork to somebody who asked for it.
//
// A subcontractor is asked for the same four documents several times a month,
// nearly always by a general contractor who is not on SubSub. They answer with
// email attachments, and every copy begins going stale the moment it is sent:
// the certificate that was current in March says nothing about June, and the
// contractor holding it has no way to know.
//
// This is that same act, done once, and kept live. It is also the only path in
// the product where the free side can bring the paying side in -- every other
// way in (the connect lookup, the QR code) needs the hiring account to exist
// first, so supply could never acquire demand.
//
// Both halves of that are only true if the thing being sent is trustworthy,
// which is what the rules below are for.

// How long a link lives. Long enough for somebody to get to it after a
// weekend, short enough that it does not outlive the conversation it was sent
// for -- a link to somebody's insurance certificate loose on the internet a
// year later is not a feature.
export const SHARE_DAYS = 14;

// What a general contractor actually asked for, in the order they ask.
export const PACK_KINDS = ["insurance", "bond", "contract", "w9"];

// ---- the one rule worth arguing about -----------------------------------
//
// THE W-9 IS NOT IN THE LINK.
//
// It carries a taxpayer identification number, and for a sole proprietor --
// which is a great many of the trades on here -- that number IS their social
// security number. A tokenised link in an email is not where that belongs:
// email gets forwarded, sits in shared inboxes, and turns up in the archive of
// whoever leaves the company next year.
//
// So the page says a W-9 is on file, with the date, and reading it needs an
// account. That is the one piece of deliberate friction in this flow, and it
// is placed where the recipient is already getting the thing they asked for --
// the certificate of insurance is what they actually need today, and it is the
// least sensitive of the four.
//
// Changing this is a decision about somebody else's identity documents, not a
// tweak to a share feature.
const IN_LINK = new Set(["insurance", "bond", "contract"]);
export const inLink = (kind) => IN_LINK.has(kind);
export const gatedKinds = () => PACK_KINDS.filter((k) => !inLink(k));

// Is this link still good? Three ways it is not, and they are different
// sentences to whoever is holding it: taken back, ran out, or never existed.
export function shareState(share, now = new Date()) {
  if (!share) return "unknown";
  if (share.revokedAt) return "revoked";
  const ends = Date.parse(String(share.expiresAt || "").replace(" ", "T") + "Z");
  if (Number.isFinite(ends) && ends <= now.getTime()) return "expired";
  return "active";
}

// An address worth sending to. Deliberately the same whole-value shape the
// connect lookup uses: one complete address somebody typed, never a pattern.
export function validRecipient(email) {
  const v = String(email || "").trim();
  if (!v || v.length > 160) return false;
  // No wildcards. Both are legal in a local part by the letter of the RFC and
  // neither has ever been typed by somebody sending their insurance to a
  // contractor -- what they are is the shape of a pattern, and this field
  // takes one whole address the sender already had.
  if (/[%*]/.test(v)) return false;
  return /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(v);
}

// What the page says about one document. The status logic itself lives in
// shared/docs.js and is not duplicated here -- this only decides how much of
// each row crosses to somebody with no account.
//
// Carrier, policy number, coverage and expiry all cross: they are exactly what
// a contractor writes into their own compliance file, and withholding them
// would leave the page less useful than the PDF it replaces. What does not
// cross is anything about the accounts this subcontractor already works for --
// who verified it, when, for whom. That is the roster question, and it is not
// the recipient's business.
export function packRow(doc = {}) {
  const kind = doc.kind;
  const shown = inLink(kind);
  return {
    kind,
    onFile: !!doc.uploadedAt,
    uploadedAt: doc.uploadedAt || null,
    issuer: shown ? (doc.issuer || null) : null,
    policyNo: shown ? (doc.policyNo || null) : null,
    coverageCents: shown ? (doc.coverageCents ?? null) : null,
    effectiveOn: shown ? (doc.effectiveOn || null) : null,
    // The expiry crosses for every kind, including the gated one: "we hold a
    // W-9" is worth saying even when the document itself is not readable.
    expiresOn: doc.expiresOn || null,
    // Whether there is a file to open from this page at all.
    readable: shown && !!doc.fileKey,
    gated: !shown && !!doc.uploadedAt,
  };
}
