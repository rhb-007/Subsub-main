// EVERY ZIP WITHIN A DISTANCE OF A PLACE, for filling a market in.
//
// What is pinned:
//   - the table is the Census ZCTA list, complete enough to answer (Tacoma's
//     98402 is in it, and its neighbors come back nearest first);
//   - a radius returns what is inside it and nothing outside it;
//   - a town is placed only in the state typed, never a bigger namesake;
//   - merging adds into the list, never drops what is there, and past the cap
//     keeps the nearest and counts the rest;
//   - the route is the office's: a contact center seat is refused, and so is a
//     lookup with no state on the town or a radius past 100 miles;
//   - the browser bundle never carries the ZIP table.
//
//   node --no-warnings scripts/zip-near-test.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";
import { zipCenter, zipsNear, milesBetween, ZIP_COUNT } from "../shared/zipgeo.js";
import { parseCenter, validRadius, mergeZips } from "../shared/zipnear.js";

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

// --- the table and the radius --------------------------------------------------
ck("the table carries the Census ZCTAs", ZIP_COUNT > 33000, String(ZIP_COUNT));
const tac = zipCenter("98402");
ck("a ZIP has a center", tac && Math.abs(tac.lat - 47.254) < 0.01 && Math.abs(tac.lng + 122.444) < 0.01, JSON.stringify(tac));
ck("an unknown ZIP has none", zipCenter("00000") === null && zipCenter("9840") === null);
const near5 = zipsNear(tac, 5);
ck("the center's own ZIP comes first, at 0 miles", near5[0]?.zip === "98402" && near5[0].miles === 0, JSON.stringify(near5.slice(0, 2)));
ck("nearest first", near5.every((z, i) => i === 0 || z.miles >= near5[i - 1].miles));
ck("nothing past the radius", near5.every((z) => z.miles <= 5));
ck("nothing inside it is missed", (() => {
  // Brute force over every ZIP, no bounding box: the box must not cut anything off.
  const all = readFileSync(join(app, "shared", "zipcentroids.js"), "utf8").match(/"(\d{5}:[^"]+)"/)[1].split(",");
  const want = all.map((r) => r.split(":")).filter(([, la, lo]) => milesBetween(tac, { lat: la / 1000, lng: lo / 1000 }) <= 15).length;
  return want === zipsNear(tac, 15).length;
})(), String(zipsNear(tac, 15).length));
ck("a wider radius holds more", zipsNear(tac, 15).length > near5.length);
ck("Seattle's 98101 is about 25 miles from Tacoma", (() => { const d = milesBetween(tac, zipCenter("98101")); return d > 22 && d < 28; })());
ck("it crosses a state line: 97201 Portland at 25 mi reaches Vancouver, WA",
  zipsNear(zipCenter("97201"), 25).some((z) => z.zip === "98660"));

// --- what was typed ------------------------------------------------------------
ck("a ZIP is a center", parseCenter(" 98402 ").zip === "98402");
ck("a town needs its state", parseCenter("Tacoma").error === "city_needs_state");
ck("a town and state", (() => { const p = parseCenter("gig  harbor, wa"); return p.city === "gig harbor" && p.state === "WA"; })());
ck("four digits is not a ZIP", parseCenter("9840").error === "bad_zip");
ck("a radius is 1 to 100 whole miles", validRadius("15") === 15 && validRadius("0") === null && validRadius("101") === null && validRadius("2.5") === null);

// --- merging -------------------------------------------------------------------
const m = mergeZips(["98402", "98499"], [{ zip: "98402" }, { zip: "98403" }, { zip: "98405" }]);
ck("merging keeps what was there and adds the rest", m.zips.join() === "98402,98499,98403,98405" && m.added === 2 && m.already === 1, JSON.stringify(m));
const capped = mergeZips(["1", "2"], [{ zip: "a" }, { zip: "b" }, { zip: "c" }], 3);
ck("past the cap the nearest are kept and the rest counted", capped.zips.join() === "1,2,a" && capped.left === 2, JSON.stringify(capped));

