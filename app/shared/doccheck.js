// What a reviewer is asked about a compliance document, and what they answered.
//
// THERE WAS ONE LIST TOO MANY. `INSURANCE_LINES`, `INSURANCE_ATTEST` and
// `BOND_MIN` lived in App.tsx and again in worker/mail.js, agreeing by luck and
// by whoever last edited both -- the same shape as `TRADE_IDS` against
// `CATEGORIES`, and the merge was forced the same way: by a third consumer. The
// moment the email has to name the SPECIFIC thing a reviewer found wrong, two
// lists means an email naming a line the screen never asked about.
//
// AND A TICK BOX CANNOT SAY WHAT IS WRONG. Review was pass or fail with a
// free-text note. The checklist looked like it carried the detail, but an
// unticked box means two different things -- "I have not got to this yet" and
// "I checked, and it is not there" -- and nothing anywhere could tell them
// apart. So a reviewer who found the hiring account missing from the additional
// insured schedule had one move: reject the whole certificate and type a
// paragraph. The subcontractor then got the generic "upload your compliance
// documents" mail about a document they had already uploaded.
//
// Three states per item, which is the same fix docs.js made in colour: expired
// and never-added are both red and are told apart by the words, because they
// are different problems needing different actions.
//
//   unanswered  nobody has looked at this line yet
//   ok          checked, and it is right
//   wrong       checked, and it is not -- with a note saying what to do
//
// The note is per item on purpose. "Add Outerhome LLC as additional insured on
// the CGL" is an instruction somebody can act on in one go; the same sentence
// inside a paragraph about four other things is a paragraph somebody re-reads
// three times.

export const FINDING_STATES = ["unanswered", "ok", "wrong"];

// ---- The schedule a hiring account holds subcontractors to -----------------
// Basis: whole dollars, not cents -- these are the figures printed on an ACORD
// 25 and a reviewer compares them by eye.
//
// `optional` MEANS THE LINE MAY BE BLANK, NOT THAT ANY NUMBER WILL DO. A figure
// typed below the minimum is still short and still needs a reason recorded --
// what optional buys is that a certificate which legitimately carries no such
// coverage part can still be verified, instead of sitting unverifiable forever.
// That is the permanently-amber failure `docs.js` exists to prevent, arrived at
// from the coverage grid: a reviewer facing a line their subcontractor can
// never have either invents a number or gives up on the screen.
//
// Three of the six are optional, each for its own real reason:
//
//   AUTO LIABILITY -- a sub who brings tools in their own car and hires
//   nothing has no commercial auto policy to name.
//
//   EMPLOYER'S LIABILITY -- Washington's workers' comp is a state monopoly
//   fund, so there is no private employer's liability coverage part on a
//   standard certificate here, and a sole proprietor with no employees has
//   nothing to show on it in any state.
//
//   UMBRELLA / EXCESS -- only larger crews and higher-risk trades carry one.
//
// The three CGL lines are not optional, because they are the cover the work
// itself runs on and every subcontractor doing it has them.
export const INSURANCE_LINES = [
  { id: "cgl_occ",   label: "Commercial General Liability", sub: "per occurrence",             min: 1000000 },
  { id: "cgl_agg",   label: "General aggregate",            sub: "",                           min: 2000000 },
  { id: "prod_comp", label: "Products & completed operations", sub: "",                        min: 2000000 },
  { id: "auto",      label: "Auto liability",               sub: "combined single limit",      min: 1000000, optional: true },
  { id: "empl",      label: "Employer's liability",         sub: "",                           min: 1000000, optional: true },
  { id: "umbrella",  label: "Umbrella / excess",            sub: "higher-risk or larger subs", min: 1000000, optional: true },
];
// Read rather than restated: the footnote under the requirements table and the
// line in the document-request email both name these, and a hand-kept sentence
// beside the list is the two-records-of-one-fact shape this repo keeps paying
// for.
export const OPTIONAL_LINES = INSURANCE_LINES.filter((l) => l.optional);
export const REQUIRED_LINES = INSURANCE_LINES.filter((l) => !l.optional);
export const BOND_MIN = 30000;
export const INSURANCE_MIN = 1000000;    // the headline CGL figure copy quotes

const money = (n) => "$" + Number(n).toLocaleString("en-US");

