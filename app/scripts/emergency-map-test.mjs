// The severity map and the problem list, kept honest about each other.
//
// shared/emergency.js decides which reported problems are emergencies. It is
// keyed by the exact label a tenant taps, which makes it quietly fragile: a
// label reworded in App.tsx, or a typo in the map, silently downgrades a
// burst pipe to ordinary work and nothing anywhere complains.
//
// So this compares the two, both ways, and also checks the Worker reaches
// the same verdict as the browser -- they import the same file, and this is
// what proves they still do.
//
//   node scripts/emergency-map-test.mjs

import { readFileSync } from "node:fs";
import { EMERGENCY, severityOf, is911, isUrgent, severityRank } from "../shared/emergency.js";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

// Every label the tenant form can offer, read out of the source rather than
// listed again here -- a second copy would be the very drift this guards.
const src = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const start = src.indexOf("const TENANT_PROBLEMS = [");
const end = src.indexOf("\n];", start);
const block = src.slice(start, end);
const labels = [...block.matchAll(/label:\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1].replace(/\\"/g, '"').replace(/\\'/g, "'"));

console.log("\n-- the two lists line up --");
ck("the problem list was actually found", labels.length > 80, `${labels.length} problems`);
const unknown = Object.keys(EMERGENCY).filter((l) => !labels.includes(l));
ck("every label the map marks is a label a tenant can pick", unknown.length === 0, unknown.join(" | "));
const dupes = labels.filter((l, i) => labels.indexOf(l) !== i);
ck("and no problem is listed twice", dupes.length === 0, dupes.join(" | "));

console.log("\n-- the things that were asked for --");
// Named in the request that prompted this, so named here: if any of these
// stops being an emergency, it should take a failing test to do it.
for (const [label, want] of [
  ["Water is flooding in", "urgent"],
  ["My toilet is overflowing", "urgent"],
  ["A pipe has burst", "urgent"],
  ["It's dangerously cold in here", "urgent"],
  ["It's dangerously hot in here", "urgent"],
  ["There's a fire, or I can smell smoke", "911"],
  ["An outlet or switch is sparking", "911"],
]) ck(`${label} → ${want}`, severityOf(label) === want, severityOf(label) || "not an emergency");

console.log("\n-- and the things that are not --");
for (const label of [
  "A faucet is dripping",
  "The paint is peeling",
  "The sink is draining slowly",
  "It's too warm in here",
  "The common areas need cleaning",
]) ck(`${label} stays ordinary work`, severityOf(label) === null, severityOf(label) || "");

console.log("\n-- the shape of it --");
ck("every value is one of the two levels",
  Object.values(EMERGENCY).every((v) => v === "911" || v === "urgent"),
  [...new Set(Object.values(EMERGENCY))].join(" | "));
ck("nothing is marked by accident: the list stays short",
  Object.keys(EMERGENCY).length <= labels.length / 3,
  `${Object.keys(EMERGENCY).length} of ${labels.length}`);
ck("no label has stray whitespace, which would never match a tap",
  Object.keys(EMERGENCY).every((l) => l === l.trim()));
ck("life safety sorts above urgent, and urgent above the rest",
  severityRank("911") < severityRank("urgent") && severityRank("urgent") < severityRank(null));
ck("the helpers agree with the map",
  is911("I can smell gas") && !is911("A pipe has burst") && isUrgent("A pipe has burst"));
ck("an unknown label is not an emergency", severityOf("Something nobody ever wrote") === null);
ck("and neither is nothing at all", severityOf(null) === null && severityOf("") === null);

console.log("\n-- the Worker sees the same thing --");
const worker = readFileSync(new URL("../worker/index.js", import.meta.url), "utf8");
ck("the Worker imports the shared map rather than keeping its own",
  /from\s+["']\.\.\/shared\/emergency\.js["']/.test(worker),
  worker.match(/import[^\n]*emergency[^\n]*/)?.[0] || "no import found");

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
