// The lien waiver as a document: which form a state takes, the four kinds, and
// SubSub's own form for the states that mandate none.
//
// `waivers.js` is the chain -- whether it is clear, and through when. This is
// the paper each link is made of. They are separate files because they change
// for different reasons: the chain rules are ours, and the forms follow
// statute.
//
// TWELVE STATES PRESCRIBE THE WORDS, AND A FORM THAT DEVIATES CAN BE VOID.
// Arizona, California, Florida, Georgia, Massachusetts, Michigan, Mississippi,
// Missouri, Nevada, Texas, Utah and Wyoming set the text and format of a lien
// waiver in statute. A waiver that is not on the statutory form may not waive
// anything at all -- and it still LOOKS like a waiver, which is the failure
// nobody catches by reading it. Lien law follows the PROPERTY, never the
// signer, so the state is the building's and is stamped at request.
//
// SO IN THOSE TWELVE, SUBSUB GENERATES NOTHING UNTIL THE VERBATIM TEXT IS
// LOADED FROM ITS SOURCE. Writing a statutory form from memory is the
// confident-and-wrong answer this project refuses everywhere: a paraphrase of
// a statute reads exactly like the statute, and the person relying on it is
// the one person who cannot tell. Until a state's text is in `STATUTORY_FORMS`
// below, carrying the statute it came from, a waiver there is UPLOADED: the
// subcontractor signs the state's own form and uploads it, which is what they
// do today anyway. The whole of the request, the chain, the gate and the
// record still works -- only who authors the page differs.
//
// THE OTHER THIRTY-EIGHT, AND DC, HAVE NO MANDATED FORM, which is why SubSub
// can offer one. It is deliberately plain and deliberately narrow, the same
// trade the standard subcontractor agreement makes: a waiver that releases
// more than the payment it is given for is the one a court reads against the
// party who wrote it. `reviewed` is null, and it stays null until a lawyer has
// actually read it -- see `agreement-standard.js` for why that flag is not
// something anybody gets for free.
//
// AND EVERY TEMPLATE IS KEYED BY ID AND VERSION, AND A MISS THROWS. The hash of
// a signed waiver is of the text the signer was shown; re-rendering it under a
// newer version would produce a different document under a heading saying it
// was signed, and the wrong waiver still reads like a waiver. Superseded
// versions are never deleted.

import { stateName, normalizeState } from "./states.js";
import { WAIVER_KINDS } from "./waivers.js";

export const STATUTORY_STATES = ["AZ", "CA", "FL", "GA", "MA", "MI", "MS", "MO", "NV", "TX", "UT", "WY"];
export const isStatutory = (state) => STATUTORY_STATES.includes(normalizeState(state) || "");

// What a waiver's paper is. Ours, rendered and signed in the app; or theirs,
// signed outside it and uploaded -- which is the only honest answer in a
// statutory state until its text is loaded, and an ordinary choice anywhere
// else for a hiring account with a form of its own.
export const WAIVER_SOURCES = ["subsub_standard", "uploaded"];

// The four, in the words the trade uses. `title` is the document's heading;
// `short` is the name on a row; `when` is the one sentence that tells
// somebody choosing which of the four they want.
export const KIND_WORDS = {
  conditional_progress: {
    title: "Conditional Waiver and Release on Progress Payment",
    short: "Partial, conditional",
    when: "A progress payment you are about to make. It only takes effect once the money clears.",
  },
  unconditional_progress: {
    title: "Unconditional Waiver and Release on Progress Payment",
    short: "Partial, unconditional",
    when: "A progress payment that has already cleared.",
  },
  conditional_final: {
    title: "Conditional Waiver and Release on Final Payment",
    short: "Final, conditional",
    when: "The last payment on this work order, before it is made. It only takes effect once the money clears.",
  },
  unconditional_final: {
    title: "Unconditional Waiver and Release on Final Payment",
    short: "Final, unconditional",
    when: "The last payment, retainage included, after it has cleared.",
  },
};
export const kindShort = (kind) => KIND_WORDS[kind]?.short || "Lien waiver";
export const isConditional = (kind) => String(kind || "").startsWith("conditional_");
export const isFinalKind = (kind) => String(kind || "").endsWith("_final");

// THE ONE RULE THAT PROTECTS THE SIGNER, enforced on the request rather than
// left to their judgement. An unconditional waiver gives the rights up whether
// or not the money ever arrives, so asking for one before the payment is
// recorded is asking somebody to sign away a lien for a cheque that may
// bounce. The hiring side may pick any of the four; it may not pick that
// combination.
export function kindRefusal({ kind, paid }) {
  if (!WAIVER_KINDS.includes(kind)) return "bad_kind";
  if (!isConditional(kind) && !paid) return "unconditional_before_paid";
  return null;
}

// Verbatim statutory forms, by state. EMPTY ON PURPOSE -- see the top of this
// file. An entry is `{ templateId, templateVersion, statute, sourceUrl,
// checkedOn }` and its template goes in `TEMPLATES` below; nothing is added
// here from memory.
export const STATUTORY_FORMS = {};

