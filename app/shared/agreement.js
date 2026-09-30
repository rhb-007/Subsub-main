// A subcontractor agreement, which is the one document here that is not the
// subcontractor's own.
//
// AN AGREEMENT IS BILATERAL, AND THAT IS WHY IT IS NOT A COLUMN ON
// `companies`. Insurance, a bond and a W-9 are the subcontractor's own
// records: one certificate answers every client, so a boolean on the shared
// company row is the right shape for them. An agreement is between two named
// parties. `companies.contract` said "this company has signed an agreement"
// with nobody named, so a roofer who signed with Outerhome read as having a
// signed agreement on Cascade Management's roster too -- for a document
// Cascade had never sent and could not produce. Quietly wrong before, and
// unmissable the moment SubSub offers a form with both names printed in it.
//
// So an agreement hangs off the PAIR. `companies.contract` stays for the
// uploads that predate this and is no longer what decides anything.
//
// TWO PARTIES MEANS TWO SIGNATURES. A form signed by one side is not a
// contract, and the side that wrote the terms is the side with the most
// reason to be bound by them. The subcontractor signs where they already are
// -- submitting their documents -- and the hiring account countersigns from
// the roster. Nothing is in force until both have, which is the same
// two-party shape handover, completion and connect already use, and for the
// same reason: one signature on a two-party act is a decision made alone.
//
// AND REQUIRING ONE IS A CHOICE THAT HAS TO BE MADE OUT LOUD. Before this,
// `DOC_KINDS` counted an agreement against every subcontractor on every
// roster, so a sub whose client never sent one sat permanently short of
// complete -- the exact permanently-amber failure `docs.js` was written to
// prevent, which is why `OPTIONAL_KINDS` already excused it on the sub's own
// screens and could not excuse it on the hiring side. It is required when the
// hiring account has actually issued one, and not otherwise. Issuing IS the
// requirement: a separate "required" flag beside an agreement row would be
// two records of one fact, and they would disagree.

import { STANDARD_AGREEMENT, TEMPLATES, templateKey } from "./agreement-standard.js";
import { REQUIRED_KINDS } from "./docs.js";

export { STANDARD_AGREEMENT, TEMPLATES, templateKey };

// SubSub's own form, or the hiring account's own paper. Both are agreements
// and both satisfy the same requirement; they differ in who wrote the words
// and therefore in whether anything can be signed in the app.
export const AGREEMENT_SOURCES = ["subsub_standard", "uploaded"];

// `sent`         issued, waiting on the subcontractor
// `signed`       the subcontractor has signed, waiting on the hiring account
// `countersigned` both, and in force
// `declined`     the subcontractor said no
// `void`         withdrawn by the hiring account
// `superseded`   replaced by a later one
export const AGREEMENT_STATES =
  ["sent", "signed", "countersigned", "declined", "void", "superseded"];

// The ones that still stand between the parties. A partial unique index uses
// exactly this list, so a relationship can only ever have one live agreement
// while keeping every finished one.
export const LIVE_STATES = ["sent", "signed", "countersigned"];
export const isLive = (row) => LIVE_STATES.includes(row?.status);
// In force means both have signed. Nothing else counts, including a form the
// subcontractor signed and nobody countersigned -- that is an offer that was
// never accepted.
export const inForce = (row) => row?.status === "countersigned";

// ---------------------------------------------------------------------------
// Terms
//
// What varies between hiring accounts. Held as a named list rather than a
// free-form object because three things read it -- the editor, the renderer
// and the validator -- and a field one of them did not know about would be a
// term somebody set and no document printed.
//
// Money is whole cents and percentages are basis points, like everywhere else
// here. `money.js` says why: a rate that is a float is a rate that drifts.
export const TERM_FIELDS = [
  { id: "cglPerOccurrenceCents", kind: "money", def: 100000000,
    label: "General liability, each occurrence" },
  { id: "cglAggregateCents", kind: "money", def: 200000000,
    label: "General liability, aggregate" },
  { id: "autoLiabilityCents", kind: "money", def: 100000000,
    label: "Automobile liability", note: "Zero leaves it out of the agreement." },
  { id: "umbrellaCents", kind: "money", def: 0,
    label: "Umbrella or excess", note: "Zero leaves it out of the agreement." },
  { id: "workersComp", kind: "bool", def: true, label: "Workers' compensation" },
  { id: "additionalInsured", kind: "bool", def: true, label: "Name you as additional insured" },
  { id: "primaryNonContributory", kind: "bool", def: true, label: "Primary and non-contributory" },
  { id: "waiverOfSubrogation", kind: "bool", def: true, label: "Waiver of subrogation" },
  { id: "paymentDays", kind: "days", def: 30, min: 0, max: 180,
    label: "Pay approved invoices within" },
  { id: "retainageBps", kind: "bps", def: 0, min: 0, max: 2000,
    label: "Retainage", note: "Zero leaves it out of the agreement." },
  // THREE YEARS, and the number is the account's to change -- which is the
  // whole reason this is a term rather than a sentence in the template. The
  // default moved from 12; a stored agreement carries its own copy, stamped at
  // issue, so nothing already signed moves with it.
  { id: "warrantyMonths", kind: "months", def: 36, min: 0, max: 120,
    label: "Warranty on the work",
    note: "Whole years read as years in the agreement." },
  // How long they have to ANSWER a defect notice, which is a different promise
  // from how long they have to fix it. Business hours rather than hours,
  // because 48 hours from a Friday afternoon is a Sunday and a term that lands
  // on a weekend is one nobody meets. The agreement says what a business hour
  // is; this is only the number.
  { id: "warrantyResponseHours", kind: "hours", def: 48, min: 1, max: 240,
    label: "Respond to a warranty call within",
    note: "Business hours. They still get a reasonable time to do the repair." },
  { id: "noticeDays", kind: "days", def: 7, min: 1, max: 90,
    label: "Notice to end the agreement" },
  { id: "cureDays", kind: "days", def: 3, min: 1, max: 60,
    label: "Time to put a failure right" },
  { id: "recordsYears", kind: "years", def: 4, min: 1, max: 10, label: "Keep records for" },
  // Not edited as a number: it comes from the hiring account's own state, and
  // it is stamped at issue rather than read live -- the same rule
  // `lien_waivers.governing_state` follows, because editing an address later
  // must not change what a signed document meant.
  { id: "governingState", kind: "state", def: null, label: "Governing law" },
];

