// THE ITEMS IN EACH ROOM, AND WHAT CHANGED BETWEEN MOVING IN AND MOVING OUT.
//
// Asked for as *"add in to each room a checklist of items -- standardized in
// the industry, move-in compared with move-out, to understand the issues or
// costs of things that changed"*, with the Zillow move-in / move-out
// checklist as the reference. The lists below are that form's, room by room.
//
// One module, because the route that stores a condition, the screen that
// draws the rows and the tests must agree on which items a "Bathroom 2" has
// and what each key means. A key is what matches an item on the move-out to
// the same item on the move-in, so KEYS NEVER CHANGE once shipped; a label
// may be reworded freely.

// The form's key, plus "Good", which the form expresses as its default:
// "unless otherwise noted, the premises are in clean, good working order and
// undamaged". An item nobody marked is NOT "good" -- it is unanswered, and
// the screen says the default sentence rather than inventing a tick.
export const ITEM_CONDITIONS = {
  ok:  { code: "OK",  label: "Good" },
  nc:  { code: "NC",  label: "Needs cleaning" },
  nsc: { code: "NSC", label: "Needs spot cleaning" },
  np:  { code: "NP",  label: "Needs painting" },
  nsp: { code: "NSP", label: "Needs spot painting" },
  nr:  { code: "NR",  label: "Needs repair" },
  rp:  { code: "RP",  label: "Needs replacing" },
};
export const ITEM_CONDITION_ORDER = ["ok", "nc", "nsc", "np", "nsp", "nr", "rp"];
export const isItemCondition = (c) => Object.prototype.hasOwnProperty.call(ITEM_CONDITIONS, String(c));
export const DEFAULT_CONDITION_TEXT =
  "Unless otherwise noted, everything in this room is clean, in good working order and undamaged.";

// A cost is in whole cents, and a ceiling stops a typo becoming a deposit
// claim nobody can explain: $50,000 for one item is not a slip anybody means.
export const MAX_ITEM_COST_CENTS = 5_000_000;

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const items = (list, group = "") => list.map((label) => ({
  key: (group ? `${slug(group)}-` : "") + slug(label), label, group,
}));

const SURFACES = ["Floor", "Walls", "Ceiling"];
const OPENINGS = ["Doors", "Windows", "Screens"];

export const CHECKLISTS = {
  entry: items([...SURFACES, "Light fixtures", "Outlets/switches", "Closet", "Stairs"]),
  living: items([...SURFACES, ...OPENINGS, "Shades/blinds", "Closet", "Light fixtures",
    "Outlets/switches", "Lightbulbs"]),
  dining: items([...SURFACES, ...OPENINGS, "Shades/blinds", "Light fixtures", "Outlets/switches"]),
  bedroom: items([...SURFACES, ...OPENINGS, "Shades/blinds", "Closets", "Light fixtures",
    "Outlets/switches", "Lightbulbs"]),
  bath: [
    ...items([...SURFACES, ...OPENINGS, "Cabinets", "Drawers", "Sink/plumbing", "Shelves", "Mirror",
      "Tub/shower", "Caulking", "Counter", "Fan", "Light fixtures", "Lightbulbs", "Outlets/switches"]),
    ...items(["Bowl", "Seat", "Flush"], "Toilet"),
  ],
  // A half bath has a toilet and a basin and no tub, no shower and usually no
  // window -- asking about a tub in a powder room is a row that can only be
  // left blank or answered with a lie.
  halfbath: [
    ...items([...SURFACES, "Doors", "Cabinets", "Sink/plumbing", "Mirror", "Counter", "Fan",
      "Light fixtures", "Lightbulbs", "Outlets/switches"]),
    ...items(["Bowl", "Seat", "Flush"], "Toilet"),
  ],
  toilet: items(["Bowl", "Seat", "Flush"], "Toilet"),
  kitchen: [
    ...items([...SURFACES, ...OPENINGS, "Cabinets", "Drawers", "Sink/plumbing", "Counters", "Fan",
      "Light fixtures", "Lightbulbs"]),
    ...items(["Interior/parts", "Exterior", "Controls"], "Dishwasher"),
    ...items(["Interior/parts", "Exterior", "Lights"], "Refrigerator"),
    ...items(["Exterior", "Burners", "Vent", "Timer/controls", "Surface", "Light", "Racks", "Drip pan"],
      "Stove/oven"),
  ],
  mechanical: items(["Water heater", "Smoke detector", "Thermostat", "Heating", "A/C"]),
  outdoor: items(["Parking area", "Lawn/garden", "Patio/deck"]),
  laundry: items([...SURFACES, "Washer/dryer", "Outlets/switches", "Light fixtures"]),
  closet: items([...SURFACES, "Doors", "Shelves", "Light fixtures"]),
  // A space nobody's list has heard of still has a floor, walls and a ceiling.
  generic: items([...SURFACES, "Doors", "Windows", "Light fixtures", "Outlets/switches"]),
};

