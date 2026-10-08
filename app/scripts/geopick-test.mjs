// Which place a town name means. Reported: a tenant in Ruston, WA was shown
// Ruston, LOUISIANA's weather, because the geocoder takes no state filter and
// the route took its first answer. See shared/geopick.js.
//
//   node scripts/geopick-test.mjs

import { pickPlace } from "../shared/geopick.js";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

// The real shape of the problem: the bigger town in the wrong state first.
const RUSTON = [
  { name: "Ruston", admin1: "Louisiana", country_code: "US", latitude: 32.52, longitude: -92.64, population: 22166, postcodes: ["71270", "71272"] },
  { name: "Ruston", admin1: "Washington", country_code: "US", latitude: 47.30, longitude: -122.50, population: 1055, postcodes: ["98407"] },
];

console.log("\n-- the reported case --");
ck("Ruston, WA is Washington's Ruston", pickPlace(RUSTON, { city: "Ruston", state: "WA" })?.admin1 === "Washington");
ck("with the ZIP too", pickPlace(RUSTON, { city: "Ruston", state: "WA", zip: "98407" })?.latitude === 47.30);
ck("a full state name in the column works the same", pickPlace(RUSTON, { city: "Ruston", state: "Washington" })?.admin1 === "Washington");
ck("and Ruston, LA still gets Louisiana", pickPlace(RUSTON, { city: "Ruston", state: "LA" })?.admin1 === "Louisiana");

console.log("\n-- another state's weather is worse than none --");
ck("no match in the building's state answers nothing", pickPlace(RUSTON, { city: "Ruston", state: "OR" }) === null);
ck("an empty list answers nothing", pickPlace([], { city: "Ruston", state: "WA" }) === null);
ck("a garbage reply answers nothing", pickPlace(null, { city: "Ruston", state: "WA" }) === null);
ck("a result with no coordinates is not a place",
  pickPlace([{ name: "Ruston", admin1: "Washington" }], { city: "Ruston", state: "WA" }) === null);
ck("a result outside the US is not taken",
  pickPlace([{ name: "Paris", admin1: "Texas", country_code: "FR", latitude: 1, longitude: 1 }], { city: "Paris", state: "TX" }) === null);

console.log("\n-- inside the right state --");
const TWO_IN_WA = [
  { name: "Ruston Heights", admin1: "Washington", latitude: 1, longitude: 1, population: 5000, postcodes: ["98000"] },
  { name: "Ruston", admin1: "Washington", latitude: 2, longitude: 2, population: 1000, postcodes: ["98407"] },
];
ck("the ZIP decides between two in one state", pickPlace(TWO_IN_WA, { city: "Ruston Heights", state: "WA", zip: "98407" })?.latitude === 2);
ck("then an exact name over a bigger near-miss", pickPlace(TWO_IN_WA, { city: "Ruston", state: "WA" })?.latitude === 2);
ck("then the bigger place", pickPlace([
  { name: "X", admin1: "Washington", latitude: 1, longitude: 1, population: 10 },
  { name: "X", admin1: "Washington", latitude: 2, longitude: 2, population: 99 },
], { city: "X", state: "WA" })?.latitude === 2);
ck("a ZIP+4 on the building still matches", pickPlace(TWO_IN_WA, { state: "WA", zip: "98407-1234" })?.latitude === 2);

console.log("\n-- with no state to go by --");
ck("the ZIP decides", pickPlace(RUSTON, { zip: "98407" })?.admin1 === "Washington");
ck("with neither, the top US answer is the best there is", pickPlace(RUSTON, { city: "Ruston" })?.admin1 === "Louisiana");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
