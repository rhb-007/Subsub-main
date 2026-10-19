// Every piece of English the screens pass to tt() has a Spanish line, and the
// two agree on their {placeholders}. The English is the key (lib/i18n.js), so
// an edit to the English silently falls back to English in Spanish; this is
// what names it, and the mutation that proves it is adding a tt() with no entry.
//
//   node --no-warnings scripts/i18n-test.mjs

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ES from "../src/i18n/es.js";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const src = readFileSync(join(app, "src/App.tsx"), "utf8");
let pass = 0, fail = 0;
const ck = (name, ok, detail = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok" : "FAIL"}  ${name}${detail && !ok ? `  -- ${detail}` : ""}`); };

const keys = new Set();
for (const m of src.matchAll(/\btt\(\s*("(?:[^"\\]|\\.)*")/g)) keys.add(JSON.parse(m[1]));
// tt(cond ? "A" : "B", ...) -- both branches are keys.
for (const m of src.matchAll(/\btt\(\s*[^"()]*?\?\s*("(?:[^"\\]|\\.)*")\s*:\s*("(?:[^"\\]|\\.)*")/g)) {
  keys.add(JSON.parse(m[1])); keys.add(JSON.parse(m[2]));
}
const missing = [...keys].filter((k) => !Object.prototype.hasOwnProperty.call(ES, k));
ck(`every tt() string has Spanish (${keys.size} strings)`, missing.length === 0, JSON.stringify(missing.slice(0, 20)));
const ph = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
const bad = Object.entries(ES).filter(([en, es]) => ph(en) !== ph(es));
ck("the Spanish keeps every {placeholder}", bad.length === 0, JSON.stringify(bad.slice(0, 5)));
const same = Object.entries(ES).filter(([en, es]) => en === es && /[a-z]{4,}/.test(en)
  && !["Preferred Sub", "Solar", "HVAC"].includes(en));
ck("nothing is 'translated' to the same English", same.length === 0, JSON.stringify(same.slice(0, 5)));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