// WHICH LIST A ROOM GETS, read off its name. Whole words, in order, so
// "Half bath" is a half bath before it is a bath and "Walk-in closet" is a
// closet before anything else. Names that are already ONE THING ("Walls and
// floors", "Keys handed over") get no list: a checklist of a single item is a
// second record of the room's own verdict, and the two would disagree.
const RULES = [
  [/\b(half bath|powder room)\b/, "halfbath"],
  [/^toilet\b/, "toilet"],
  [/\b(bath|bathroom|shower and bath|ensuite|en suite)\b/, "bath"],
  [/\bkitchen\b/, "kitchen"],
  [/\b(dining)\b/, "dining"],
  [/\b(bedroom|bed room|master)\b/, "bedroom"],
  [/\b(closet|pantry|storage)\b/, "closet"],
  [/\b(laundry|utility)\b/, "laundry"],
  [/\b(smoke alarms?|heating|cooling|mechanical|furnace)\b/, "mechanical"],
  [/\b(patio|deck|balcony|yard|garden|lawn|parking|exterior|outside)\b/, "outdoor"],
  [/\b(living|family room|great room|sleeping area|den|lounge)\b/, "living"],
  [/\b(entry|entrance|foyer|hall|hallway|stairs?)\b/, "entry"],
  [/^(walls and floors|ceilings|windows and screens|doors and locks|lighting and fixtures|outlets and switches|appliances|cabinets and drawers|sink and taps|keys handed over)$/, null],
];

export function checklistKind(roomName) {
  const n = String(roomName || "").trim().toLowerCase();
  if (!n) return "generic";
  for (const [re, kind] of RULES) if (re.test(n)) return kind;
  return "generic";
}
export const checklistFor = (roomName) => {
  const k = checklistKind(roomName);
  return k ? CHECKLISTS[k] : [];
};

const key = (s) => String(s || "").trim().toLowerCase();
export const roomKey = key;

// THE ROWS A ROOM SHOWS: its list in order, each with what was recorded, then
// any recorded item the list no longer has (a room renamed after somebody
// wrote in it). A recorded answer is never dropped to tidy a list -- the same
// rule a layout change follows about rooms.
//
// `moveIn` is the matching room's rows on the move-in, keyed by item key, or
// null when this is not a move-out or no move-in was walked.
export function checklistRows(roomName, stored = [], moveIn = null) {
  const list = checklistFor(roomName);
  const byKey = Object.fromEntries((stored || []).map((s) => [s.key, s]));
  const known = new Set(list.map((i) => i.key));
  const rows = [
    ...list,
    ...(stored || []).filter((s) => !known.has(s.key))
      .map((s) => ({ key: s.key, label: s.label || s.key, group: s.group || "" })),
  ];
  return rows.map((i) => {
    const s = byKey[i.key] || {};
    const mi = moveIn ? moveIn[i.key] || null : null;
    return {
      key: i.key, label: i.label, group: i.group,
      condition: s.condition || null, note: s.note || "",
      costCents: Number.isFinite(s.costCents) ? s.costCents : null,
      ...(moveIn ? { moveIn: mi ? { condition: mi.condition || null, note: mi.note || "" } : null } : {}),
    };
  });
}

// WHAT CHANGED. An item counts when the move-out marks it as needing
// something AND that is not what the move-in already said: a carpet that was
// stained on the way in is not a charge on the way out. A move-in that never
// answered the item is not evidence it was fine, so it still counts, and the
// screen says the move-in was blank rather than pretending it said "Good".
export function itemChanged(row) {
  const out = row?.condition;
  if (!out || out === "ok") return false;
  const was = row?.moveIn?.condition || null;
  return out !== was;
}

export function checklistTally(rooms = []) {
  let answered = 0, total = 0, changed = 0, flagged = 0, costCents = 0;
  for (const r of Array.isArray(rooms) ? rooms : []) {
    for (const i of r?.checklist || []) {
      total++;
      if (i.condition) answered++;
      if (i.condition && i.condition !== "ok") flagged++;
      if (itemChanged(i)) changed++;
      if (Number.isFinite(i.costCents)) costCents += i.costCents;
    }
  }
  return { answered, total, changed, flagged, costCents };
}

// A cost typed as dollars, read as whole cents. Blank is "no cost", which is
// not the same as $0.00 somebody typed on purpose.
export function parseCost(s) {
  const t = String(s ?? "").replace(/[$,\s]/g, "");
  if (!t) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return undefined;
  return Math.round(Number(t) * 100);
}
