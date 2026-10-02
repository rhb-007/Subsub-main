// MOVE-IN AND MOVE-OUT INSPECTIONS: the rules, in one place, because four
// things have to agree about them -- the routes, the screen, the job raised
// off the back of one, and the tests.

// Which walk this is. The word matters on the record rather than only on the
// screen: "the carpet was like that when I moved in" is the single most
// common dispute a managing agent has, and the answer is two inspections of
// the same unit with dates on them.
export const INSPECTION_KINDS = {
  move_in: { label: "Move-in", verb: "moving in" },
  move_out: { label: "Move-out", verb: "moving out" },
};
export const isInspectionKind = (k) => Object.prototype.hasOwnProperty.call(INSPECTION_KINDS, String(k));

// FOUR STATES, NOT THREE, and the fourth is the whole reason this is a list
// rather than a boolean.
//
// `unchecked` and `ok` are different answers and an inspection that cannot
// tell them apart is one nobody can trust: a room nobody has walked yet and a
// room walked and found fine would otherwise look identical, which is the
// exact ambiguity `doccheck.js` was written to remove one feature along. So
// an unanswered room is drawn plain and counts as outstanding, and only a
// deliberate press makes it OK.
//
// `fail` and `follow_up` are also different answers, and they are deliberately
// both flagged. A reader needs the distinction -- a cracked window is not a
// scuffed wall -- but the thing that happens next is the same: somebody has to
// come and do something about it. Same shape as expired and never-added
// sharing a colour in `docs.js` and being told apart by the words.
export const ROOM_STATUSES = {
  unchecked: { label: "Not checked", tone: "plain", flagged: false, done: false },
  ok: { label: "OK", tone: "ok", flagged: false, done: true },
  follow_up: { label: "Follow-up", tone: "warn", flagged: true, done: true },
  fail: { label: "Fail", tone: "bad", flagged: true, done: true },
};
export const ROOM_STATUS_ORDER = ["ok", "follow_up", "fail"];
export const isRoomStatus = (s) => Object.prototype.hasOwnProperty.call(ROOM_STATUSES, String(s));
export const isFlagged = (room) => !!ROOM_STATUSES[room?.status]?.flagged;

// The dropdown. Whole rooms and the parts of a room people actually write
// down, in one list, because "Walls and floors" and "Bathroom 1" sit at the
// same level on every inspection sheet this was modelled on -- and a second,
// nested level would be a second thing to add, name, reorder and delete for a
// distinction nobody drew on paper.
//
// It is a SUGGESTION and never a constraint: the name is free text and the
// list is a `datalist`, because every building has a room this list has not
// heard of and a dropdown that cannot be typed past is a form that argues.
export const STANDARD_ROOMS = [
  "Entry", "Living room", "Dining room", "Kitchen", "Hallway",
  "Bedroom 1", "Bedroom 2", "Bedroom 3", "Bathroom 1", "Bathroom 2",
  "Walk-in closet", "Laundry", "Garage", "Balcony", "Patio", "Basement",
  "Walls and floors", "Ceilings", "Windows and screens", "Doors and locks",
  "Lighting and fixtures", "Outlets and switches", "Smoke alarms",
  "Heating and cooling", "Appliances", "Cabinets and drawers",
  "Sink and taps", "Toilet", "Shower and bath", "Keys handed over",
];

// Per ROOM, not per inspection: a unit is a dozen rooms and a phone camera
// fills a page with four. The ceiling, the floor and the meter reading are
// one piece of evidence about one room.
export const MAX_ROOM_PHOTOS = 12;
export const MAX_ROOMS = 60;

export const roomName = (r) => String(r?.name || "").trim() || "Unnamed room";

// Where an inspection has got to. Counted rather than derived per screen,
// because the list row, the header and the finish gate all ask it and three
// answers to one question is how they come to disagree.
export function inspectionTally(rooms = []) {
  const list = Array.isArray(rooms) ? rooms : [];
  const checked = list.filter((r) => ROOM_STATUSES[r?.status]?.done);
  const flagged = list.filter(isFlagged);
  return {
    rooms: list.length,
    checked: checked.length,
    unchecked: list.length - checked.length,
    flagged: flagged.length,
    ok: list.filter((r) => r?.status === "ok").length,
    photos: list.reduce((n, r) => n + (r?.photos || []).length, 0),
  };
}

