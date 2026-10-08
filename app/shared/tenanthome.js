// The tenant's own dashboard: how they would like to be reached, who to call
// if they cannot be, and the notices a manager posts to their building.
//
// One module because three things describe these shapes -- the routes, the
// screen and the tests -- and a rule written in two of them is a rule the
// third disagrees with.

// How they would like this account to reach them. Three, because those are
// the three things a managing agent can actually do with a number and an
// address. Order is the order the chips read in: most people renting today
// answer a text before they answer a call.
export const CONTACT_PREFS = [
  { id: "text", label: "Text me" },
  { id: "call", label: "Call me" },
  { id: "email", label: "Email me" },
];
export const PREF_IDS = CONTACT_PREFS.map((p) => p.id);

// The two that need a number. Saying "call me" with no number on file is a
// preference nobody can act on, so the route refuses it rather than storing a
// promise the manager finds out is empty when they pick up the phone.
export const NEEDS_PHONE = ["text", "call"];

export const prefLabel = (id) => CONTACT_PREFS.find((p) => p.id === id)?.label || null;

// What a manager reads about one tenant, in one line. Nothing chosen is said
// as nothing chosen rather than as a blank -- a blank reads as data that did
// not load.
export function contactLine(c) {
  if (!c || !c.prefer) return null;
  const how = { text: "Prefers a text", call: "Prefers a call", email: "Prefers email" }[c.prefer];
  if (!how) return null;
  return c.bestTime ? `${how} · ${c.bestTime}` : how;
}

export function emergencyLine(c) {
  if (!c || !c.emergencyName || !c.emergencyPhone) return null;
  const who = c.emergencyRelation ? `${c.emergencyName} (${c.emergencyRelation})` : c.emergencyName;
  return `${who} · ${c.emergencyPhone}`;
}

// A notice is shown until it is taken down or its last day has passed. A
// last day is INCLUSIVE: "the water is off until Friday" is still true on
// Friday. Dates are YYYY-MM-DD compared as text, one format against itself.
export function noticeLive(n, today) {
  if (!n || n.removedAt || n.removed_at) return false;
  const end = n.endsOn ?? n.ends_on ?? null;
  return !end || String(end) >= String(today);
}

// Important first, then newest. An important notice under three ordinary ones
// is the one somebody scrolls past.
export function sortNotices(list) {
  return [...(list || [])].sort((a, b) =>
    (Number(!!b.important) - Number(!!a.important))
    || String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}

export const NOTICE_TITLE_MAX = 120;
export const NOTICE_BODY_MAX = 2000;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const realDay = (s) => {
  if (!DAY.test(s)) return false;
  const d = new Date(`${s}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

// The one check on what a manager posts. Answers {error} or the clean shape.
export function validNotice(b, today) {
  const title = String(b?.title ?? "").trim();
  const body = String(b?.body ?? "").trim();
  if (!title) return { error: "title_required" };
  if (title.length > NOTICE_TITLE_MAX) return { error: "title_too_long" };
  if (body.length > NOTICE_BODY_MAX) return { error: "body_too_long" };
  const endsOn = b?.endsOn ? String(b.endsOn).trim() : null;
  if (endsOn && !realDay(endsOn)) return { error: "bad_date" };
  // A notice whose last day has already gone would be posted and never shown.
  if (endsOn && today && endsOn < today) return { error: "date_past" };
  return { title, body: body || null, important: !!b?.important, endsOn };
}

// The AI line. A placeholder, and it says so: no number is shown, because a
// number that does not answer is worse than no number -- somebody with a leak
// would ring it.
export const AI_LINE_LIVE = false;
