// Move-in and move-out inspections arriving from somebody else's system.
//
// The shape of the loop: a managing agent walks the unit in whatever they
// already walk units in -- an inspection app, a tablet form, their own
// spreadsheet -- and that system posts the walk here. It lands in SubSub as a
// DRAFT inspection with its rooms and conditions on it, which is the screen
// the account opens to raise the work: flagged rooms, suggested trades, one
// press to a job.
//
// Nothing about raising the job or assigning anybody happens here, and the
// inspection is deliberately NOT finished on arrival. That is the same line
// `/api/v1/jobs` draws -- this is the arrival, not the hiring -- plus one
// reason specific to this object: finishing is a ONE-WAY DOOR. It is what
// makes the document quotable months later, it is what writes the summary,
// and it is what lets the report be sent to the building's owner. A receiver
// that finished them would bake an unrecognised condition word permanently
// into a document nobody can edit. The account presses Finish, which is one
// tap, and that press is also what writes the summary -- so nothing is lost
// by waiting for it.
//
// This module is the one place the rules live, for the reason `ingest.js`
// gives: the route that accepts the post, the published documentation and the
// tests all describe these fields, and they are written by different hands at
// different times. A field required by the route and optional on the page is
// an integration that fails at 2am against documentation saying it works.
//
// WHAT IS REQUIRED, and why each one rather than every column an inspection
// has:
//
//   externalId  Their own id for the walk. Not for us -- for RETRIES. A
//               webhook that does not get a 200 sends again, and one walk
//               becoming four inspections is four jobs raised for one unit.
//   kind        move_in or move_out. `inspections.kind` is NOT NULL, and the
//               whole value of the record is two DATED walks of one unit:
//               "the carpet was like that when I moved in" is the commonest
//               dispute in the business and the kind is the answer to it.
//               Refused rather than guessed, because the two are opposite
//               documents and getting it wrong decides that dispute wrongly.
//   property    A building on this account. Unlike a job, an inspection has
//               no address of its own -- `inspections.property_id` is NOT
//               NULL -- so there is nowhere to put a bare street. Either the
//               id, or a name or address matched against the account's own
//               buildings.
//   rooms       At least one. An inspection with no rooms is a document that
//               says nothing while looking like it says something, which is
//               the same reason `whyNotFinish` refuses to sign one off.
//
// WHAT IS DELIBERATELY NOT ACCEPTED: photographs. A photograph is bytes and
// this is a JSON webhook, so carrying them would mean base64 inside the
// payload with its own size ceiling, its own content-type checking and its
// own R2 path -- a second upload route, next to the checked one the screen
// already uses. The rooms, the conditions and the notes arrive; the pictures
// are added on the screen. Said here rather than left to be discovered.

import { INSPECTION_KINDS, MAX_ROOMS, isRoomStatus } from "./inspection.js";
import { atPath, unwrap, toDate } from "./crmsources.js";

export const INSPECT_INGEST_VERSION = "v1";

// Provenance. An inspection app is not a CRM, so this is its own list rather
// than `SOURCES` from ingest.js: nothing is gained by letting an inspection
// claim it came from JobNimbus. `other` is what the header route records when
// the caller names nothing -- somebody's in-house form is a real answer and
// refusing it would make them lie about what they run.
//
// The invariant between this and INSPECT_PRESETS below is the one
// `crmsources.js` keeps: every preset name must be a valid provenance label,
// or a receiver would write a row tagged with something this list refuses.
export const INSPECT_SOURCES = ["generic", "other"];

export const INSPECT_REQUIRED_FIELDS = ["externalId", "kind", "property", "rooms"];

// Listed rather than inferred, so the page and the route cannot drift: a field
// the route quietly accepts and nothing documents is a field that disappears
// in the next refactor.
export const INSPECT_OPTIONAL_FIELDS = [
  "source", "propertyId", "unit", "tenantName", "inspectedOn",
];

export const EXTERNAL_ID_MAX = 200;
export const UNIT_MAX = 40;
export const TENANT_MAX = 120;
export const ROOM_NAME_MAX = 80;
export const ROOM_NOTE_MAX = 2000;
// Bounded because it is indexed and compared, and because a queue row is read
// by a person: a 4KB condition "word" is not a word.
export const MATCH_VALUE_MAX = 120;

