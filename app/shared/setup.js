// What is still blank on a contractor record, and which step of the form
// fills it in.
//
// THE RECORD AND THE LOGIN ARE TWO DIFFERENT THINGS, which this file has
// already recorded about the staff console's "Not arrived" screen: a
// `companies` row plus an `engagements` row is what an account gets the
// moment it adds or invites somebody, and a login is a `users` row written
// only when they open the invite and fill the form in. So a roster can hold
// ten contractors with nine of them unable to sign in -- and those nine have
// a half-filled record that nobody is coming to finish.
//
// The account could always finish it: `PATCH /api/subs/:companyId` accepts
// the company half precisely when nobody answers for that company, which is
// exactly this population. What was missing is the same thing this file keeps
// finding -- the way in. "Edit" is a generic word on a card; it does not read
// as "they have not done this and you may".
//
// NAMING THE GAPS IS THE POINT, not counting them. "Setup incomplete" sends
// somebody into a three-step form to hunt; a list of four things with the
// step each one is on is a list somebody can finish. Same rule as the
// compliance pack naming what is missing rather than reading "2 of 4", and
// the same rule as `openPane.focus` pointing rather than landing.
import { REQUIRED_KINDS, DOC_LABELS } from "./docs.js";

// The steps are SubForm's own, so a gap can say where it is filled in. A
// fourth number here and a third step there would be two records of one
// fact; if that form ever gains a step, this is the other half to move.
export const SETUP_STEPS = { company: 1, work: 2, paperwork: 3 };

const has = (v) => typeof v === "string" ? !!v.trim() : !!v;
const someCrewMember = (crews) => (Array.isArray(crews) ? crews : [])
  .some((c) => (c?.members || []).some((m) => has(m?.name)));

// Coverage is "where will you work", and it is stored two ways: a list of
// towns or a list of ZIP-plus-radius. Empty is empty either way -- and the
// column is TEXT NOT NULL DEFAULT '{}', so `{}` is truthy and the obvious
// `!!sub.coverage` answers yes to a contractor who covers nowhere. Same trap
// `MyCoverage` already records.
const hasCoverage = (c) => {
  if (!c || typeof c !== "object") return false;
  if ((c.cities || []).length > 0) return true;
  return (c.radii || []).some((r) => r && r.zip && r.miles);
};

// DOCUMENTS ARE PRESENCE, NEVER VERIFICATION, and that is deliberate.
// Verification is the hiring account's own verdict on a document somebody
// else supplied; a gap the account cannot close by acting is not a setup
// step, it is a to-do that reopens itself. Uploading on their behalf closes
// this one, and reviewing it is a separate act with its own screen. Same
// rule the send gate follows.
//
// REQUIRED_KINDS rather than DOC_KINDS, so the signed agreement is not on
// the list: it is the hiring account's own paperwork, optional by decision,
// and a row demanding one is the permanently-amber failure `docs.js` exists
// to prevent.
export function setupGaps(sub) {
  if (!sub) return [];
  const g = [];
  const add = (key, label, step) => g.push({ key, label, step });

  if (!has(sub.contact)) add("contact", "Who to speak to", SETUP_STEPS.company);
  // One or the other, never both: a contractor reachable by mobile and not
  // by email is completely set up, and asking for the second is a box that
  // can never be ticked for somebody who does not have one.
  if (!has(sub.email) && !has(sub.phone)) add("reach", "An email or a mobile", SETUP_STEPS.company);
  if (!has(sub.city) && !has(sub.zip)) add("where", "Where they are based", SETUP_STEPS.company);

  if (!(sub.categories || []).length) add("trades", "What they do", SETUP_STEPS.work);
  if (!hasCoverage(sub.coverage)) add("coverage", "Where they will work", SETUP_STEPS.work);

  if (!someCrewMember(sub.crews)) add("crews", "At least one crew", SETUP_STEPS.paperwork);
  for (const k of REQUIRED_KINDS) {
    if (!sub[k]) add(k, DOC_LABELS[k] || k, SETUP_STEPS.paperwork);
  }
  return g;
}

// WHO MAY BE FINISHED FOR, which is one predicate rather than two.
//
// It reads `answersForItself` -- unscoped, "does anybody anywhere answer for
// this company" -- and never `hasPortal`, which is scoped to the asking
// account. A roofer whose only login is on ANOTHER general contractor's
// account answers no to `hasPortal` here and yes to this, and the server
// refuses that write with `company_not_yours`. Offering the form anyway is
// the screen-looser-than-the-route lie, which is the exact bug `SubForm`'s
// own lock already had and the reason that comment is three paragraphs long.
//
// It also happens to be the whole of what "they have not set up their own
// account yet" means: nobody answering for them anywhere IS nobody having
// signed in as them anywhere.
export const mayFinishSetup = (sub) => !!sub && !sub.answersForItself;

// Where "Continue setup" should land. The first step with something on it,
// because a form that opens at step 1 over a complete step 1 has answered
// "here is the form" when the question was "what is still missing".
export const firstGapStep = (gaps) =>
  (gaps || []).reduce((n, x) => Math.min(n, x.step), SETUP_STEPS.paperwork);
