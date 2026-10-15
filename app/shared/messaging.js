// Messages between an account and the people it already works with.
//
// A THREAD ALWAYS HANGS OFF A RELATIONSHIP THAT ALREADY EXISTS, which is what
// keeps this from becoming the directory the product refuses. There is no
// "new message to anybody" field and no search across companies: the people
// you can write to are your own tenants, the companies on your own roster and
// the owners of buildings you run -- and, from the other side, the account
// that runs your building or hires you. The Worker checks the relationship on
// every read and every write; this module decides who is on which side.
//
// Three kinds, and `account_id` is always the side that RUNS the relationship:
//   tenant -- the operator and one tenant seat;
//   crew   -- the hiring account and one company on its roster;
//   owner  -- the operator and the owner of a building it runs (an owner seat
//             on this account, or the owning account of a building appointed
//             out to it).
// No thread between a tenant and a crew, or a tenant and an owner: the
// operator stays in the middle, because a tenant's relationship is with
// whoever runs the building and the access panel already hands each side a
// number for the day of the visit.
//
// Each kind has one GENERAL thread per party (per building, for an owner) and
// may have one per JOB, so a conversation about a repair sits beside the repair.

export const THREAD_KINDS = ["tenant", "crew", "owner"];
export const MAX_BODY = 4000;
export const MAX_PHOTOS = 6;
// The author may correct a typo for this long, and after it a message is the
// record: nothing is ever deleted.
export const EDIT_WINDOW_MS = 10 * 60 * 1000;
// How long a message waits unread before its email goes. Long enough that a
// conversation going back and forth in the app does not also fill an inbox,
// short enough that a tenant's question is not left until tomorrow.
export const NOTIFY_AFTER_MS = 20 * 60 * 1000;

export const TEAM_ROLES = ["admin", "pm"];

// The one key a thread is found by, so two presses at once find one thread.
// The party is prefixed by what it is, because a user id and a company id are
// different namespaces and must not be able to collide.
export function threadKey({ accountId, kind, partyUserId, partyCompanyId, partyAccountId, jobId, propertyId }) {
  const party = partyCompanyId ? `c:${partyCompanyId}`
    : partyAccountId ? `a:${partyAccountId}`
    : partyUserId ? `u:${partyUserId}` : "";
  if (!accountId || !THREAD_KINDS.includes(kind) || !party) return null;
  // An owner's general thread is per building: an owner of two buildings run
  // by one agent is having two different conversations.
  const where = jobId ? `job:${jobId}` : kind === "owner" ? `prop:${propertyId || ""}` : "general";
  return `${accountId}|${kind}|${party}|${where}`;
}

// The party a kind needs, and only that one. A row carrying two would be two
// answers to who the other side is.
export function partyShapeOk(t) {
  const u = !!t.partyUserId, c = !!t.partyCompanyId, a = !!t.partyAccountId;
  if (t.kind === "tenant") return u && !c && !a;
  if (t.kind === "crew") return c && !u && !a;
  if (t.kind === "owner") return (u !== a) && !c && !!(t.propertyId || t.jobId);
  return false;
}

// WHICH SIDE A VIEWER IS ON, or null for neither. The one rule, read by the
// list, the read, the post and the photo route.
//
// `viewer` is the seat: { userId, accountId, role, companyId (a contractor
// seat's company), ownCompanyId (the account's own company row, since 031),
// propertyIds, jobIds }. `thread` is camelCase.
//
// The home side is the running account's team. A seat narrowed to buildings
// reads the threads at its buildings, and a general crew thread, which is not
// about a building; a seat narrowed to jobs reads the general threads and the
// threads on its jobs.
//
// The party side is whoever the thread names, and each way of being them is
// checked against the seat actually held:
//   a tenant or owner seat on the running account, named by user;
//   a contractor seat on the running account, for that company;
//   the company's OWN account team, answering a client from home -- the same
//     door client work already uses, so nobody needs a seat on the client;
//   the owning account's team, for a building appointed out to the operator.
export function sideOf(thread, viewer) {
  if (!thread || !viewer) return null;
  const team = TEAM_ROLES.includes(viewer.role);
  if (viewer.accountId === thread.accountId) {
    if (team) {
      if (viewer.propertyIds) {
        if (thread.propertyId) { if (!viewer.propertyIds.includes(thread.propertyId)) return null; }
        else if (thread.kind !== "crew") return null;
      }
      if (viewer.jobIds && thread.jobId && !viewer.jobIds.includes(thread.jobId)) return null;
      return "home";
    }
    if ((viewer.role === "tenant" || viewer.role === "owner") && viewer.role === thread.kind
      && thread.partyUserId === viewer.userId) {
      // An owner seat is narrowed to named buildings; one taken off a building
      // stops reading what was said about it.
      if (viewer.role === "owner" && viewer.propertyIds && thread.propertyId
        && !viewer.propertyIds.includes(thread.propertyId)) return null;
      return "party";
    }
    if (viewer.role === "contractor" && thread.kind === "crew" && viewer.companyId
      && viewer.companyId === thread.partyCompanyId) return "party";
    return null;
  }
  if (!team) return null;
  if (thread.kind === "crew" && viewer.ownCompanyId && viewer.ownCompanyId === thread.partyCompanyId) return "party";
  if (thread.kind === "owner" && thread.partyAccountId && thread.partyAccountId === viewer.accountId) return "party";
  return null;
}