// --- the route -----------------------------------------------------------------
const { default: worker } = await import("../worker/index.js");
const SCHEMA = readFileSync(join(app, "worker", "schema.sql"), "utf8");
const db = freshDb({ base: SCHEMA, migrations: [] });
db.exec(`
  INSERT INTO accounts(id,name,kind,subdomain,plan) VALUES ('acc_gc','Outerhome','general_contractor','outerhome','scale');
  INSERT INTO users(id,name,email) VALUES ('u_admin','R','r@o.test'),('u_cc','C','c@o.test');
  INSERT INTO memberships(id,user_id,account_id,role) VALUES ('m1','u_admin','acc_gc','admin'),('m2','u_cc','acc_gc','callcenter');
`);
const env = { DB: makeD1(db) };
const asked = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const u = String(url?.url || url);
  if (u.startsWith("https://geocoding-api.open-meteo.com/")) {
    asked.push(u);
    // A bigger namesake in another state comes FIRST, the way the real geocoder answers.
    return new Response(JSON.stringify({ results: [
      { name: "Tacoma", admin1: "Ohio", country_code: "US", latitude: 39.9, longitude: -82.9, population: 900000 },
      { name: "Tacoma", admin1: "Washington", country_code: "US", latitude: 47.2529, longitude: -122.4443, population: 220000 },
    ] }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  return realFetch(url, init);
};
const call = (path, who = "u_admin") => worker.fetch(new Request(`https://api.subsub.work${path}`,
  { headers: { "X-User-Id": who, "X-Account-Id": "acc_gc" } }), env);
const json = async (r) => [r.status, await r.json().catch(() => ({}))];
try {
  let [s, b] = await json(await call("/api/markets/zips-near?center=98402&miles=5"));
  ck("a ZIP center answers its neighbors", s === 200 && b.zips?.[0]?.zip === "98402" && b.zips.length === near5.length, `${s} ${JSON.stringify(b).slice(0, 200)}`);
  ck("a ZIP center asks nobody outside", asked.length === 0);
  [s, b] = await json(await call("/api/markets/zips-near?center=Tacoma%2C%20WA&miles=5"));
  ck("a town is placed in the state typed, not its bigger namesake", s === 200 && b.zips?.some((z) => z.zip === "98402")
    && b.center?.city === "Tacoma" && b.center?.state === "WA", `${s} ${JSON.stringify(b.center)}`);
  ck("only the town leaves", asked.length === 1 && /name=Tacoma(&|$)/.test(asked[0]), asked[0]);
  [s, b] = await json(await call("/api/markets/zips-near?center=Tacoma%2C%20TX&miles=5"));
  ck("a town not found in that state is said, never another state's", s === 404 && b.error === "place_not_found", `${s} ${b.error}`);
  [s, b] = await json(await call("/api/markets/zips-near?center=Tacoma&miles=5"));
  ck("a town with no state is refused", s === 400 && b.error === "city_needs_state");
  [s, b] = await json(await call("/api/markets/zips-near?center=98402&miles=250"));
  ck("a radius past 100 miles is refused", s === 400 && b.error === "bad_radius");
  [s, b] = await json(await call("/api/markets/zips-near?center=00000&miles=5"));
  ck("an unknown ZIP is said", s === 404 && b.error === "zip_not_found");
  [s, b] = await json(await call("/api/markets/zips-near?center=98402&miles=5", "u_cc"));
  ck("a contact center seat is refused", s === 403, `${s} ${b.error}`);
} finally { globalThis.fetch = realFetch; }

// --- the browser never carries the table --------------------------------------------
const appSrc = readFileSync(join(app, "src", "App.tsx"), "utf8");
ck("the app imports the pure half only", /from "\.\.\/shared\/zipnear\.js"/.test(appSrc) && !/zipgeo|zipcentroids/.test(appSrc));
ck("the pure half does not import the table", !/zipcentroids|zipgeo/.test(readFileSync(join(app, "shared", "zipnear.js"), "utf8").replace(/\/\/.*$/gm, "")));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
