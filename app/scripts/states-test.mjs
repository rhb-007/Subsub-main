// Fifty states, and nothing hardcoded to one of them.
//
// SubSub was written in Washington and it showed. The subcontractor
// application opened with the state already SET to WA -- a pre-filled wrong
// answer for forty-nine of them, on a form nobody re-reads once it looks
// answered. Two more forms carried "WA" as a placeholder. Every state field
// was a free-text two-character box that took "XX" as readily as "OR", and a
// typo there is silent: the licence lookup keys on the state and simply
// finds nothing.
//
// And the general-contractor signup REQUIRED a state licence number. That
// cost signups for nothing, and it is worse than it sounds: several states
// have no state contractor licence at all -- some regulate by county, some
// not at all -- so it was a question a real general contractor could not
// answer. It is asked for again inside the account, where it buys them
// something.
//
//   node scripts/states-test.mjs

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { US_STATES, isState, normalizeState, stateName } from "../shared/states.js";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

console.log("\n-- the list --");
ck("fifty states and DC", US_STATES.length === 51, String(US_STATES.length));
ck("every code is two letters", US_STATES.every(([c]) => /^[A-Z]{2}$/.test(c)));
ck("every one has a name", US_STATES.every(([, n]) => n && n.length > 3));
ck("no duplicates", new Set(US_STATES.map(([c]) => c)).size === 51);
for (const c of ["AK", "HI", "DC", "WY", "ME", "TX", "CA"]) {
  ck(`${c} is there`, US_STATES.some(([x]) => x === c));
}
// Absent on purpose; if somebody adds them, the reason should be a decision.
for (const c of ["PR", "GU", "VI", "AS", "MP"]) {
  ck(`${c} is deliberately absent`, !US_STATES.some(([x]) => x === c));
}

console.log("\n-- what counts as a state --");
ck("lowercase is a state", isState("wa"));
ck("padded is a state", isState("  or  "));
ck("XX is not", !isState("XX"));
ck("empty is not", !isState("") && !isState(null) && !isState(undefined));
ck("a whole name is not a code", !isState("Washington"));
ck("normalising tidies", normalizeState(" tx ") === "TX");
ck("and throws away a typo", normalizeState("TZ") === null, String(normalizeState("TZ")));
ck("rather than storing two characters that look like data",
  normalizeState("ZZ") === null && normalizeState("1") === null);
ck("a name can be read back", stateName("DC") === "District of Columbia", String(stateName("DC")));

console.log("\n-- nothing defaults to Washington --");
{
  const ui = readFileSync(join(app, "src", "App.tsx"), "utf8");
  ck("the application does not open pre-set to WA",
    !/state: "WA"/.test(ui.slice(ui.indexOf("function SubSignup"), ui.indexOf("function SubSignup") + 3000)),
    "SubSignup still initialises state to WA");
  // Seed/demo rows may say Seattle; a FORM may not say WA at all.
  const forms = ui.match(/placeholder="WA"/g) || [];
  ck("no form carries WA as a placeholder", forms.length === 0, `${forms.length} left`);
  ck("state is chosen, not typed", ui.includes("function StateSelect"));
  // Both spellings: the mailing address calls it mailState, which is how two
  // of these survived the first pass.
  const freeText = ui.match(/set\("(state|mailState)", e\.target\.value/g) || [];
  ck("no free-text state input remains", freeText.length === 0, `${freeText.length} left`);
  ck("including the mailing address", !/mailState: e\.target\.value/.test(ui),
    "a mailState box is still typed by hand");
}

console.log("\n-- the server will not store a state that is not one --");
{
  const w = readFileSync(join(app, "worker", "index.js"), "utf8");
  ck("the worker uses the same list", /from "\.\.\/shared\/states\.js"/.test(w));
  ck("signup normalises", /const state = normalizeState\(b\.state\)/.test(w));
  ck("so does the company profile", /normalizeState\(b\.state\)/.test(w.slice(w.indexOf("api/my-company"))));
}

console.log("\n-- signing up does not require a licence --");
{
  const html = readFileSync(join(app, "..", "get-started.html"), "utf8");
  ck("no licence gate", !/Enter your state license number/.test(html), "the gate is still there");
  ck("no UBI gate", !/Enter your UBI number/.test(html), "the gate is still there");
  ck("it is marked optional", /class="opt">optional/.test(html));
  ck("and says why it is worth doing later", /from your account/i.test(html));
  ck("the licence box no longer names one state",
    !/placeholder="WA L/.test(html), "still says WA L&I");
  ck("state is a list, not a box", /<select id="state"/.test(html));

  // The marketing page has no build step, so its copy of the list is a copy.
  // It must not drift from the real one.
  const codes = [...html.matchAll(/\['([A-Z]{2})','[^']+'\]/g)].map((m) => m[1]);
  ck("the page's own copy has all fifty-one", codes.length === 51, String(codes.length));
  ck("and is the same list, in the same order",
    codes.join(",") === US_STATES.map(([c]) => c).join(","), "drifted from shared/states.js");
}

console.log("\n-- and the licence is asked for where it buys something --");
{
  const ui = readFileSync(join(app, "src", "App.tsx"), "utf8");
  const gs = ui.slice(ui.indexOf("function GettingStarted"), ui.indexOf("const doneCount"));
  ck("the set-up checklist asks for it", /id: "license"/.test(gs));
  ck("only where the account can be hired", /hireable \? \[\{/.test(gs));
  ck("it is done once a licence is on file", /done: !!\(myCompany && myCompany\.license\)/.test(gs));
  ck("and it says what to do in a state with no licence",
    /No state license where you are/.test(gs), "no guidance for unlicensed states");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