export const flaggedRooms = (rooms = []) => (Array.isArray(rooms) ? rooms : []).filter(isFlagged);

// WHAT STOPS SOMEBODY FINISHING ONE, and it is deliberately only two things.
//
// A room nobody has walked is the reason to refuse: an inspection signed off
// with half its rooms unanswered is a document that says nothing while
// looking like it says everything, and it is the half that gets quoted back
// in a deposit dispute. An EMPTY inspection is refused for the same reason
// one step earlier.
//
// Photos are NOT required. They are nudged everywhere in this product and
// demanded nowhere: a room with nothing wrong in it needs no picture, and a
// gate that insists would be answered with a photo of the floor.
export function whyNotFinish(rooms = []) {
  const t = inspectionTally(rooms);
  if (!t.rooms) return "no_rooms";
  if (t.unchecked) return "rooms_unchecked";
  return null;
}
export const canFinish = (rooms = []) => whyNotFinish(rooms) === null;

// The job raised off the back of one.
//
// Composed from the FLAGGED rooms and nothing else: an inspection is a record
// of the whole unit and a job is a list of things to do, so carrying the rooms
// that were fine would hand a contractor a document to read rather than work
// to price.
export function inspectionJobTitle(inspection = {}) {
  const kind = INSPECTION_KINDS[inspection.kind]?.label || "Inspection";
  const unit = String(inspection.unit || "").trim();
  return `${kind} work${unit ? ` — unit ${unit}` : ""}`.slice(0, 140);
}

export function inspectionJobScope(inspection = {}, rooms = []) {
  const flagged = flaggedRooms(rooms);
  const head = `From the ${(INSPECTION_KINDS[inspection.kind]?.label || "inspection").toLowerCase()} inspection`
    + (inspection.unit ? ` of unit ${inspection.unit}` : "")
    + (inspection.inspectedOn ? ` on ${inspection.inspectedOn}` : "") + ":";
  const lines = flagged.map((r) => {
    const status = ROOM_STATUSES[r.status]?.label || "Flagged";
    const note = String(r.note || "").trim();
    return `• ${roomName(r)} — ${status}${note ? `: ${note}` : ""}`;
  });
  return [head, ...lines].join("\n");
}

// WHO MAY BE SENT ONE, AND WHEN.
//
// Only a FINISHED inspection goes anywhere. A draft is half a walk, and the
// whole reason `whyNotFinish` refuses an unmarked room is that a document
// with blanks in it says nothing while looking like it says everything —
// which is exactly the document somebody would quote back. Sending one would
// undo that gate by a different door.
//
// Both kinds send. The move-in report is the one that answers "it was like
// that when I moved in" and the move-out report is the one that raises the
// question, so an owner who gets one and not the other has half a record.
export function whyNotSend(inspection = {}) {
  if (inspection.status !== "finished") return "not_finished";
  return null;
}
export const canSendInspection = (inspection) => whyNotSend(inspection) === null;

// The report is read through the owner's OWN seat, so the only people it can
// be sent to are the ones who have one on this building. A free-typed address
// would need a public token, a second surface and an expiry — and the person
// this is for already has a login that is already scoped to exactly this
// building, which is the whole reason they were invited.
export const inspectionRecipients = (owners = [], propertyId) =>
  (owners || []).filter((u) => u && u.role === "owner"
    && (u.propertyIds || []).includes(propertyId));

// WHICH SEATS MAY WALK A UNIT, AND WHICH MAY ONLY READ ONE.
//
// Named here rather than restated on the screen and again on each of thirteen
// routes. A screen stricter than the route is the same lie as one that is
// looser, and the way both happen is a role list written twice — which this
// feature was one edit away from: an owner's seat gained the Inspections tab
// and every write button on the detail screen was still drawn from a default.
//
// An owner READS. They own the building and a move-out report is theirs to
// produce in a deposit argument; walking the unit is the agent's job, every
// write route is one of these two roles, and a button offered to an owner
// would be a button the server answers 403 to.
export const INSPECTION_WRITE_ROLES = ["admin", "pm"];
export const INSPECTION_READ_ROLES = [...INSPECTION_WRITE_ROLES, "owner"];
export const mayWriteInspection = (role) =>
  INSPECTION_WRITE_ROLES.includes(String(role || ""));
