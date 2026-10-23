// A UNIT'S LAYOUT, AND THE ROOMS IT IMPLIES.
//
// Asked for as *"when a unit is selected we need to add the unit type studio,
// 1brx1ba, 1brx2ba, 2brx1ba ... and then based on what's selected it will add
// each of the rooms automatically including standard spaces like entry,
// bathroom, etc. ... they only need to modify if different, remove a room or
// add a room if needed"*. A two-bedroom walk used to start with nine taps on
// room chips before anybody had looked at anything.
//
// The rule lives here so the route that adds the rooms, the screen that
// offers the choice and the tests cannot hold three opinions about which
// rooms a "2 BR x 1.5 BA" has.

// Bathrooms run in half steps up to four, and never more than one past the
// bedrooms: a one-bedroom with three bathrooms is a unit nobody has, and a
// list of every arithmetic combination is a list somebody scrolls past.
export const LAYOUT_BATHS = [1, 1.5, 2, 2.5, 3, 3.5, 4];
export const LAYOUT_MAX_BEDS = 5;

const fmtBaths = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export const UNIT_LAYOUTS = [
  { id: "studio", beds: 0, baths: 1, label: "Studio" },
  ...Array.from({ length: LAYOUT_MAX_BEDS }, (_, i) => i + 1).flatMap((beds) =>
    LAYOUT_BATHS.filter((b) => b <= beds + 1).map((baths) => ({
      id: `${beds}br-${fmtBaths(baths)}ba`, beds, baths,
      label: `${beds} BR × ${fmtBaths(baths)} BA`,
    }))),
];
const BY_ID = Object.fromEntries(UNIT_LAYOUTS.map((l) => [l.id, l]));

export const isUnitLayout = (id) => Object.prototype.hasOwnProperty.call(BY_ID, String(id));
export const layoutLabel = (id) => BY_ID[id]?.label || "";

// The rooms, in the order somebody walks them: in at the door, the shared
// spaces, then the private ones. ALWAYS NUMBERED, even with one bedroom,
// because changing a 1 BR to a 2 BR must ADD "Bedroom 2" next to the
// "Bedroom 1" already walked -- an unnumbered "Bedroom" would sit beside two
// numbered ones and read as a third.
//
// A half bath is its own room: it has a toilet and a basin and gets walked
// like one. A hallway only once there are two bedrooms off it. Nothing that
// is not a space (smoke alarms, keys) -- those are one tap on the chips below
// and not every walk records them.
export function layoutRooms(id) {
  const l = BY_ID[id];
  if (!l) return [];
  const full = Math.floor(l.baths);
  const half = l.baths % 1 ? 1 : 0;
  return [
    "Entry",
    l.beds ? "Living room" : "Living and sleeping area",
    "Kitchen",
    ...(l.beds >= 2 ? ["Hallway"] : []),
    ...Array.from({ length: l.beds }, (_, i) => `Bedroom ${i + 1}`),
    ...Array.from({ length: full }, (_, i) => `Bathroom ${i + 1}`),
    ...(half ? ["Half bath"] : []),
  ];
}

const key = (s) => String(s || "").trim().toLowerCase();

// A room somebody has done something to is theirs, whichever layout it came
// from. Untouched means nothing was recorded in it at all: not walked, no
// note, no photograph.
export const roomUntouched = (r) =>
  (!r?.status || r.status === "unchecked") && !String(r?.note || "").trim()
    && !(r?.photos || []).length && !(r?.photoCount > 0);

// WHAT CHANGING THE LAYOUT DOES, as a plan the route carries out.
//
//   add      the layout's rooms the inspection does not have yet, by name.
//   remove   rooms the OLD layout put there that the new one does not have,
//            and only while nothing has been recorded in them. Going from a
//            3 BR to a 2 BR takes "Bedroom 3" off, unless somebody already
//            photographed it -- then it stays, because removing evidence to
//            tidy a list is the one thing this must never do.
//   kept     those it left for that reason, named so the screen can say so.
//   order    the room ids in the order they should sit: the layout's rooms
//            in walking order, then everything else in the order it was.
//
// With no previous layout nothing is removed: rooms somebody added by hand
// before choosing a type are theirs, and matching them by name is a guess.
export function layoutChange(rooms = [], fromId = null, toId = null, { max = Infinity } = {}) {
  const list = Array.isArray(rooms) ? rooms : [];
  const want = layoutRooms(toId);
  const wantKeys = new Set(want.map(key));
  const oldKeys = new Set(layoutRooms(fromId).map(key));
  const remove = [], kept = [];
  for (const r of list) {
    const k = key(r.name);
    if (!oldKeys.has(k) || wantKeys.has(k)) continue;
    if (roomUntouched(r)) remove.push(r.id); else kept.push(String(r.name).trim());
  }
  const removing = new Set(remove);
  const staying = list.filter((r) => !removing.has(r.id));
  const have = new Set(staying.map((r) => key(r.name)));
  const room = Math.max(0, max - staying.length);
  const add = want.filter((n) => !have.has(key(n))).slice(0, room);
  const skipped = want.filter((n) => !have.has(key(n))).length - add.length;
  return { add, remove, kept, skipped, want };
}

// The order once the plan has run: the layout's rooms in walking order, then
// everything else as it was. Takes the rooms as they stand AFTER the adds.
export function layoutOrder(rooms = [], toId = null) {
  const want = layoutRooms(toId).map(key);
  const at = (r) => { const i = want.indexOf(key(r.name)); return i < 0 ? want.length : i; };
  return [...rooms]
    .map((r, i) => ({ r, i }))
    .sort((a, b) => at(a.r) - at(b.r) || a.i - b.i)
    .map(({ r }) => r.id);
}

// What the route did, in a sentence for the screen. Named rather than
// counted where it matters: "took off Bedroom 3" is checkable from the room
// list, "removed 1 room" is not.
const listNames = (a) => (a.length <= 2 ? a.join(" and ") : `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}`);
export function layoutChangeText(r) {
  if (!r) return "";
  const parts = [];
  if (r.added?.length) {
    parts.push(r.added.length > 3
      ? `Added ${r.added.length} rooms for ${r.label ? `a ${r.label}` : "this layout"}.`
      : `Added ${listNames(r.added)}.`);
  }
  if (r.removed?.length) parts.push(`Took off ${listNames(r.removed)}, which had nothing recorded in ${r.removed.length === 1 ? "it" : "them"}.`);
  if (r.kept?.length) parts.push(`Kept ${listNames(r.kept)}, because something is recorded in ${r.kept.length === 1 ? "it" : "them"}.`);
  if (r.skipped) parts.push(`${r.skipped} more would go over the room limit.`);
  if (!parts.length && r.layout) parts.push("Every room for this layout is already here.");
  if (r.added?.length) parts.push("Remove any the unit doesn't have.");
  if (r.stored === false) parts.push("The unit type itself wasn't saved yet (SubSub needs a database update), so changing it later will only add rooms.");
  return parts.join(" ");
}