// Body and photos, checked on the way in. A message with nothing in it is
// refused rather than stored: an empty bubble on the record reads as
// something that was said and lost.
export function validMessage(b, { keyPrefix = null } = {}) {
  const body = String(b?.body ?? "").replace(/\r\n/g, "\n").trim();
  if (body.length > MAX_BODY) return { error: "too_long", max: MAX_BODY };
  const raw = Array.isArray(b?.photos) ? b.photos : [];
  if (raw.length > MAX_PHOTOS) return { error: "too_many_photos", max: MAX_PHOTOS };
  const photos = [];
  for (const p of raw) {
    const key = String(p?.key ?? p ?? "");
    // A key from the body is checked, never trusted: one under somebody
    // else's prefix would attach and then be served back by the photo route.
    if (!key || key.includes("..") || (keyPrefix && !key.startsWith(keyPrefix))) return { error: "bad_photo" };
    photos.push({ key, type: String(p?.type || "image/jpeg").slice(0, 40), name: String(p?.name || "photo").slice(0, 120) });
  }
  if (!body && !photos.length) return { error: "empty" };
  return { body, photos };
}

export function mayEditMessage(msg, userId, nowMs = Date.now()) {
  if (!msg || !userId || msg.authorUserId !== userId) return false;
  const at = Date.parse(msg.createdAt);
  return Number.isFinite(at) && nowMs - at <= EDIT_WINDOW_MS;
}

// What a thread is called from where the reader is sitting. The home side
// sees who it is talking to; the party side sees which account. A job thread
// leads with the job, because that is what it is about.
export function threadTitle(t, side) {
  const who = side === "home" ? (t.partyName || "Somebody") : (t.accountName || "The office");
  return t.jobTitle ? `${t.jobTitle}` : who;
}

export function counterpartLabel(t, side) {
  if (side === "party") {
    if (t.kind === "tenant") return `${t.accountName || "Your building"} (your building's office)`;
    if (t.kind === "owner") return `${t.accountName || "Your property manager"} (runs ${t.propertyName || "your building"})`;
    return t.accountName || "Your client";
  }
  const name = t.partyName || "Somebody";
  if (t.kind === "tenant") return [name, [t.unit && `unit ${t.unit}`, t.propertyName].filter(Boolean).join(", ")].filter(Boolean).join(" · ");
  if (t.kind === "owner") return `${name} · owner${t.propertyName ? ` of ${t.propertyName}` : ""}`;
  return name;
}

// Unread for one reader: messages from the OTHER side since they last read.
// A teammate's message is not waiting on you.
export function unreadCount(messages, side, readAt) {
  return (messages || []).filter((m) => m.authorSide !== side && (!readAt || m.createdAt > readAt)).length;
}

// Who should get the new-message email for a thread, given when they last
// read it and were last told. Only when the other side has said something
// since both, and it has sat for NOTIFY_AFTER_MS.
export function owesEmail({ latestOtherAt, readAt, notifiedAt, nowMs = Date.now() }) {
  if (!latestOtherAt) return false;
  if (readAt && latestOtherAt <= readAt) return false;
  if (notifiedAt && latestOtherAt <= notifiedAt) return false;
  const at = Date.parse(latestOtherAt);
  return Number.isFinite(at) && nowMs - at >= NOTIFY_AFTER_MS;
}

