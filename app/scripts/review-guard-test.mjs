// Three things about reviewing a compliance document.
//
//   CLOSING ASKS. Reading an ACORD 25 is the work this product asks for, and
//   every way out of the modal threw it away without a word -- the X, the
//   backdrop, and a link reading "Close without deciding". Save and finish
//   later was sitting there and had to be chosen in advance, which is not how
//   anybody closes a window.
//
//   THREE COVERAGE LINES ARE OPTIONAL, because a subcontractor can
//   legitimately have no commercial auto policy, no employer's liability part
//   (Washington's workers' comp is a state monopoly fund) and no umbrella. A
//   line nobody can ever fill in is a document nobody can ever verify, which
//   is the permanently-amber failure docs.js exists to prevent, reached
//   through the coverage grid.
//
//   OPTIONAL MEANS BLANK IS ALLOWED, NOT THAT ANY NUMBER WILL DO. A figure
//   below the minimum is still short and still needs a reason recorded.
//
//   AND SENDING IT BACK IS A CTA. The send-back pane -- each fault named, an
//   instruction per fault, and a mail saying everything else is fine -- was
//   reachable only by pressing a red button reading "Reject", which is the
//   word most likely to stop somebody doing the thing the pane was built for.
//
//   node --no-warnings scripts/review-guard-test.mjs

import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const D = await import("../shared/doccheck.js");
const APP = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const MAIL = readFileSync(new URL("../worker/mail.js", import.meta.url), "utf8");

// The screen's own rules, lifted verbatim from DocReview so this suite cannot
// drift into testing a different predicate from the one that ships.
const moneyRaw = (v) => String(v ?? "").replace(/[^0-9.]/g, "");
const lineShort = (l, limits) => !!limits[l.id] && Number(moneyRaw(limits[l.id]) || 0) < l.min;
const lineOk = (l, limits, overrides = {}) => {
  if (!limits[l.id]) return l.optional;
  if (!lineShort(l, limits)) return true;
  return !!(overrides[l.id] && overrides[l.id].trim());
};
const canVerifyLines = (limits, overrides = {}) =>
  D.INSURANCE_LINES.every((l) => lineOk(l, limits, overrides))
    && D.INSURANCE_LINES.filter((l) => !l.optional).every((l) => limits[l.id]);

// ---------------------------------------------------------------------------
console.log("-- which lines a certificate has to carry --");
{
  const opt = D.OPTIONAL_LINES.map((l) => l.id).sort();
  ck("auto, employer's liability and umbrella are optional",
    JSON.stringify(opt) === JSON.stringify(["auto", "empl", "umbrella"]), opt.join(","));
  // The three CGL lines are the cover the work itself runs on, and every
  // subcontractor doing the work has them. Making one of those optional would
  // let a certificate carrying no liability cover at all be verified.
  ck("and the three general-liability lines are not",
    JSON.stringify(D.REQUIRED_LINES.map((l) => l.id).sort())
      === JSON.stringify(["cgl_agg", "cgl_occ", "prod_comp"]),
    D.REQUIRED_LINES.map((l) => l.id).join(","));
  ck("the two lists are the whole list and do not overlap",
    D.OPTIONAL_LINES.length + D.REQUIRED_LINES.length === D.INSURANCE_LINES.length
      && !D.OPTIONAL_LINES.some((o) => D.REQUIRED_LINES.some((r) => r.id === o.id)));
}

console.log("\n-- a certificate carrying only general liability CAN be verified --");
{
  const cgl = { cgl_occ: "1000000", cgl_agg: "2000000", prod_comp: "2000000" };
  ck("the three required lines alone satisfy the grid", canVerifyLines(cgl));
  // The control. Without it the assertion above could pass because the
  // predicate never refuses anything.
  ck("and leaving a REQUIRED line blank still does not",
    !canVerifyLines({ cgl_occ: "1000000", cgl_agg: "2000000" }));
  ck("nor does leaving all three blank",
    !canVerifyLines({ auto: "1000000", empl: "1000000", umbrella: "1000000" }));
}

console.log("\n-- optional means it may be BLANK, never that any figure will do --");
{
  const base = { cgl_occ: "1000000", cgl_agg: "2000000", prod_comp: "2000000" };
  ck("an optional line typed SHORT is still short",
    !canVerifyLines({ ...base, auto: "250000" }));
  ck("and it is accepted once a reason is recorded against it",
    canVerifyLines({ ...base, auto: "250000" }, { auto: "Owner-operator, no commercial fleet" }));
  ck("a blank reason is not a reason",
    !canVerifyLines({ ...base, auto: "250000" }, { auto: "   " }));
  ck("an optional line typed AT the minimum needs no reason",
    canVerifyLines({ ...base, empl: "1000000" }));
}

