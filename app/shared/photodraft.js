// DRAFT DESCRIPTIONS OF AN INSPECTION PHOTOGRAPH, written by a model and
// edited by the person who took it.
//
// Everything about the request lives here -- the model, the prompt, the
// schema, the size we send and the limits -- because four things have to
// agree about them: the route that calls out, the screen that presses the
// button, the tests, and the cost. A prompt written in the route and a
// schema written in the test is two records of one fact.
//
// WHAT THIS IS FOR. A managing agent walks a unit photographing what they
// find and then has to write the same forty sentences they wrote last week:
// "scuff to the wall left of the door, about 150mm". The photograph already
// says it. So the model drafts the line and the agent corrects it, which is
// a minute a room instead of ten.
//
// A DRAFT IS NOT THE RECORD, which is the same rule the document review's
// own draft follows and the reason that one is stored beside `status` rather
// than as it. `caption` is what the agent kept and is what the owner reads;
// `draft` is what the model wrote and is the team's working note. A draft
// nobody kept is not in the report -- an offer that was never accepted, the
// same line `inForce` draws about a countersignature. Nothing anywhere
// promotes one to the other without somebody pressing something.

// Sonnet 5.5. Chosen deliberately and priced before it was: at the size
// below a photograph costs 1,200 input tokens, so a twelve-photograph room
// is about four cents at $2/$10 per million. Named here rather than in the
// route so there is one place to change it.
export const DRAFT_MODEL = "claude-sonnet-5-5";

// THE SIZE WE SEND, AND IT IS A COST DECISION RATHER THAN A QUALITY ONE.
// Claude bills a picture by area -- ceil(w/28) * ceil(h/28) visual tokens --
// so a phone photograph straight off the camera (4032x3024) costs 4,784
// tokens, four times this, for detail nobody needs to see that a wall is
// scuffed. 1120 on the long edge is 1,200 tokens and is also under the
// smaller models' resolution cap, so moving the model up or down later
// cannot quietly quadruple the bill.
//
// The downscale happens in the BROWSER, which is not where it would ideally
// live. A Worker has no image processing of its own and Cloudflare's is a
// separate product behind its own setup, so the alternative was sending the
// full-size original and paying four times over. The browser already holds
// the bytes -- it fetched them to draw the thumbnail -- so it costs no
// extra round trip. What makes it safe is that the Worker does not trust
// the result: `MAX_DRAFT_BYTES` is the cap, so a hand-made request cannot
// cost more than a real one.
export const DRAFT_LONG_EDGE = 1120;
export const DRAFT_QUALITY = 0.8;
// A 1120px JPEG at that quality is around 120KB. The cap is generous enough
// not to refuse a busy photograph and far below what an original would be.
export const MAX_DRAFT_BYTES = 400 * 1024;

// One room at a time, which is the unit of the walk and the unit of the
// note the model reads for context. It also bounds what one press can cost.
export const MAX_DRAFT_PHOTOS = 12;

// A caption is a line, not an essay. The cap is on the stored value as well
// as asked for in the prompt, because a prompt is a request and a column is
// a guarantee.
export const MAX_CAPTION = 400;

// WHY NOT. One predicate, read by the route and by the screen, so the
// button cannot offer what the route refuses -- and cannot withhold what it
// would allow, which this project calls the same lie.
export function whyNotDraft({ finished = false, photos = 0, undrafted = 0, configured = true } = {}) {
  // Not configured is first: there is no key, so nothing else matters.
  if (!configured) return "ai_not_configured";
  // Finished is a one-way door. Drafting writes to the inspection, so it is
  // refused for the same reason adding a room is.
  if (finished) return "already_finished";
  if (!photos) return "no_photos";
  if (!undrafted) return "all_drafted";
  return null;
}
export const canDraft = (state) => whyNotDraft(state) === null;

// WHAT THE SCREEN SAYS WHEN IT CANNOT. Named here beside the reasons, so a
// reason added later arrives with its words rather than falling through to
// "that didn't work".
export const DRAFT_REFUSALS = {
  ai_not_configured: "Drafting isn't switched on for SubSub yet.",
  already_finished: "This inspection is finished, so it cannot be changed.",
  no_photos: "Add a photo first and this can draft a note for it.",
  all_drafted: "Every photo in this room already has a draft.",
  too_big: "One of those photos was too large to read. Try again.",
  rate_limited: "That's a lot of drafting in one go. Try again in a few minutes.",
  ai_unavailable: "Couldn't reach the drafting service. Your photos are safe — try again.",
};