// Whole values, case-insensitive, and punctuation-insensitive -- so
// `move-in`, `move_in`, `Move In` and `moveIn` are one answer. Not prefixes:
// the rule `crmmap.js` keeps, for the reason it keeps it.
const norm = (v) => String(v ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const str = (v) => (v == null ? "" : String(v).trim());

// WHICH WALK THIS WAS, from their word for it.
//
// Every spelling of the two, and nothing else: an unrecognised word is
// REFUSED rather than defaulted, because a move-in and a move-out are
// opposite documents and the whole point of the record is which one it is.
// Defaulting would silently file a move-out as the move-in it is about to be
// compared against.
const KIND_WORDS = {
  move_in: ["move in", "movein", "moving in", "check in", "checkin", "move in inspection",
    "in", "arrival", "start of tenancy", "tenancy start"],
  move_out: ["move out", "moveout", "moving out", "check out", "checkout", "move out inspection",
    "out", "departure", "end of tenancy", "tenancy end", "vacate", "vacating"],
};
export function inspectKindFor(raw) {
  const want = norm(raw);
  if (!want) return null;
  if (Object.prototype.hasOwnProperty.call(INSPECTION_KINDS, String(raw || "").trim())) {
    return String(raw).trim();
  }
  for (const [kind, words] of Object.entries(KIND_WORDS)) {
    if (words.some((w) => norm(w) === want)) return kind;
  }
  return null;
}

// WHAT THEIR CONDITION WORD MEANS HERE.
//
// SubSub has four room statuses and every inspection app has its own scale:
// pass/fail, good/fair/poor, 1-5, A/B/C. So the words below are the ones that
// are near-universal, and anything else is the ACCOUNT'S to answer once --
// which is the same shape as a CRM's job types, with one difference worth
// stating, because it decides what is in this table.
//
// THERE ARE NO SYNONYMS FOR `unchecked`, AND THAT IS NOT AN OMISSION.
// `unchecked` is already what an unrecognised word falls back to. So a
// built-in synonym for it -- `n/a`, `skipped`, `unknown`, `not inspected` --
// would produce exactly the room an unrecognised word already produces, and
// buy one thing only: SILENCE in the work queue. Silence about rooms nobody
// has walked is the one thing an inspection must not have, so those words go
// to the queue, where the account answers them once and then they are quiet
// for ever. The outcome for the room is identical either way; the difference
// is whether anybody was told, and that is the whole of why the queue exists.
//
// Nor is there a fifth status for "does not apply". That would have to be
// answered by `inspectionTally`, `whyNotFinish`, `flaggedRooms`,
// `suggestTrades`, `inspectionJobScope`, `contractorInspectionShape`, the
// chips and the room form -- eight places for a word -- and this is a
// receiver, not the place to decide what an inspection can say. A room that
// does not apply is removed on the screen.
export const STATUS_WORDS = {
  ok: ["ok", "okay", "good", "pass", "passed", "fine", "clean", "excellent",
    "satisfactory", "acceptable", "no issues", "no issue", "none noted", "as new", "new"],
  // Something to come back for, and not a failure. A scuffed wall and a
  // cracked basin need different words and the same next step, which is why
  // both of these are flagged -- `docs.js`'s expired-and-never-added rule.
  follow_up: ["follow up", "followup", "fair", "minor", "needs attention", "attention",
    "monitor", "watch", "worn", "wear", "wear and tear", "marginal", "cosmetic",
    "average", "needs cleaning", "touch up"],
  fail: ["fail", "failed", "poor", "bad", "damaged", "damage", "broken", "unacceptable",
    "replace", "needs replacing", "not working", "faulty", "severe", "urgent",
    "unsafe", "missing"],
};

// The status a room earns, and the word that produced it.
//
// RULES FIRST, SYNONYMS SECOND. An account's own answer has to be able to
// override one of ours: their "Fair" may well mean follow-up where this list
// says it is fine, and a built-in that outranked the account's rule would be
// a setting that does nothing.
//
// The fallback is `unchecked`, which is the STRICT direction deliberately.
// Falling back to `ok` would assert that somebody walked the room and found
// nothing wrong -- a claim, on a document a deposit argument is run from,
// that nobody made.
export function roomStatusFor(raw, rules) {
  const word = str(raw).slice(0, MATCH_VALUE_MAX);
  if (!word) return { status: "unchecked", word: "", matched: false };
  const want = norm(word);
  for (const r of rules || []) {
    if (!isRoomStatus(r?.status)) continue;         // a stale rule, not a refusal
    if (norm(r?.value) !== want) continue;
    return { status: r.status, word, matched: true };
  }
  // Their word may already BE one of ours, which is what the generic preset
  // expects of a system posting SubSub's own vocabulary.
  if (isRoomStatus(word)) return { status: word, word, matched: true };
  for (const [status, words] of Object.entries(STATUS_WORDS)) {
    if (words.some((w) => norm(w) === want)) return { status, word, matched: true };
  }
  return { status: "unchecked", word, matched: false };
}

// An account's rule on the way in. Validated, never trusted -- the same shape
// as `validRule` one feature along.
export function validStatusRule(r) {
  const value = str(r?.value).slice(0, MATCH_VALUE_MAX);
  if (!value) return null;
  const status = str(r?.status);
  // A rule mapping to a status that does not exist is a rule that fires and
  // does nothing, which would look exactly like one that was set up.
  if (!isRoomStatus(status)) return null;
  return { value, status };
}

// Where each of our fields lives in their payload, first one that answers.
//
// One preset, and NO PRESET FOR AN APP WHOSE REAL PAYLOAD NOBODY HAS SEEN.
// That is the rule `crmsources.js` states and the licensing dataset runs on:
// inventing plausible field names for an inspection app produces an
// integration that looks supported, fails on first contact, and fails in the
// way that is hardest to debug -- silently, against a page saying it works.
// `verified` records which ones somebody has had a payload in front of them
// for, and today that is ours.
export const INSPECT_PRESETS = {
  generic: {
    // Three strings because they go three places with different jobs: a noun
    // inside a sentence, a name inside a row, and the option somebody picks,
    // which has to teach. Same reason `SOURCE_PRESETS` has three.
    label: "inspection",
    short: "your own system",
    pick: "Anything else — your inspection app, Zapier, Make, n8n, your own script",
    verified: true,
    wrap: ["data", "inspection", "payload"],
    dateFormat: "iso",
    fields: {
      externalId: ["externalId", "external_id", "id", "inspectionId", "inspection_id", "reference"],
      kind: ["kind", "type", "inspectionType", "inspection_type", "purpose"],
      propertyId: ["propertyId", "property_id"],
      property: ["property", "propertyName", "property_name", "building", "address", "site"],
      unit: ["unit", "unitNumber", "unit_number", "apartment", "apt"],
      tenantName: ["tenantName", "tenant_name", "tenant", "resident", "occupant"],
      inspectedOn: ["inspectedOn", "inspected_on", "date", "inspectedAt", "inspected_at",
        "completedAt", "completed_at"],
      rooms: ["rooms", "items", "areas", "lines"],
      roomName: ["name", "room", "area", "label", "item", "title"],
      roomStatus: ["status", "condition", "rating", "result", "state", "grade"],
      roomNote: ["note", "notes", "comment", "comments", "description", "detail"],
    },
  },
};
export const isInspectSource = (s) =>
  Object.prototype.hasOwnProperty.call(INSPECT_PRESETS, String(s || ""));

const first = (obj, keys) => {
  for (const k of keys || []) {
    const v = str(atPath(obj, k));
    if (v) return v;
  }
  return "";
};

// Errors are per-field with a machine-readable code, because the caller is a
// program -- and named in THEIR vocabulary where the preset has one, because
// an integrator reading `externalId is missing` has never heard of our name
// for their id.
const bad = (field, code, message) => ({ field, code, message });
const theirs = (keys) => (Array.isArray(keys) ? keys[0] : keys) || "field";

// The whole translation and check, driven by the preset. Returns our shape,
// plus the raw condition words so the caller can map them against the
// account's rules -- which this module deliberately does not do here, because
// the rules come out of the database and this file has none.
export function readInspection(body, { preset = INSPECT_PRESETS.generic } = {}) {
  const record = unwrap(body, preset);
  if (!record) {
    return { ok: false, errors: [bad(null, "invalid_body", "The request body must be a JSON object.")] };
  }
  const f = preset.fields;
  const errors = [];

  const externalId = first(record, f.externalId);
  if (!externalId) {
    errors.push(bad(theirs(f.externalId), "required",
      "Your own id for this inspection, so a retry updates it rather than creating a second one."));
  } else if (externalId.length > EXTERNAL_ID_MAX) {
    errors.push(bad(theirs(f.externalId), "too_long",
      `It must be ${EXTERNAL_ID_MAX} characters or fewer.`));
  }

  const rawKind = first(record, f.kind);
  const kind = inspectKindFor(rawKind);
  if (!kind) {
    errors.push(bad(theirs(f.kind), rawKind ? "not_understood" : "required",
      `Whether this was a move-in or a move-out walk. SubSub reads ${Object.keys(INSPECTION_KINDS).join(" and ")}.`));
  }

  const propertyId = first(record, f.propertyId);
  const property = first(record, f.property);
  if (!propertyId && !property) {
    errors.push(bad(theirs(f.property), "required",
      "Either propertyId, or the name or address of a building already on your account."));
  }

  // Rooms. A room with no NAME is dropped rather than refused: a trailing
  // blank line in somebody's export is not a reason to lose the walk, and a
  // room called nothing cannot be read on any screen anyway. A room with no
  // CONDITION is kept and lands unchecked, which is the honest answer and is
  // deliberately NOT a queue row -- nothing arrived that we failed to
  // understand.
  let rooms = null;
  const rawRooms = atPath(record, (f.rooms || []).find((k) => atPath(record, k) !== undefined) || "");
  if (!Array.isArray(rawRooms) || rawRooms.length === 0) {
    errors.push(bad(theirs(f.rooms), "required",
      "At least one room or item, each with a name. This is the walk."));
  } else if (rawRooms.length > MAX_ROOMS) {
    errors.push(bad(theirs(f.rooms), "too_many", `An inspection holds at most ${MAX_ROOMS} rooms.`));
  } else {
    rooms = [];
    for (const raw of rawRooms) {
      // A bare string is a room name with nothing said about it, which is how
      // a checklist exports before anybody has walked it.
      const one = typeof raw === "string" ? { name: raw } : raw;
      if (!one || typeof one !== "object" || Array.isArray(one)) continue;
      const name = (typeof raw === "string" ? str(raw) : first(one, f.roomName)).slice(0, ROOM_NAME_MAX);
      if (!name) continue;
      rooms.push({
        name,
        rawStatus: first(one, f.roomStatus).slice(0, MATCH_VALUE_MAX),
        note: first(one, f.roomNote).slice(0, ROOM_NOTE_MAX) || null,
      });
    }
    if (!rooms.length) {
      errors.push(bad(theirs(f.roomName), "required",
        "Every room was missing a name, so there is nothing to record."));
      rooms = null;
    }
  }

  const source = str(atPath(record, "source")).toLowerCase();
  if (source && !INSPECT_SOURCES.includes(source)) {
    errors.push(bad("source", "unknown_source", `source must be one of: ${INSPECT_SOURCES.join(", ")}.`));
  }

  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    inspection: {
      externalId, kind, source: source || null,
      propertyId: propertyId || null,
      property: property || null,
      unit: str(first(record, f.unit)).slice(0, UNIT_MAX) || null,
      tenantName: str(first(record, f.tenantName)).slice(0, TENANT_MAX) || null,
      // A real calendar day or nothing. `toDate` refuses month fourteen and
      // 31 February, which is the guard that stops a walk being filed on a
      // date that sorts like one and is not one.
      inspectedOn: toDate(first(record, f.inspectedOn), preset.dateFormat) || null,
      rooms,
    },
  };
}