// 082. DOES THIS MESSAGE LOOK LIKE IT IS AGREEING A TIME? Only ever a nudge:
// the screen offers "propose this as a time" under the box and never stops
// the message going. A message books nothing, so "Tuesday at 9 works" typed
// into a thread is a time two people believe is agreed and the calendar has
// never heard of -- the one failure messaging must not add to this product.
//
// Generous on purpose, because a false nudge costs a glance and a missed one
// costs a crew at the wrong door. Whole days and clock times only: "sun",
// "sat" and "wed" are left out, since sun damage and a saturated wall are
// ordinary things to write about a repair.
const TIME_PATTERNS = [
  /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tues|weds|thurs)\b/i,
  /\b(today|tomorrow|tonight|this (morning|afternoon|evening|weekend)|next (week|monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/i,
  /\b([1-9]|1[0-2])(:[0-5]\d)?\s?(am|pm|a\.m\.|p\.m\.)(?![a-z])/i,
  /\b([01]?\d|2[0-3]):[0-5]\d\b/,
  /\b(at|by|around|after|before) ([1-9]|1[0-2])\b/i,
  /\b(noon|midday)\b/i,
  /\b(1[0-2]|0?[1-9])\/(3[01]|[12]\d|0?[1-9])\b/,
  /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.? (3[01]|[12]\d|[1-9])\b/i,
];
export const looksLikeTime = (text) => {
  const s = String(text || "");
  return s.trim().length > 0 && TIME_PATTERNS.some((re) => re.test(s));
};

// What a conversation hands to the job or report made from it: the words the
// OTHER side wrote since the last job made from it, and their photos. The
// running account's own replies are left out -- they are not the problem
// being reported -- and anything before the last job is already a job.
export function jobSeedFrom(messages, side, linkedAt = null) {
  const theirs = (messages || []).filter((m) => (side === "party" ? m.authorSide === "party" : m.authorSide !== side)
    && (!linkedAt || m.createdAt > linkedAt));
  const words = theirs.map((m) => String(m.body || "").trim()).filter(Boolean);
  const last = words[words.length - 1] || "";
  const title = (last.split("\n")[0] || "").slice(0, 80);
  const scope = words.join("\n\n").slice(0, 1500);
  const photos = theirs.flatMap((m) => (m.photos || []).map((p) => ({ messageId: m.id, index: p.index }))).slice(-12);
  return { title, scope, photos };
}

// 083. EVERY MESSAGE IS EMAILED, AND AN EMAILED REPLY LANDS IN THE THREAD.
//
// The email goes to everybody on the OTHER side who could read the thread in
// the app, at once, with their own reply address on it. Two exceptions, both
// about not telling somebody what they already know: anybody who has switched
// email off, and anybody who read the thread in the last REPLY_QUIET_MS --
// they are in the conversation right now and an email about it is noise.
export const REPLY_QUIET_MS = 2 * 60 * 1000;

// The line a reply is cut at. Every mail program quotes the message it answers
// under the new text, so without a marker the thread would grow a copy of
// itself with every reply.
export const REPLY_MARKER = "Reply above this line to answer in SubSub";

// One address per person per thread: m-<token>@<domain>. The token is random
// and stored, never derived, because an address somebody can work out from a
// thread id and a user id is an address anybody can post into a thread with.
// Lower case only: some mail servers fold the local part, and a token that
// changed case in transit would match nothing.
export const REPLY_TOKEN_RE = /^[a-z0-9]{24}$/;
export const replyAddress = (token, domain) => (token && domain ? `m-${token}@${domain}` : null);
export function tokenFromAddress(addr, domain) {
  const m = String(addr || "").trim().toLowerCase().match(/^m-([a-z0-9]+)(?:\+[^@]*)?@(.+)$/);
  if (!m || (domain && m[2] !== String(domain).toLowerCase())) return null;
  return REPLY_TOKEN_RE.test(m[1]) ? m[1] : null;
}

// What somebody actually wrote, out of an email that also quotes everything
// before it. Cut at the first of: our own marker, a line of the "On <date>,
// <name> wrote:" kind (which some programs wrap onto two lines), Outlook's
// "-----Original Message-----" or its underscore rule followed by a From:
// header, and a run of ">" quoted lines. A trailing "Sent from my iPhone" goes
// too. Anything left is the reply; nothing left is no reply.
export function replyTextFrom(text) {
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const t = l.trim();
    if (t.includes(REPLY_MARKER)) break;
    if (/^On\b.*\bwrote:$/i.test(t)) break;
    if (/^On\b/i.test(t) && /\bwrote:$/i.test((lines[i + 1] || "").trim())) break;
    if (/^-{2,}\s*Original Message\s*-{2,}$/i.test(t)) break;
    if (/^_{8,}$/.test(t) && /^From:/i.test((lines[i + 1] || "").trim())) break;
    if (/^From:\s.+/i.test(t) && /^(Sent|Date):\s/i.test((lines[i + 1] || "").trim())) break;
    if (t.startsWith(">")) break;
    out.push(l);
  }
  while (out.length && !out[out.length - 1].trim()) out.pop();
  if (out.length && /^sent from my\b/i.test(out[out.length - 1].trim())) out.pop();
  if (out.length && /^(--|—)\s*$/.test(out[out.length - 1].trim())) out.pop();
  return out.join("\n").trim().slice(0, MAX_BODY);
}