export const defaultTerms = () =>
  Object.fromEntries(TERM_FIELDS.map((f) => [f.id, f.def]));

// Normalised on the way IN, never only on the way out.
//
// Same rule as `validCoverage`: this lands in a column other code reads
// directly, and a string where a number belongs makes the renderer print
// "$NaN" into a document somebody is about to sign. Anything unrecognised is
// dropped rather than stored, and anything out of range is clamped rather
// than refused -- a term nobody can save is a form nobody finishes, and every
// value here has a defensible nearest legal answer.
export function validTerms(input = {}) {
  const out = defaultTerms();
  for (const f of TERM_FIELDS) {
    if (!(f.id in (input || {}))) continue;
    const v = input[f.id];
    if (f.kind === "bool") { out[f.id] = !!v; continue; }
    if (f.kind === "state") {
      const s = String(v || "").trim().toUpperCase();
      out[f.id] = /^[A-Z]{2}$/.test(s) ? s : null;
      continue;
    }
    let n = Math.round(Number(v));
    if (!Number.isFinite(n)) continue;
    if (n < (f.min ?? 0)) n = f.min ?? 0;
    if (f.max !== undefined && n > f.max) n = f.max;
    out[f.id] = n;
  }
  return out;
}

// An account's standing terms, with a per-subcontractor override on top.
// Most hiring accounts use one set for everybody, so the override is usually
// empty and this usually returns the defaults unchanged.
export const mergeTerms = (base, override) =>
  validTerms({ ...validTerms(base), ...(override || {}) });

// ---------------------------------------------------------------------------
// Rendering
//
// DETERMINISTIC, AND THAT IS A REQUIREMENT RATHER THAN A PREFERENCE. The hash
// stored against a signed agreement is what makes the record proof of WHAT
// was signed rather than merely that something was. So this reads nothing
// live: not the clock, not the company row, not the account's current terms.
// Everything it needs is passed in, and everything passed in is stored
// alongside the hash, so the same inputs reproduce the same document in five
// years -- including after a newer template version has shipped.
export function renderAgreement({ templateId, templateVersion, parties = {}, terms = {}, issuedOn } = {}) {
  const id = templateId || STANDARD_AGREEMENT.id;
  const version = templateVersion || STANDARD_AGREEMENT.version;
  const template = TEMPLATES[templateKey(id, version)];
  // LOUD, NOT A FALLBACK. Rendering a different document under a heading that
  // says it was signed is worse than rendering nothing, and it is the failure
  // nobody would catch by looking -- the wrong contract still reads like a
  // contract. Callers turn this into a named refusal.
  if (!template) {
    const err = new Error(`unknown_template:${templateKey(id, version)}`);
    err.code = "unknown_template";
    throw err;
  }
  // The defined terms the document uses for the two parties, off the KIND
  // stamped into `parties` at issue -- never read live, because an account may
  // change kind and a signed document must not change with it. They live
  // inside the template, so changing a word moves the version with it.
  const kind = parties.kind || null;
  const ctx = {
    hiring: parties.hiring || {},
    sub: parties.sub || {},
    T: (template.partyTerms || {})[kind] || template.neutralTerms
       || { hiring: "Hiring Party", hired: "Contractor", doc: "Contractor Agreement" },
    terms: validTerms(terms),
    issuedOn: String(issuedOn || "").slice(0, 10),
  };
  return {
    templateId: template.id,
    templateVersion: template.version,
    // SubSub's form, said in the title. A document headed with the hiring
    // company's name reads as their own bespoke paper, which is the opposite
    // of what it is; the company is a party filled into it.
    title: template.titleFor ? template.titleFor(kind) : template.title,
    partyTerms: ctx.T,
    reviewed: template.reviewed || null,
    sections: template.sections.map((s) => ({
      id: s.id,
      heading: typeof s.heading === "function" ? s.heading(ctx) : s.heading,
      paragraphs: s.body(ctx),
    })),
  };
}

