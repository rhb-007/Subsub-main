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