console.log("\n-- the screens that print the list read it rather than restating it --");
{
  // A hand-written footnote named ONE line while three carry an asterisk, so
  // it explained a third of the marks above it.
  ck("the requirements footnote is generated from OPTIONAL_LINES",
    /OPTIONAL_LINES\.map\(\(l\) => l\.label\)\.join\(", "\)/.test(APP));
  ck("and no longer names one line by hand",
    !/\* Umbrella \/ excess applies to higher-risk/.test(APP));
  // The email already drove off the flag, so making two more lines optional
  // carries into it with nothing to change -- which is the point of the flag.
  ck("the document-request email marks every optional line from the same flag",
    /l\.optional \? " \(if applicable\)" : ""/.test(MAIL));
}

console.log("\n-- closing a half-finished review asks --");
{
  ck("dirtiness is derived by comparing what the form holds against what it opened with",
    /const opened = useRef\(null\);[\s\S]{0,300}const dirty = snapshot !== opened\.current;/.test(APP));
  // A `touched` flag set by two dozen onChange handlers is a second record of
  // the same fact and one field always gets missed.
  ck("and not by a flag the fields have to remember to set",
    !/setTouched\(true\)/.test(APP));

  ck("the guard is handed to Modal, whose X and backdrop know nothing about this form",
    /if \(reviewGuard\.current\?\.\(\)\) return; setReviewing\(null\);/.test(APP)
      && /guard=\{reviewGuard\}/.test(APP));
  // Returning false is what lets an untouched review close straight away:
  // asking somebody to confirm leaving a screen they changed nothing on is
  // the question that teaches people to dismiss dialogs unread.
  ck("an untouched review closes without a question",
    /if \(!dirty \|\| leaving\) return false;/.test(APP));

  ck("the panel offers save, discard and cancel -- all three",
    /Save and close/.test(APP) && /Close and lose them/.test(APP) && /Keep reviewing/.test(APP));
  ck("saving from it saves the same shape the form collects, and closes",
    /onClick=\{\(\) => park\(collect\(\), true\)\}[\s\S]{0,200}Save and close/.test(APP));
  ck("and the in-form close link goes through it too, not straight out",
    /onClick=\{\(\) => \(dirty \? setLeaving\(true\) : onClose\(\)\)\}/.test(APP));
  // A failure has to stay on the panel with the reason on it; closing on a
  // failed save reads as success and loses exactly what it promised to keep.
  ck("a failed save leaves the panel up with the reason on it",
    /\{saveErr && <div className="form-err">\{saveErr\}<\/div>\}[\s\S]{0,300}Save and close/.test(APP));
}

console.log("\n-- sending it back to be fixed is a CTA, not hidden behind 'Reject' --");
{
  ck("with faults marked, the button says send back and counts them",
    /wrongItems\.length[\s\S]{0,200}Send back \{wrongItems\.length\} to fix/.test(APP));
  ck("with none marked it is still a plain refusal, and still says Reject",
    /: <><XCircle size=\{15\} \/> Reject<\/>/.test(APP));
  // One pane, one handler: the state of the form decides which of the two the
  // button is, because that is what is actually true of it. Two buttons would
  // be two ways into one screen to keep in step.
  ck("both are the same button opening the same pane",
    /onClick=\{\(\) => setRejecting\(true\)\}/.test(APP)
      && (APP.match(/setRejecting\(true\)/g) || []).length === 1);
  ck("and it is not drawn as heavily as Verify, which is the other decision",
    /className=\{wrongItems\.length \? "btn-fix" : "btn-warn"\}/.test(APP)
      && /\.btn-fix\{background:var\(--card\)/.test(APP));

  ck("the pane leads with what is true -- most of the document is fine",
    /Almost there — \{outcomeWords/.test(APP));
  ck("and says they are told everything else is fine, so they do not start again",
    /everything\s*\n?\s*else on it is fine so they do not start again/.test(APP));
  // Which is a claim about the EMAIL, so the email has to say it.
  ck("which the email actually says",
    /Everything else on it is fine \\u2014 you do not need to start again/.test(MAIL));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