// The exact bytes that get hashed.
//
// Its own function, and not "whatever the screen happened to draw", because
// the screen will grow a heading or a spacer one day and a hash that follows
// the layout would stop matching every agreement signed before it. Title,
// version, then each section's heading and paragraphs, newline separated.
export function canonicalText(rendered) {
  const lines = [rendered.title, `${rendered.templateId} ${rendered.templateVersion}`];
  for (const s of rendered.sections) {
    lines.push(s.heading);
    for (const p of s.paragraphs) lines.push(p);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// What the roster and the subcontractor's own screen read

// Which document kinds count for this relationship.
//
// The three the subcontractor owns, always; the agreement only once this
// hiring account has issued one. `docs.js` takes the list as an argument
// already, so this is the one place that decides and nothing else grew an
// opinion about it.
export const kindsFor = (agreement) =>
  isLive(agreement) ? [...REQUIRED_KINDS, "contract"] : [...REQUIRED_KINDS];

// The agreement, shaped as the document `docs.js` understands, so a roster
// does not need a second code path for one of the four rows.
//
// An agreement does not expire, so `expiresOn` is null -- which `docs.js` has
// meant "does not expire" since it was written, never "unknown".
export function agreementDocShape(agreement) {
  if (!isLive(agreement)) return null;
  if (!inForce(agreement)) return { fileName: null, expiresOn: null };
  return {
    fileName: agreement.file_name || agreement.fileName
      || (agreement.source === "uploaded" ? "Signed agreement" : "SubSub agreement"),
    expiresOn: null,
    signedAt: agreement.signed_at || agreement.signedAt || null,
  };
}

// Who the next move belongs to. One function, because the sub's screen, the
// roster row and the reminder all have to agree about it -- and "waiting on
// them" drawn on both sides at once is how a two-party handshake stalls
// forever with each side believing the other has it.
export function waitingOn(agreement) {
  if (!agreement) return null;
  if (agreement.status === "sent") {
    return agreement.source === "uploaded" ? "sub_upload" : "sub_sign";
  }
  if (agreement.status === "signed") return "hiring_countersign";
  return null;
}

export function agreementStateText(agreement, { subName = "They", hiringName = "They" } = {}) {
  if (!agreement) return "No agreement has been sent.";
  switch (agreement.status) {
    case "sent":
      return agreement.source === "uploaded"
        ? `Waiting for ${subName} to upload a signed agreement.`
        : `Waiting for ${subName} to sign.`;
    case "signed": return `${subName} signed it. Waiting for ${hiringName} to countersign.`;
    case "countersigned": return "Signed by both parties.";
    case "declined": return `${subName} declined to sign it.`;
    case "void": return "Withdrawn.";
    case "superseded": return "Replaced by a later agreement.";
    default: return "";
  }
}

// Whether somebody may sign, and why not when they may not. A disabled
// control with no reason beside it is indistinguishable from a broken one,
// which this codebase has now paid for twice.
export function canSign(agreement, { asSub = false } = {}) {
  if (!agreement) return { ok: false, reason: "no_agreement" };
  // The SUBCONTRACTOR cannot sign somebody else's paper in the app -- there
  // is no document here to sign. The hiring account still countersigns one,
  // and must, or an uploaded agreement could never reach in force: uploading
  // the signed copy is what moves it to `signed`, and confirming that the
  // paper is theirs is what moves it the rest of the way.
  if (asSub && agreement.source === "uploaded") return { ok: false, reason: "upload_instead" };
  if (asSub) {
    if (agreement.status !== "sent") return { ok: false, reason: "already_answered" };
    return { ok: true };
  }
  if (agreement.status === "sent") return { ok: false, reason: "waiting_on_sub" };
  if (agreement.status !== "signed") return { ok: false, reason: "already_answered" };
  return { ok: true };
}

export function signRefusalText(reason) {
  switch (reason) {
    case "no_agreement": return "There is no agreement to sign.";
    case "upload_instead": return "This one is signed on paper and uploaded, not signed here.";
    case "waiting_on_sub": return "They have not signed it yet.";
    case "already_answered": return "That agreement has already been answered.";
    default: return "That cannot be signed.";
  }
}

// A typed signature is a signature when the person typing it is authenticated
// and the record says who, when and from where -- which is what `lien_waivers`
// already stores and what this mirrors. What makes it weak is a name typed
// into a box with nothing tying it to a person, so the name has to match the
// signer and it has to be their own act.
export const typedNameMatches = (typed, expected) => {
  const norm = (s) => String(s || "").trim().replace(/\s+/g, " ").toLowerCase();
  return !!norm(typed) && norm(typed) === norm(expected);
};
