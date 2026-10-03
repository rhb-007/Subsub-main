// THE SUMMARY A WORK ORDER CARRIES, written from the comments on the flagged
// rooms and read by the person who is going to do the work.
//
// Everything about the request lives here -- the model, the prompt, the
// schema, what gets summarised and the caps -- for the reason
// `photodraft.js` exists: four things have to agree about them, which are the
// route that calls out, the screen that draws the result, the tests, and the
// cost. A prompt written in the route and a schema written in the test is two
// records of one fact.
//
// WHAT THIS IS FOR. 062 gave the work order the flagged rooms, their notes
// and their photographs, which is the record. What that does not answer is
// the question somebody pricing the work asks first: *what is this job, in
// total.* Eleven rooms each carrying a line about a scuff is eleven lines to
// read and add up, and the thing actually worth knowing -- that it is one
// repaint across four rooms plus one tap -- is on none of them. A list cannot
// say that about itself. So the comments are combined once, at the top.
//
// A SUMMARY IS NOT THE RECORD. The rooms stay underneath it in full and stay
// the thing a deposit argument is run from: a subcontractor pricing the work
// must be able to read what the manager actually wrote, and a paragraph that
// replaced it would be a model's reading of somebody's home standing in for
// the account's own words. Same rule `photodraft.js` keeps between a caption
// and a draft, and the same reason it is stored in its own table rather than
// on the inspection.

import { INSPECTION_KINDS, ROOM_STATUSES, contractorInspectionShape, flaggedRooms } from "./inspection.js";

// THE MODEL IS THE DRAFTS' MODEL, deliberately not a second constant.
//
// How you turn thinking off is a per-model property of the API and it is
// validated as a COMBINATION with the model rather than as a field of its own
// -- which is the whole lesson `DRAFT_THINKING` records. A second model
// constant here would be a second place for that pairing to be got wrong, and
// the one that is wrong would be the one nobody pressed this week.
//
// The two features also want the same thing from a model: plain, factual,
// cheap text about a building, read or edited by a person who will correct it.
// At this length a summary is a fraction of a cent.
import { DRAFT_MODEL, draftThinking } from "./photodraft.js";
export const SUMMARY_MODEL = DRAFT_MODEL;
export const summaryThinking = draftThinking;

// A paragraph, not a report. The cap is on the stored value as well as asked
// for in the prompt, because a prompt is a request and a column is a
// guarantee -- and a summary that runs longer than the list it summarises has
// stopped being one.
export const MAX_SUMMARY = 900;

// ---------------------------------------------------------------------------
// WHAT GETS SUMMARISED
// ---------------------------------------------------------------------------
//
// BUILT THROUGH `contractorInspectionShape`, WHICH IS THE POINT RATHER THAN A
// CONVENIENCE. That function is the redaction the work order already applies:
// flagged rooms only, the captions somebody kept and never the model's unkept
// drafts, no tenant name. Reading the source through it means the model is
// given exactly what the contractor can already read -- so a summary cannot
// contain anything its reader is not also shown, and a field added to the
// shape later cannot leak through a second path that forgot about it.
//
// Rendered the same way every time, because this text is stored and compared:
// a change of punctuation here would report every existing summary as stale.
export function summarySource(inspection = {}, rooms = []) {
  const shape = contractorInspectionShape(inspection, rooms);
  const lines = [];
  for (const r of shape.rooms) {
    lines.push(`${r.name} — ${ROOM_STATUSES[r.status]?.label || "Flagged"}`);
    if (r.note) lines.push(`  Note: ${r.note}`);
    for (const p of r.photos) if (p.caption) lines.push(`  Photo: ${p.caption}`);
  }
  return lines.join("\n");
}

// How many comments there actually are to combine, which is what decides
// whether this can run at all. A note and a kept caption each count; a
// photograph nobody wrote about does not, because the summary reads words.
export function countComments(inspection = {}, rooms = []) {
  const shape = contractorInspectionShape(inspection, rooms);
  let n = 0;
  for (const r of shape.rooms) {
    if (r.note) n += 1;
    for (const p of r.photos) if (p.caption) n += 1;
  }
  return n;
}

// WHY NOT. One predicate, read by the route and by the screen, so the button
// cannot offer what the route refuses and cannot withhold what it would
// allow -- which this project calls the same lie.
//
// `no_comments` IS THE ONE WORTH EXPLAINING. With nothing written on any
// flagged room there is nothing to combine, and a model handed "Bathroom 1 —
// Fail, Kitchen — Follow-up" will produce a confident sentence about what is
// wrong with them. An invented fault on a work order somebody is about to
// quote reads exactly like a real one, which is the `unclear` rule from the
// photo drafts arriving from the other direction: refuse rather than invent.
//
// FINISHED IS DELIBERATELY NOT A GATE, and that is the opposite answer to
// `whyNotDraft` beside it. Drafting writes to the inspection, which is a
// document somebody quotes back, so finishing shuts it. This writes a derived
// paragraph in its own table and touches nothing in the record -- and the
// moment it is most needed is after the job has been raised, which is very
// often after finishing. Gating it would leave a finished inspection whose
// automatic summary failed with no way ever to get one.
export function whyNotSummary({ configured = true, flagged = 0, comments = 0 } = {}) {
  if (!configured) return "ai_not_configured";
  if (!flagged) return "nothing_flagged";
  if (!comments) return "no_comments";
  return null;
}
export const canSummarise = (state) => whyNotSummary(state) === null;