// What has to be confirmed on the face of each document.
//
// `label` takes the hiring account's name, because several of these are about
// that account specifically -- being named as additional insured is the single
// commonest thing wrong with a certificate, and a line reading "the hiring
// account" instead of "Outerhome" is a line somebody has to translate.
//
// `fix` is what the SUBCONTRACTOR is told to do when it is marked wrong. It is
// here rather than typed each time because the common case is the same
// instruction every time, and a reviewer who has to compose it will instead
// leave it blank. They can still overwrite it.
const ITEMS = {
  insurance: (who) => [
    { id: "named", label: `${who} named as additional insured on CGL`,
      fix: `Ask your agent to add ${who} as an additional insured on the general liability policy and send a new certificate.` },
    { id: "primary", label: "Primary & non-contributory wording present",
      fix: "The certificate needs to say the coverage is primary and non-contributory. Your agent adds this wording." },
    { id: "wc", label: "WA L&I workers' comp account active (or exempt)",
      fix: "We need your workers' compensation account shown as active, or written confirmation that you are exempt." },
    { id: "current", label: "Policy period covers the work dates",
      fix: "The policy period on this certificate does not cover the dates of the work. Send one that does." },
    { id: "carrier", label: "Carrier and policy number legible",
      fix: "The carrier name or policy number cannot be read on this copy. Send a clearer one." },
  ],
  bond: () => [
    { id: "active", label: "Bond is active, not cancelled",
      fix: "This bond reads as cancelled or lapsed. Send the current one." },
    { id: "amount", label: `Bond amount at least ${money(BOND_MIN)}`,
      fix: `The bond needs to be at least ${money(BOND_MIN)}.` },
    { id: "principal", label: "Principal matches the company name on file",
      fix: "The principal named on the bond is not the same as your company name on file. One of the two needs correcting." },
    { id: "surety", label: "Surety is licensed in Washington",
      fix: "The surety on this bond is not licensed in Washington. You will need a bond from one that is." },
  ],
  w9: () => [
    { id: "tin", label: "TIN or EIN filled in and legible",
      fix: "The TIN or EIN box is blank or cannot be read. Fill it in and send the form again." },
    { id: "name", label: "Name and business name match the company on file",
      fix: "The name on the W-9 is not the same as your company name on file. One of the two needs correcting." },
    { id: "entity", label: "Tax classification selected (LLC, S-corp, sole prop…)",
      fix: "No tax classification is ticked in Part I. Tick the one that applies." },
    { id: "signed", label: "Signed and dated in Part II",
      fix: "Part II is not signed and dated. Sign it and send the form again." },
    { id: "current", label: "Current form revision (Rev. March 2024 or later)",
      fix: "This is an older revision of the W-9. Download the current one from irs.gov and fill that in." },
  ],
  contract: (who) => [
    { id: "signed", label: "Signed and dated by the contractor",
      fix: "The agreement is not signed and dated. Sign it and send it back." },
    { id: "counter", label: `Countersigned by ${who}`,
      fix: "We have not countersigned this yet — nothing for you to do." },
    { id: "version", label: "Current version of the agreement",
      fix: "This is an older version of the agreement. We will send the current one." },
  ],
};

// The items for one kind. Never an empty list for a real kind: a document with
// nothing to confirm is a document nobody is reviewing.
export function checkItems(kind, accountName = "the hiring account") {
  const f = ITEMS[kind];
  return f ? f(accountName) : [];
}
export const CHECK_KINDS = Object.keys(ITEMS);

// ---- What was answered ----------------------------------------------------

// Normalise whatever is stored into one shape per item.
//
// READS THE LEGACY `checks` OBJECT when there are no findings, because every
// review written before this existed has one -- and a stored `true` genuinely
// does mean somebody confirmed that line. A stored `false` does NOT mean they
// found it wrong; it means the box was not ticked, which is exactly the
// ambiguity this replaces. So it maps to `unanswered`, never to `wrong`: the
// alternative would retroactively invent findings nobody recorded, on documents
// that are already verified.
export function findingsFor(review, kind, accountName) {
  const items = checkItems(kind, accountName);
  const stored = review?.findings || null;
  const legacy = review?.checks || null;
  const out = {};
  for (const it of items) {
    const f = stored?.[it.id];
    if (f && FINDING_STATES.includes(f.state)) {
      out[it.id] = { state: f.state, note: f.note || "" };
    } else if (!stored && legacy && legacy[it.id] === true) {
      out[it.id] = { state: "ok", note: "" };
    } else {
      out[it.id] = { state: "unanswered", note: "" };
    }
  }
  return out;
}

// `checks` as anything still reading it expects. Derived, never stored beside
// `findings` -- two records of one answer is two answers.
export const checksFrom = (findings) =>
  Object.fromEntries(Object.entries(findings || {}).map(([k, v]) => [k, v.state === "ok"]));

// Everything marked wrong, in the order the items are asked, each carrying the
// instruction that goes to the subcontractor.
export function problemsIn(review, kind, accountName) {
  const items = checkItems(kind, accountName);
  const f = findingsFor(review, kind, accountName);
  return items
    .filter((it) => f[it.id]?.state === "wrong")
    .map((it) => ({ id: it.id, label: it.label, fix: f[it.id].note || it.fix || "" }));
}

// Every line answered `ok`. This is what verifying requires, and it is the same
// condition the tick boxes carried before -- restated here so the screen, the
// route and the email cannot hold three opinions about "complete".
export function allConfirmed(review, kind, accountName) {
  const items = checkItems(kind, accountName);
  if (!items.length) return false;
  const f = findingsFor(review, kind, accountName);
  return items.every((it) => f[it.id]?.state === "ok");
}

// How far through a review somebody is, for the chip on the roster.
export function reviewProgress(review, kind, accountName) {
  const items = checkItems(kind, accountName);
  const f = findingsFor(review, kind, accountName);
  const vals = items.map((it) => f[it.id]?.state);
  return {
    total: items.length,
    ok: vals.filter((v) => v === "ok").length,
    wrong: vals.filter((v) => v === "wrong").length,
    unanswered: vals.filter((v) => v === "unanswered").length,
  };
}

// WHY THERE IS NO "NEEDS CHANGES" STATUS, stated because the obvious move is to
// add one and it would cost more than it buys.
//
// The difference between "rejected" and "three things to fix" is TONE, and the
// findings carry the substance. A fourth value in `status` would have to be
// checked by `docStatus`, `missingDocs`, `docsComplete`, the assignment gate,
// the nav badge and the send gate -- and a document needing changes is not
// usable either way, so every one of those would answer exactly as it does for
// `rejected`. Eight places to get right for a word.
//
// So the verdict stays a verdict and the WORDS follow the findings. Where there
// are findings the subcontractor is told what to fix; where there are none the
// document was simply turned down.
export function outcomeWords(review, kind, accountName) {
  const p = problemsIn(review, kind, accountName);
  if (!p.length) return { count: 0, headline: "Turned down", chip: "Rejected" };
  return {
    count: p.length,
    headline: `${p.length} thing${p.length === 1 ? "" : "s"} to fix`,
    chip: `${p.length} to fix`,
  };
}