// Which papers a waiver can be on, for this property's state.
//
// No state is its own answer: a building with no state recorded cannot be
// told apart from a statutory one, and guessing "probably not" is how an
// invalid waiver gets signed. So it is upload-only, and says why, until the
// state is filled in.
export function formsFor(state) {
  const st = normalizeState(state) || null;
  if (!st) return { state: null, statutory: false, sources: ["uploaded"], reason: "no_state" };
  if (isStatutory(st)) {
    return STATUTORY_FORMS[st]
      ? { state: st, statutory: true, sources: ["subsub_standard", "uploaded"], form: STATUTORY_FORMS[st] }
      : { state: st, statutory: true, sources: ["uploaded"], reason: "statutory_text_not_loaded" };
  }
  return { state: st, statutory: false, sources: ["subsub_standard", "uploaded"] };
}

export function formsReasonText(reason, state) {
  const name = stateName(state) || "This state";
  return {
    no_state: "The building has no state recorded, and lien waiver forms differ by state — so this one is signed on paper and uploaded. Add the state to the building to use SubSub's form where the law allows it.",
    statutory_text_not_loaded: `${name} sets the exact wording of a lien waiver in statute, and a waiver on any other form may not count. So it is signed on ${name}'s own form and uploaded.`,
  }[reason] || "";
}

// The template a generated waiver uses for this state, or null.
export function generatedTemplateFor(state) {
  const f = formsFor(state);
  if (!f.sources.includes("subsub_standard")) return null;
  if (f.statutory) return { templateId: f.form.templateId, templateVersion: f.form.templateVersion };
  return { templateId: STANDARD_WAIVER.id, templateVersion: STANDARD_WAIVER.version };
}

// ---------------------------------------------------------------------------
// SubSub's standard form, for the states that prescribe none.

const money = (cents) => {
  const n = Math.round(Number(cents) || 0) / 100;
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const MONTHS = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];
// From the stored day string, never through Date: a date parsed in the
// reader's zone is a day early west of Greenwich, which this project has
// already paid for in full once.
const longDay = (d) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d || "").slice(0, 10));
  if (!m) return "[date]";
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
};
const or = (v, gap) => (String(v || "").trim() || gap);

// The declaration about who else worked on the job, which is what makes a
// chain safe to stop at this link. Chosen by the signer at the moment they
// sign, and part of what is hashed, because "I furnished labor only" is a
// thing somebody swears to rather than a setting.
const declaration = (x) => {
  if (x.scopeKind === "labor_only") {
    return "The Claimant declares that it furnished labor only on this job, furnished no materials or equipment, and engaged nobody else who furnished labor, services, equipment or materials on it.";
  }
  if (x.scopeKind === "labor_materials" || x.scopeKind === "materials_only") {
    return x.final
      ? "The Claimant declares that it has paid, or will pay from this payment, everybody it engaged who furnished labor, services, equipment or materials on this job, and that it has declared every such party to the Customer."
      : `The Claimant declares that it has paid, or will pay from this payment, everybody it engaged who furnished labor, services, equipment or materials on this job through ${x.through}, and that it has declared every such party to the Customer.`;
  }
  return "[The Claimant chooses its declaration when signing.]";
};

