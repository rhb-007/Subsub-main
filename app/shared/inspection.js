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

// WHERE THE WALK HAS GOT TO, AS STEPS.
//
// The screen held every control an inspection needs and said nothing about
// the order they are used in. Reported as wanting "more of a step by step
// walk through, ie add another room? get started by adding your first room
// here, recommended trades, assign sub contractors or handyman or later" --
// which is not a request for a wizard. A wizard narrows what is available,
// and this screen is used standing in an empty flat where the one thing that
// must never happen is a control being out of reach: somebody photographs
// the bathroom while they are in it, not when a sequence says to.
//
// So the steps POINT, they do not GATE. Nothing here hides a button, refuses
// an upload or changes what the server will accept; what it adds is a name
// for where you are and one control for the next thing. Every existing
// affordance stays exactly where it was.
//
// IT IS THE ONE RULE, read by the strip, the card and the tests, because
// three answers to "what is next" is how they come to disagree -- the same
// reason `inspectionTally` exists rather than a count per screen.
//
// THE ORDER IS ROOMS, WALK, WORK, FINISH, and work before finish is
// deliberate: this product already offers Raise a job the moment something is
// flagged, finished or not, because the leak does not wait for the paperwork.
// A strip that put finishing first would be telling somebody to do the
// paperwork before the repair, which is the opposite of what the screen does.
//
// AND `send` IS A STEP ONLY WHEN THERE IS SOMEBODY TO SEND TO. A building
// with no owner seat on it has nothing to send and never will, so listing it
// would leave a step that can never be ticked on every inspection of every
// building the account owns itself -- the permanently-amber failure
// `docs.js` exists to prevent, wearing a fifth number. The send panel keeps
// its own "add an owner" way in for the case where one should exist.
export const INSPECTION_STEPS = [
  { id: "rooms", label: "Rooms" },
  { id: "walk", label: "Walk it" },
  { id: "work", label: "The work" },
  { id: "finish", label: "Finish" },
  { id: "send", label: "Send it" },
];

export function inspectionStep({ inspection = {}, rooms = [], recipients = [], sends = [] } = {}) {
  const t = inspectionTally(rooms);
  const finished = inspection.status === "finished";
  const raised = !!inspection.jobId;
  const canSend = (recipients || []).length > 0;
  const had = new Set((sends || []).map((s) => s && s.userId));
  const waiting = (recipients || []).filter((u) => u && !had.has(u.id));

  const done = {
    rooms: t.rooms > 0,
    walk: t.rooms > 0 && t.unchecked === 0,
    // Nothing flagged is not an unfinished step, it is the best possible
    // answer to one. An all-clear walk must not sit for ever on "raise the
    // work" over a unit with nothing wrong in it.
    work: t.rooms > 0 && (t.flagged === 0 ? t.unchecked === 0 : raised),
    finish: finished,
    send: canSend && waiting.length === 0,
  };
  const steps = INSPECTION_STEPS.filter((s) => s.id !== "send" || canSend);
  const at = steps.find((s) => !done[s.id]) || null;

  return {
    steps: steps.map((s) => ({ ...s, done: !!done[s.id], now: !!at && at.id === s.id })),
    at: at ? at.id : null,
    tally: t,
    // WHAT THE CARD SAYS, decided here rather than on the screen so the words
    // and the step cannot disagree about which one is current.
    //
    // `nudge` is the thing worth offering that is NOT holding anything up:
    // putting somebody on the job that was raised. The request said "or
    // later" and meant it -- doing nothing IS later, so there is no second
    // button to press for it, and the step counts as done the moment the job
    // exists. A nag over a job somebody has decided to leave is how people
    // learn to stop reading the card.
    nudge: raised ? "assign" : null,
    flagged: t.flagged,
    unchecked: t.unchecked,
    waiting,
    finished,
    raised,
  };
}

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

// ---------------------------------------------------------------------------
// WHICH TRADES THE FLAGGED ROOMS ARE ASKING FOR
// ---------------------------------------------------------------------------
//
// Raising a job opened a grid of twenty-nine trades with nothing ticked, and
// the person who has just walked a unit and written "trim needs to be
// repaired" has already said which one it is. Making them find Finish
// Carpentry in a wall of chips is asking them to say it twice, and a form
// that asks twice is a form abandoned at the second time of asking.
//
// IT READS THE WORDS, AND ONLY THE WORDS. The photographs are not read and
// nothing here pretends otherwise -- that needs a vision model, which is an
// outbound call, a key, a cost per inspection and a decision about a tenant's
// photographs leaving this origin. The notes are where the signal already is,
// and this costs nothing and runs offline.
//
// IT IS A SUGGESTION AND NEVER AN ANSWER. Every chip it ticks can be
// un-ticked, nothing is locked, and the screen says the ticks came from the
// notes rather than from the person -- a preselection somebody mistakes for
// their own choice is worse than an empty grid, because they will not read
// it. Wrong-and-visible is cheap; wrong-and-silent is not.