// THE SCHEMA. Structured outputs rather than "reply with only JSON": a
// caption about a cracked basin will contain an apostrophe or a quoted
// measurement sooner or later, and free-text JSON fails on exactly that.
//
// `ref` is the 1-based position in the request, matching the "Photo 1:"
// labels, and never our photo id -- the id is ours and the model has no use
// for it.
export const DRAFT_SCHEMA = {
  type: "object",
  properties: {
    photos: {
      type: "array",
      items: {
        type: "object",
        properties: {
          ref: { type: "integer" },
          draft: { type: "string" },
          // UNREADABLE IS AN ANSWER, and it has to be one. A dark, blurred
          // or very close-up photograph is the one a model will confidently
          // invent a description of, and an invented line on a deposit
          // record is worse than a blank -- it reads exactly like a real
          // one. So it may say it cannot tell, and the screen says so
          // rather than seeding a confident sentence.
          unclear: { type: "boolean" },
        },
        required: ["ref", "draft", "unclear"],
        additionalProperties: false,
      },
    },
  },
  required: ["photos"],
  additionalProperties: false,
};

// THE PROMPT. Written as what a condition record is, because that is the
// thing being drafted -- not a description of a picture.
//
// Three instructions in it are the ones that matter and a later pass should
// not trim them as padding. **Condition, not contents**: a model asked to
// describe a photograph writes a tour of the room, and what the record needs
// is what is wrong with it. **No cause and no blame**: whose fault the mark
// is, is the entire deposit dispute, and a record that has already decided
// is a record the other side can attack -- so it says what is there and
// stops. And **never invent**: see `unclear` above.
// `unitWord` is deliberately NOT a parameter, and a later pass will want to
// add one. The screen varies "Unit" and "Suite" off the account kind, and
// `tenantWhere` -- the rule that decides it -- lives in the browser bundle;
// threading it in here would be a second record of that fact across a
// boundary, for one word. "Property" is correct for a flat, a house and a
// commercial suite alike, and the room name carries whatever specificity
// there is: "Suite 4 reception" says what "Bathroom 1" does not.
export function draftSystem({ kindLabel = "Move-in" } = {}) {
  return [
    `You are helping a property manager write the photo notes on a ${kindLabel.toLowerCase()} inspection of a rented property.`,
    "",
    "For each photograph, draft the one or two sentences the manager would write about it in the condition record.",
    "",
    "Write about the CONDITION, not the contents. What is damaged, worn, marked, missing, leaking or dirty — and where in the frame it is, so somebody can find it again. If the photograph shows something in good order, say that plainly.",
    "",
    "Rules:",
    "- Plain, factual, specific. Say \"scuff to the wall left of the window, roughly 150mm\" rather than \"some damage\".",
    "- Give sizes and counts only when the photograph actually shows them. Approximate with \"roughly\" rather than guessing a precise figure.",
    "- Do NOT say what caused it, who is responsible, whether it is fair wear and tear, or what it will cost. That is the manager's judgement and often the thing being argued about.",
    "- Do not describe or identify any person.",
    "- No pleasantries, no opening phrase, no \"this photo shows\". Start with the thing itself.",
    "- Never state anything the photograph does not show. If it is too dark, blurred, or too close to tell, set unclear to true and say in one short sentence what you can and cannot make out.",
    "",
    "The manager will edit every line before it is kept, so a plain draft is more useful than a confident one.",
  ].join("\n");
}

// The per-room context. The room name and the manager's own note are the
// two things that tell a bathroom basin from a kitchen one -- and the note
// is read for context and deliberately NOT to be repeated back, or the
// draft is the agent's own sentence handed to them again.
export function draftContext({ roomName = "", note = "", count = 1 } = {}) {
  const lines = [`Room: ${roomName || "unnamed"}`];
  if (String(note || "").trim()) {
    lines.push(`The manager's note on this room: ${String(note).trim()}`);
    lines.push("Use that for context. Do not repeat it back — they wrote it.");
  }
  lines.push("");
  lines.push(count === 1
    ? "Draft a note for Photo 1."
    : `Draft a note for each of the ${count} photographs, returning one entry per photograph with its ref.`);
  return lines.join("\n");
}

// Reading the answer back. One place, because the route and the test both
// need the same shape out of it, and because a model answering with eleven
// entries for twelve photographs must not shift every caption by one.
export function readDrafts(parsed, count) {
  const out = [];
  const seen = new Set();
  for (const item of Array.isArray(parsed?.photos) ? parsed.photos : []) {
    const ref = Number(item?.ref);
    // Keyed by ref, never by position in the array. A model that answers
    // out of order or skips one would otherwise caption the wrong
    // photograph -- which on a condition record is not a cosmetic error.
    if (!Number.isInteger(ref) || ref < 1 || ref > count || seen.has(ref)) continue;
    const text = String(item?.draft || "").trim().slice(0, MAX_CAPTION);
    if (!text) continue;
    seen.add(ref);
    out.push({ ref, draft: text, unclear: !!item?.unclear });
  }
  return out;
}