export const STANDARD_WAIVER = {
  id: "subsub_standard_waiver",
  version: "1.0.0",
  // Not reviewed by a lawyer. Pinned null by waiverform-test, so nothing
  // downstream can begin claiming it was.
  reviewed: null,
  sections: [
    {
      id: "parties",
      heading: "1. Parties and property",
      body: (x) => [
        `Claimant (the party giving this waiver): ${x.claimant}.`,
        `Customer (the party paying the Claimant): ${x.customer}.`,
        `Job: ${x.job}.`,
        `Property: ${x.property}.`,
        `Governing law: the law of ${x.stateName}, where the property is.`,
      ],
    },
    {
      id: "payment",
      heading: "2. The payment",
      // A lower-tier waiver often has no figure: a supply house is asked for
      // one by the subcontractor who owes it, and SubSub holds no invoice
      // between them. So the sentence says "everything owed" rather than
      // printing $0.00, which would be a waiver for nothing.
      body: (x) => {
        const sum = x.amount || "everything the Claimant is owed";
        return [x.conditional
          ? (x.final
            ? `This waiver concerns the final payment of ${sum} to the Claimant for all labor, services, equipment and materials it furnished on this job, including any retention.`
            : `This waiver concerns a progress payment of ${sum} to the Claimant for labor, services, equipment and materials it furnished on this job through ${x.through}.`)
          : (x.final
            ? `The Claimant has received the final payment of ${sum} for all labor, services, equipment and materials it furnished on this job, including any retention.`
            : `The Claimant has received a progress payment of ${sum} for labor, services, equipment and materials it furnished on this job through ${x.through}.`)];
      },
    },
    {
      id: "release",
      heading: "3. Waiver and release",
      body: (x) => {
        const what = x.final
          ? "all mechanic's lien and payment bond rights the Claimant has on the property and job above, for all labor, services, equipment and materials it furnished"
          : `any mechanic's lien and payment bond rights the Claimant has on the property and job above, for labor, services, equipment and materials it furnished through ${x.through}, to the extent of the payment`;
        const out = [x.conditional
          ? `Upon receipt of the payment in section 2, and only then, the Claimant waives and releases ${what}.`
          : `The Claimant waives and releases ${what}.`];
        out.push(x.final
          ? `This does not release any claim the Claimant has disputed in writing: ${or(x.disputed, "none")}.`
          : `This does not release retention held back, labor or materials furnished after ${x.through}, extra work or change orders not yet paid, or any claim the Claimant has disputed in writing: ${or(x.disputed, "none")}.`);
        return out;
      },
    },
    {
      id: "condition",
      heading: "4. When this takes effect",
      body: (x) => [x.conditional
        ? "This waiver is conditional. It has no effect until the Claimant has actually received the payment. Where the payment is made by check, it is received only when the check has been paid by the bank it is drawn on."
        : "This waiver is unconditional. It takes effect when signed, whether or not the payment clears. The Claimant should sign it only once the payment has actually been received."],
    },
    {
      id: "declaration",
      heading: "5. Who else worked on this job",
      body: (x) => [declaration(x)],
    },
    {
      id: "signature",
      heading: "6. Signature",
      body: () => [
        "Signed for the Claimant by a representative who declares that they are authorized to sign for it. The signer's typed name, the date and time of signing, and a fingerprint of this exact text are recorded with it.",
      ],
    },
  ],
};

export const templateKey = (id, version) => `${id}@${version}`;
export const TEMPLATES = {
  [templateKey(STANDARD_WAIVER.id, STANDARD_WAIVER.version)]: STANDARD_WAIVER,
};

// Deterministic, and reads nothing live. Everything it needs is stamped on
// the waiver at request -- the parties as they read then, the amount, the
// through date and the state -- plus the declaration the signer chooses, so
// the same inputs reproduce the same document years later.
export function renderWaiver({ templateId, templateVersion, kind, parties = {},
  amountCents = 0, throughDate, state, scopeKind = null, disputed = "" } = {}) {
  const id = templateId || STANDARD_WAIVER.id;
  const version = templateVersion || STANDARD_WAIVER.version;
  const template = TEMPLATES[templateKey(id, version)];
  // LOUD, NOT A FALLBACK. The wrong waiver still reads like a waiver.
  if (!template) {
    const err = new Error(`unknown_template:${templateKey(id, version)}`);
    err.code = "unknown_template";
    throw err;
  }
  if (!WAIVER_KINDS.includes(kind)) {
    const err = new Error(`bad_kind:${kind}`);
    err.code = "bad_kind";
    throw err;
  }
  const x = {
    claimant: or(parties.claimant, "[claimant]"),
    customer: or(parties.customer, "[customer]"),
    job: or(parties.job, "[job]"),
    property: or(parties.property, "[property]"),
    stateName: stateName(state) || "[state]",
    amount: Number(amountCents) > 0 ? money(amountCents) : null,
    through: longDay(throughDate),
    conditional: isConditional(kind),
    final: isFinalKind(kind),
    scopeKind,
    disputed,
  };
  return {
    templateId: template.id,
    templateVersion: template.version,
    title: KIND_WORDS[kind].title,
    reviewed: template.reviewed || null,
    sections: template.sections.map((s) => ({ id: s.id, heading: s.heading, paragraphs: s.body(x) })),
  };
}

// The exact bytes that get hashed. Its own function rather than whatever the
// screen draws, because the screen will grow a heading one day and a hash that
// followed the layout would stop matching every waiver signed before it.
export function canonicalText(rendered) {
  const lines = [rendered.title, `${rendered.templateId} ${rendered.templateVersion}`];
  for (const s of rendered.sections) {
    lines.push(s.heading);
    for (const p of s.paragraphs) lines.push(p);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Uploads. A signed waiver is a PDF or a photograph of one, and nothing else.
export const WAIVER_FILE_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/heic", "image/webp"];
export const MAX_WAIVER_BYTES = 15 * 1024 * 1024;

// What a row says, in words, from either side. The same row is read by the
// party paying and the party signing, and each needs the sentence the other
// side's screen would not say.
export function waiverStateText(w, { asSigner = false } = {}) {
  if (!w) return "";
  if (w.status === "signed") return asSigner ? "You signed this." : "Signed.";
  if (w.status === "declined") return asSigner ? "You declined this." : "They declined to sign.";
  if (w.status === "void") return "Withdrawn.";
  if (w.source === "uploaded") {
    return asSigner ? "Sign it on paper and upload the signed copy." : "Waiting on them to upload a signed copy.";
  }
  return asSigner ? "Waiting on you to sign." : "Waiting on them to sign.";
}