// Word to trade. Whole words, never substrings -- "pane" inside "panel" and
// "ac" inside "crack" are how a glazier ends up on a job nobody is glazing,
// which is the same instinct `crmmap.js` records for a different reason. A
// phrase is matched whole.
export const TRADE_HINTS = {
  plumbing: ["leak", "leaks", "leaking", "leaked", "drip", "drips", "dripping",
    "tap", "taps", "faucet", "faucets", "basin", "sink", "sinks", "toilet", "toilets",
    "cistern", "shower", "bath", "bathtub", "plumb", "plumbing", "plumber",
    "drain", "drains", "drainage", "blocked", "waste pipe", "pipe", "pipes",
    "water pressure", "hot water", "no water", "running water"],
  electrical: ["socket", "sockets", "outlet", "outlets", "switch", "switches",
    "wiring", "wire", "wires", "electrical", "electric", "electrician",
    "fuse", "breaker", "fitting", "fittings", "bulb", "bulbs", "no power",
    "smoke alarm", "smoke alarms", "smoke detector", "co detector", "light",
    "lights", "lighting"],
  hvac: ["heating", "heater", "furnace", "boiler", "radiator", "radiators",
    "thermostat", "air con", "aircon", "air conditioning", "hvac", "vent",
    "vents", "ventilation", "extractor", "cooling", "no heat"],
  painting: ["paint", "paints", "painted", "painting", "repaint", "scuff",
    "scuffs", "scuffed", "scratch", "scratches", "scratched", "mark", "marks",
    "marked", "stain", "stains", "stained", "wall", "walls", "touch up",
    "touch-up", "nail hole", "nail holes", "filler", "peeling", "chipped"],
  drywall: ["drywall", "sheetrock", "plasterboard", "plaster", "patch",
    "patching", "hole in the wall", "holes in the wall"],
  flooring: ["carpet", "carpets", "floor", "floors", "flooring", "laminate",
    "vinyl", "lino", "floorboard", "floorboards", "hardwood", "underlay",
    "subfloor"],
  tile_stone: ["tile", "tiles", "tiled", "tiling", "grout", "grouting",
    "stone", "marble", "backsplash"],
  cabinets_counters: ["cabinet", "cabinets", "cupboard", "cupboards", "drawer",
    "drawers", "countertop", "countertops", "counter", "worktop", "vanity"],
  trim_carpentry: ["trim", "trims", "skirting", "baseboard", "baseboards",
    "moulding", "molding", "architrave", "casing", "shelf", "shelves",
    "handrail", "banister", "carpentry", "carpenter"],
  windows_doors: ["window", "windows", "door", "doors", "lock", "locks",
    "latch", "handle", "handles", "hinge", "hinges", "screen", "screens",
    "glazing", "glass", "pane", "panes", "frame", "frames"],
  cleaning: ["clean", "cleans", "cleaned", "cleaning", "dirty", "dirt",
    "filthy", "grime", "grimy", "dust", "dusty", "rubbish", "trash", "debris",
    "mess", "messy", "odour", "odor", "smell", "smells", "stale"],
  restoration: ["water damage", "flood", "flooded", "flooding", "damp",
    "mould", "mold", "mildew", "smoke damage", "fire damage", "soot",
    "water stain", "water stains"],
  landscaping: ["garden", "lawn", "grass", "hedge", "weeds", "overgrown",
    "shrub", "shrubs", "tree", "trees"],
  hardscaping: ["driveway", "paving", "pavers", "path", "paths"],
  deck_fence: ["deck", "decking", "fence", "fences", "fencing", "gate",
    "gates", "railing", "railings"],
  garage_doors: ["garage door", "garage doors", "roller door", "up and over"],
  roofing: ["roof", "roofs", "roofing", "shingle", "shingles", "flashing"],
  gutters: ["gutter", "gutters", "downpipe", "downpipes", "downspout"],
  masonry: ["brick", "bricks", "brickwork", "mortar", "pointing", "render"],
  concrete: ["concrete", "slab", "screed"],
  insulation: ["insulation", "insulated", "draught", "draughty", "drafty"],
};

// A ROOM THAT NAMES A SYSTEM SAYS WHICH TRADE; A ROOM THAT NAMES A SPACE
// DOES NOT. "Shower and bath" is plumbing whatever is wrong with it, while
// "Bathroom 1" flagged for a cracked mirror is not -- so the spaces are
// deliberately absent and the note decides for them. Getting this backwards
// would tick plumbing on every bathroom in the building.
export const ROOM_TRADES = {
  "sink and taps": "plumbing",
  "toilet": "plumbing",
  "shower and bath": "plumbing",
  "heating and cooling": "hvac",
  "smoke alarms": "electrical",
  "outlets and switches": "electrical",
  "lighting and fixtures": "electrical",
  "windows and screens": "windows_doors",
  "doors and locks": "windows_doors",
  "cabinets and drawers": "cabinets_counters",
};

