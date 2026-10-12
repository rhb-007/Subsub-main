// A TENANT'S REPORT, DRAFTED FROM THEIR PHOTOS.
//
// Asked for as "AI should be able to scan the image and automatically write a
// description of the issues in the picture ... fully automated on the tenant
// side". The inspection screen already does this for a managing agent; a
// tenant reporting a leak was still choosing from ninety labels and then
// typing what the photograph they had just taken already showed.
//
// Everything about the request is here -- the prompt, the schema, the list
// the model may choose from and how the answer is read back -- for the reason
// `photodraft.js` gives: the route, the screen and the tests all describe
// one request, and a prompt in the route beside a schema in the test is two
// records of one fact.
//
// THE MODEL, THE SIZE AND THE THINKING SETTING ARE THE PHOTO DRAFTS' OWN.
// Not a second constant: how thinking is turned off is validated as a
// combination with the model, and a second model constant here would be a
// second place for that pairing to go wrong -- the lesson `DRAFT_THINKING`
// records and the inspection summary already follows.
import { DRAFT_MODEL, draftThinking, MAX_DRAFT_BYTES } from "./photodraft.js";
import { TENANT_PROBLEMS } from "./tenantproblems.js";

export { DRAFT_MODEL as REPORT_DRAFT_MODEL, MAX_DRAFT_BYTES as MAX_REPORT_DRAFT_BYTES };
export const reportDraftThinking = () => draftThinking(DRAFT_MODEL);

// The report form takes six photographs, so a draft reads at most six. It is
// also the whole of what one press can cost.
export const MAX_REPORT_DRAFT_PHOTOS = 6;

// What comes back is a form's worth of text and no more: a title is one line
// and the description a few sentences, and the column is a guarantee where
// the prompt is only a request.
export const MAX_DRAFT_TITLE = 100;
export const MAX_DRAFT_DESCRIPTION = 600;

// THE MODEL NEVER DECLARES AN EMERGENCY. Picking one of those labels does two
// things nothing else does: it puts the call-911 notice in front of somebody,
// and on sending it dispatches the account's emergency contractor at the
// account's expense. Both are the tenant's call. So the Emergency group is
// not in the list the model chooses from; a photograph that looks dangerous
// comes back as `urgent`, and the screen points at the Emergency choices
// rather than picking one.
const EMERGENCY_GROUP = "Emergency";
export const SOMETHING_ELSE = "Something else — I'll describe it";

// The labels the model may answer with, for this kind of building. An office
// tenant has no bath to report, so a list that offered one would let the
// model pick something the picker on the same screen never shows.
export function reportDraftChoices(where = "home") {
  const w = where === "office" ? "office" : "home";
  const out = [];
  for (const p of TENANT_PROBLEMS) {
    if (p.g === EMERGENCY_GROUP) continue;
    if (p.where !== "both" && p.where !== w) continue;
    if (!out.includes(p.label)) out.push(p.label);
  }
  if (!out.includes(SOMETHING_ELSE)) out.push(SOMETHING_ELSE);
  return out;
}

// Structured output, for the reason the inspection drafts use it: a
// description of a cracked tile will carry an apostrophe or a measurement in
// quotes sooner or later, and free-text JSON fails on exactly that. `problem`
// is an enum, so an answer naming a label the screen has never heard of
// cannot arrive at all.
export function reportDraftSchema(choices) {
  return {
    type: "object",
    properties: {
      problem: { type: "string", enum: choices },
      title: { type: "string" },
      description: { type: "string" },
      // UNREADABLE IS AN ANSWER. A dark or blurred photo is the one a model
      // describes most confidently, and an invented description sent to the
      // building's manager reads exactly like a real one.
      unclear: { type: "boolean" },
      // Looks like it could be dangerous: fire, smoke, flooding, sparking,
      // a ceiling coming down. The screen says so; it never picks for them.
      urgent: { type: "boolean" },
    },
    required: ["problem", "title", "description", "unclear", "urgent"],
    additionalProperties: false,
  };
}