// WHAT THE SCREEN SAYS WHEN IT CANNOT, named here beside the reasons so a
// reason added later arrives with its words rather than falling through to
// "that didn't work".
export const SUMMARY_REFUSALS = {
  ai_not_configured: "Summarising isn't switched on for SubSub yet.",
  nothing_flagged: "Nothing was flagged, so there is nothing to summarise.",
  no_comments: "Add a note or a photo caption to a flagged room first — there is nothing to combine yet.",
  rate_limited: "That's a lot of summarising in one go. Try again in a few minutes.",
  ai_unavailable: "Couldn't reach the summarising service. Nothing was changed — try again.",
  migration_needed: "This needs migration 063 before it can be saved.",
};

// ---------------------------------------------------------------------------
// WHAT THE STORED ROW READS AS
// ---------------------------------------------------------------------------
//
// STALENESS IS A COMPARISON, NOT A GUESS. A job can be raised from an
// UNFINISHED inspection -- deliberately, because the leak does not wait for
// the paperwork -- so the notes can change after the summary was written, and
// a paragraph from the old ones would read as current. `source` is what was
// actually summarised, so the answer is an equality rather than a timestamp
// race. Same rule `agreements` follows by hashing what the signer was shown
// rather than re-rendering it afterwards.
//
// `source` ITSELF NEVER TRAVELS. It is the notes and the captions, which the
// same reader already has in full underneath; carrying it would be the record
// sent twice, once in a shape nothing draws.
export function summaryShape(stored, inspection = {}, rooms = []) {
  const text = String(stored?.summary || "").trim();
  if (!text) return null;
  return {
    text,
    model: stored.model || null,
    writtenAt: stored.writtenAt || stored.written_at || null,
    stale: String(stored.source || "") !== summarySource(inspection, rooms),
  };
}

// ---------------------------------------------------------------------------
// THE REQUEST
// ---------------------------------------------------------------------------

// Structured output rather than "reply with only JSON": a summary naming a
// cracked basin carries an apostrophe or a quoted measurement sooner or
// later, and free-text JSON fails on exactly that. It also guarantees no
// opening phrase, which the prompt asks for and a model obliges with about
// nine times in ten.
export const SUMMARY_SCHEMA = {
  type: "object",
  properties: { summary: { type: "string" } },
  required: ["summary"],
  additionalProperties: false,
};

// THE PROMPT. Written as what this paragraph is FOR, because the reader is
// not the person who wrote the notes: it is a trade contractor deciding
// whether this job is for them and roughly what it takes.
//
// Four of its instructions are load-bearing and a later pass should not trim
// them as padding.
//
// **Group the pattern, do not retell the list.** The rooms are printed
// directly underneath, so a summary that walks them one by one has added a
// second copy of the thing it was supposed to save reading. Noticing that
// four rooms want one repaint is the entire value.
//
// **No cause, no blame, no cost, no priority, no instruction.** The reader is
// about to put a price on this. Whose fault the mark is, is the deposit
// dispute; what it is worth is the quote; which room to do first is the
// manager's. A model that volunteers any of them has put words in the hiring
// account's mouth on a document going to a third party.
//
// **Never add anything the notes do not say.** Everything downstream treats
// this as having come from the account.
//
// **Say when the notes are thin.** A short record is a real answer and the
// honest summary of one is short; padding it is how a paragraph comes to
// describe work nobody wrote down.
export function summarySystem({ kindLabel = "Move-out" } = {}) {
  return [
    `You are writing the short summary at the top of a work order for the trade contractor who will do the work. It comes from a property manager's ${kindLabel.toLowerCase()} inspection of a rented property.`,
    "",
    "You will be given the rooms the manager flagged, with their own notes and the captions they kept on the photographs. Combine them into two to four plain sentences saying what the work is, taken together.",
    "",
    "Rules:",
    "- Group by the KIND of work, not room by room. The rooms are listed in full directly below your summary, so repeating them one at a time adds nothing. If one fault runs through several rooms, say so once and name them — that is the thing the list cannot say about itself.",
    "- Name rooms, so a reader can match your summary to the list.",
    "- Say only what the notes and captions say. Never add a fault, a room, a measurement, a material or a cause that is not there.",
    "- Do NOT say what caused anything, who is responsible, whether it is fair wear and tear, what it will cost, how long it will take, or which to do first. Every one of those is the manager's to say and the reader is about to quote this.",
    "- Do not tell them how to do the work. Say what is wrong.",
    "- No opening phrase, no heading, no sign-off, no bullet points. Start with the work itself.",
    "- Plain words, short sentences. This is read on a phone, often at the kerb.",
    "- If the notes are thin, say so briefly rather than padding. A one-sentence summary of a one-line record is the right answer.",
  ].join("\n");
}

// The material. Kind, unit and date first so a reader of the request can tell
// which walk this was, then the rooms exactly as `summarySource` renders
// them -- the same text that gets stored, so what was asked and what
// staleness is measured against cannot drift apart.
export function summaryUser(inspection = {}, rooms = []) {
  const kind = INSPECTION_KINDS[inspection.kind]?.label || "Inspection";
  const head = [`${kind} inspection`
    + (inspection.unit ? `, unit ${inspection.unit}` : "")
    + (inspection.inspectedOn ? `, walked ${inspection.inspectedOn}` : "") + ".",
    `${flaggedRooms(rooms).length} room(s) flagged:`, ""];
  return [...head, summarySource(inspection, rooms)].join("\n");
}

// Reading the answer back. One place, because the route and the tests both
// want the same shape out of it, and because the cap is a guarantee about the
// column rather than a hope about the model.
export function readSummary(parsed) {
  return String(parsed?.summary || "").trim().replace(/\s+\n/g, "\n").slice(0, MAX_SUMMARY);
}