const WORD_RE = {};
const hitsWord = (hay, word) => {
  // Built once per word and kept: this runs over every flagged room every
  // time the modal re-renders, and recompiling two hundred regexes per
  // keystroke is the sort of thing that makes a phone feel broken.
  let re = WORD_RE[word];
  if (!re) {
    const esc = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    re = WORD_RE[word] = new RegExp(`(^|[^a-z0-9])${esc}([^a-z0-9]|$)`, "i");
  }
  return re.test(hay);
};

// Lowercased, punctuation flattened to spaces, so "floors," and "floors" are
// the same word and a note written in one run-on line still matches.
const flatten = (s) => ` ${String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;

// A WORD THAT ONLY SAYS WHERE THE DAMAGE IS, IS NOT THE DAMAGED THING.
//
// "Scuff to the wall left of the door" is painting. Read whole-word it also
// says `door`, so it called a glazier -- and this is not a rare phrasing,
// it is the one the photo-draft prompt explicitly asks for ("where in the
// frame it is, so somebody can find it again"). So a noun that arrives
// behind a positional preposition is dropped before matching.
//
// Deliberately applied to the NOTE as well as the caption: a manager writes
// the same sentence, and two rules for one fact is how the two come to
// disagree about "beside the sink".
const WHERE = /\b(?:(?:to |on |at )?the )?(?:left|right) of the \w+|\b(?:next to|beside|nearest|near|above|below|behind|under|underneath|opposite|by) the \w+/g;
const dropWhere = (s) => String(s || "").replace(WHERE, " ");

// WHAT A PHOTOGRAPH CONTRIBUTES, AND WHY IT COSTS NOTHING.
//
// This module was written reading the room name and the note, and recorded
// the limit out loud: reading a picture needs a vision model, a key, a cost
// per inspection, and the inside of a tenant's home leaving this origin.
//
// All four of those were then paid for by the photo drafts -- which turn
// each picture into a sentence about its condition, written to the row. So
// the pictures are **already words** by the time anybody raises a job, and
// reading them here is free: no second call, no second charge, nothing new
// leaving. A caption saying "hairline crack across the basin" names plumbing
// exactly as a note saying it would.
//
// WHICH MEANS THE SUGGESTION IS ONLY AS GOOD AS WHAT HAS BEEN READ, and the
// screen has to say so rather than implying the pictures were looked at.
// `unread` counts photographs on flagged rooms that carry neither a caption
// nor a draft, so the modal can offer the one press that fixes it instead of
// quietly suggesting from half the evidence.
const photoWords = (p) => `${p?.caption || ""} ${p?.draft || ""}`.trim();

export function suggestTrades(rooms = []) {
  const flagged = (rooms || []).filter(isFlagged);
  const why = {};
  // Which reason words were read off a photograph rather than typed. The
  // manager wrote the notes, so a word from one is their own; a word from a
  // caption is second-hand and the screen says which -- the same rule that
  // makes an unkept draft dashed rather than silently adopted.
  const fromPhoto = new Set();
  let unread = 0;
  const add = (trade, reason, photo = false) => {
    if (!trade || !reason) return;
    (why[trade] ||= []);
    if (!why[trade].includes(reason)) why[trade].push(reason);
    if (photo) fromPhoto.add(reason);
  };

  for (const r of flagged) {
    const name = String(r?.name || "").trim();
    const roomTrade = ROOM_TRADES[name.toLowerCase()];
    if (roomTrade) add(roomTrade, name);
    // The note and the room name are read together: somebody writing
    // "Kitchen" in the name box and "tap drips" in the note has said both
    // halves, and only one of them is in either field.
    const hay = flatten(`${name} ${dropWhere(r?.note)}`);
    for (const [trade, words] of Object.entries(TRADE_HINTS)) {
      for (const w of words) {
        if (hitsWord(hay, w)) { add(trade, w); break; }
      }
    }
    // THE PHOTOGRAPHS, through what was written about them. Read per photo
    // rather than as one blob, so a caption is never joined to the next
    // one's first word and matched across the seam.
    for (const p of r?.photos || []) {
      const text = photoWords(p);
      if (!text) { unread += 1; continue; }
      const shot = flatten(dropWhere(text));
      for (const [trade, words] of Object.entries(TRADE_HINTS)) {
        for (const w of words) {
          if (hitsWord(shot, w)) { add(trade, w, true); break; }
        }
      }
    }
  }
  return { trades: Object.keys(why), why, fromPhoto, unread };
}