// THE PROMPT. Three instructions are the ones that matter and should not be
// trimmed as padding later.
//
// **In the tenant's voice, in plain American English**, because it goes in a
// box headed "Tell us more, in your own words" and is sent as theirs once
// they press Send. **No cause and no blame**: "the tenant flooded it" or
// "old pipes" is a guess, and a guess on a repair request is the start of an
// argument about who pays. **Never invent**: see `unclear`.
export function reportDraftSystem() {
  return [
    "You are helping a tenant report a maintenance problem to their building's property manager.",
    "",
    "Look at the tenant's photos and fill in their report: which problem it is, a short title, and a short description.",
    "",
    "Rules:",
    "- problem: the closest match from the list. If nothing fits, use \"" + SOMETHING_ELSE + "\".",
    "- title: what is wrong, in a few plain words, under 80 characters. For example \"Water pooling under the kitchen sink\". No period at the end.",
    "- description: two or three sentences in the first person, as the tenant would write it, in plain American English. Say what is wrong and where it is in the photo so somebody can find it, and how bad it looks: \"There's water pooling on the cabinet floor under my kitchen sink, and the wood at the back looks swollen.\"",
    "- Give sizes or counts only when the photo actually shows them.",
    "- Do NOT say what caused it or whose fault it is, and do not guess what the repair is or what it will cost.",
    "- Do not describe or identify any person.",
    "- Never state anything the photos do not show. If they are too dark, blurred or too close to tell what is wrong, set unclear to true, use \"" + SOMETHING_ELSE + "\", and say in one short sentence what you can and cannot see.",
    "- Set urgent to true only if the photos show something that could be dangerous right now: fire, smoke, active flooding, sparking, exposed live wiring, or a ceiling or structure that looks like it could come down.",
    "",
    "The tenant will read everything before sending it and can change any of it.",
  ].join("\n");
}

// What the tenant had already said, given to the model for context. Their own
// pick and their own words outrank anything a photograph suggests, so the
// model is told about them -- and told not to hand them back word for word,
// or the draft is their own sentence returned to them.
export function reportDraftContext({ count = 1, problem = "", words = "" } = {}) {
  const lines = [];
  if (String(problem || "").trim()) lines.push(`The tenant already picked: ${String(problem).trim()}`);
  if (String(words || "").trim()) {
    lines.push(`The tenant already wrote: ${String(words).trim().slice(0, 600)}`);
    lines.push("Use that for context. Do not repeat it back.");
  }
  if (lines.length) lines.push("");
  lines.push(count === 1 ? "Fill in the report from Photo 1." : `Fill in the report from these ${count} photos.`);
  return lines.join("\n");
}

// Reading the answer back, in one place for the route and the test. A problem
// not on the list is dropped rather than trusted (structured output should
// make that impossible, and "should" is not a guard); text is trimmed and
// capped; and an unclear answer keeps its words so the screen can say what
// could not be seen, but is not offered as the report.
export function readReportDraft(parsed, choices) {
  // A clear answer with no usable problem still files under Something else,
  // rather than nothing: the form draws the title and the description only
  // once a problem is picked, so a null here filled in a report nobody could
  // see -- "Filled in from your photo" over an empty picker.
  const picked = choices.includes(parsed?.problem) ? parsed.problem : null;
  const problem = picked || (choices.includes(SOMETHING_ELSE) ? SOMETHING_ELSE : null);
  const title = String(parsed?.title || "").trim().replace(/\.$/, "").slice(0, MAX_DRAFT_TITLE);
  const description = String(parsed?.description || "").trim().slice(0, MAX_DRAFT_DESCRIPTION);
  const unclear = !!parsed?.unclear || (!title && !description);
  return { problem: unclear ? null : problem, title: unclear ? "" : title,
    description, unclear, urgent: !!parsed?.urgent };
}

// What the screen says when it cannot, beside the reasons, so a reason added
// later arrives with its words.
export const REPORT_DRAFT_REFUSALS = {
  ai_not_configured: "",
  too_big: "One of those photos was too large to read. Pick what's wrong below.",
  rate_limited: "We've read a lot of photos in a short time. Pick what's wrong below and tell us in your own words.",
  ai_unavailable: "Couldn't read your photos just now. Pick what's wrong below — your photos still go with the report.",
};
