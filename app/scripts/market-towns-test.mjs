// A MARKET'S TOWNS COME WITH ITS ZIPS, A NEW MARKET LEAVES OUT WHAT ANOTHER
// ALREADY HAS, AND "WE SELL IN THE SAME PLACES WE WORK" KEEPS ONE MARKET IN
// STEP WITH WHERE YOU WORK.
//
// What is pinned:
//   - every ZIP has its town (GeoNames), Tacoma's 98402 included;
//   - the towns added are the towns of the ZIPs actually added: never one only
//     a skipped or already-listed ZIP is in;
//   - by default a ZIP or town another market has is left out and named;
//   - Where you work's fill adds names only, the out-of-state ones with their
//     state, never one twice;
//   - the zip-towns route answers the towns and nothing else;
//   - turning the switch on writes "Where we work" from the coverage, a save of
//     Where you work writes it again, its places cannot be edited from the
//     market, deleting it turns the switch off, and off leaves it standing;
//   - without 114 the switch names the file.
//
//   node --no-warnings scripts/market-towns-test.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";
import { townOfZip, marketFromCoverage, ZIP_TOWN_SOURCE } from "../shared/zipgeo.js";
import { fillZipsAndTowns, townsForTyped, takenBy, citiesFromFound } from "../shared/zipnear.js";

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

// --- the table -----------------------------------------------------------------
ck("the towns are GeoNames'", /GeoNames/.test(ZIP_TOWN_SOURCE));
ck("98402 is Tacoma, WA", JSON.stringify(townOfZip("98402")) === JSON.stringify({ city: "Tacoma", state: "WA" }), JSON.stringify(townOfZip("98402")));
ck("97201 is Portland, OR", townOfZip("97201")?.city === "Portland" && townOfZip("97201")?.state === "OR");
ck("an unknown ZIP has no town", townOfZip("00000") === null);

// --- filling a market ----------------------------------------------------------
const T = (zip, city, state = "WA") => ({ zip, city, state, miles: 0 });
const SOUTH = { id: "s", name: "South Sound", zips: ["98405"], cities: [{ city: "Fife", state: "WA" }] };
const taken = takenBy([SOUTH, { id: "me", name: "This one", zips: ["98444"], cities: [] }], "me");
ck("the market being edited is not counted as another", !taken.zips.has("98444") && taken.zips.get("98405") === "South Sound");
const f = fillZipsAndTowns({ zips: "98402", cities: "" },
  [T("98402", "Tacoma"), T("98403", "Tacoma"), T("98405", "Fife"), T("98406", "Ruston"), T("98424", "Fife")], { taken });
ck("a ZIP another market has is left out and named", !/98405/.test(f.zips) && f.skipped === 1 && f.skippedIn.join() === "South Sound", JSON.stringify(f));
ck("a town another market has is left out, even from a ZIP that was added", /98424/.test(f.zips) && f.townsSkipped.join() === "Fife, WA" && !/Fife/.test(f.cities), JSON.stringify(f));
ck("the towns of the added ZIPs are added", f.cities === "Tacoma, WA\nRuston, WA", JSON.stringify(f.cities));
const only = fillZipsAndTowns({ zips: "98402", cities: "" }, [T("98402", "Tacoma")], { taken });
ck("a town only an already-listed ZIP is in is not added (taking it out stays taken out)", only.cities === "" && only.added === 0, JSON.stringify(only));
const off = fillZipsAndTowns({ zips: "", cities: "" }, [T("98405", "Fife")], { taken, skipTaken: false });
ck("unticked, the overlap is taken, town and all", off.zips === "98405" && off.cities === "Fife, WA", JSON.stringify(off));
const capped = fillZipsAndTowns({}, [T("98402", "Tacoma"), T("98406", "Ruston")], { cap: 1 });
ck("past the cap, a dropped ZIP brings no town", capped.zips === "98402" && capped.cities === "Tacoma, WA" && capped.left === 1, JSON.stringify(capped));
const typed = townsForTyped("tacoma, wa", [T("98402", "Tacoma"), T("98499", "Lakewood"), T("98405", "Fife")], { taken });
ck("typed ZIPs add their towns, once, leaving out another market's", typed.added.join() === "Lakewood, WA" && typed.skipped.join() === "Fife, WA"
  && typed.cities === "tacoma, wa\nLakewood, WA", JSON.stringify(typed));
const work = citiesFromFound(["Tacoma"], [T("98402", "tacoma"), T("98660", "Vancouver"), T("97201", "Portland", "OR"), T("98661", "Vancouver")], { state: "WA" });
ck("Where you work's fill adds names, once, the out-of-state ones with their state", work.cities.join("|") === "Tacoma|Vancouver|Portland, OR", JSON.stringify(work));

// --- coverage as a market -------------------------------------------------------
const byCity = marketFromCoverage({ mode: "cities", cities: ["Tacoma", "Portland, OR", "tacoma"] }, { state: "WA" });
ck("cities become towns in the company's state, or the state written", JSON.stringify(byCity.cities) === JSON.stringify([{ city: "Tacoma", state: "WA" }, { city: "Portland", state: "OR" }]) && !byCity.zips.length, JSON.stringify(byCity));
const byRadius = marketFromCoverage({ mode: "radius", radii: [{ zip: "98402", miles: 5 }] });
ck("a radius becomes its ZIPs, nearest first, and their towns", byRadius.zips[0] === "98402" && byRadius.zips.length > 5 && byRadius.cities.some((c) => c.city === "Tacoma"), JSON.stringify(byRadius).slice(0, 160));
ck("a radius is capped", marketFromCoverage({ mode: "radius", radii: [{ zip: "98402", miles: 100 }] }, { maxZips: 50 }).zips.length === 50);

// --- the routes ----------------------------------------------------------------
const { default: worker } = await import("../worker/index.js");
const SCHEMA = readFileSync(join(app, "worker", "schema.sql"), "utf8");
const db = freshDb({ base: SCHEMA, migrations: [] });
db.exec(`
  INSERT INTO companies(id,company,state,coverage) VALUES ('cmp_gc','Outerhome','WA','{"mode":"cities","cities":["Tacoma","Fife"],"radii":[]}');
  INSERT INTO accounts(id,name,kind,subdomain,plan,company_id) VALUES ('acc_gc','Outerhome','general_contractor','outerhome','scale','cmp_gc');
  INSERT INTO users(id,name,email) VALUES ('u_admin','R','r@o.test'),('u_cc','C','c@o.test');
  INSERT INTO memberships(id,user_id,account_id,role) VALUES ('m1','u_admin','acc_gc','admin'),('m2','u_cc','acc_gc','callcenter');
`);
const env = { DB: makeD1(db) };
const call = (path, { method = "GET", body, who = "u_admin" } = {}) => worker.fetch(new Request(`https://api.subsub.work${path}`,
  { method, headers: { "X-User-Id": who, "X-Account-Id": "acc_gc", "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), env);
const json = async (r) => [r.status, await r.json().catch(() => ({}))];

let [s, b] = await json(await call("/api/markets/zip-towns?zips=98402,98405,0000,98402"));
ck("zip-towns answers each ZIP's town, once, skipping a malformed one", s === 200 && b.towns?.length === 2 && b.towns[0].city === "Tacoma", `${s} ${JSON.stringify(b)}`);
[s, b] = await json(await call("/api/markets/zip-towns?zips=98402", { who: "u_cc" }));
ck("a contact center seat is refused", s === 403, String(s));
[s, b] = await json(await call("/api/markets/zips-near?center=98402&miles=2"));
ck("zips-near carries each ZIP's town", s === 200 && b.zips?.[0]?.city === "Tacoma" && b.zips[0].state === "WA", JSON.stringify(b.zips?.[0]));

[s, b] = await json(await call("/api/markets"));
ck("the list says the switch is off", s === 200 && b.mirror?.on === false, JSON.stringify(b.mirror));
[s, b] = await json(await call("/api/markets/mirror", { method: "PUT", body: { on: true } }));
const mir = b.markets?.find((m) => m.id === b.mirror?.marketId);
ck("on, Where you work becomes the market \"Where we work\"", s === 200 && b.mirror?.on && mir?.name === "Where we work"
  && mir.cities.map((c) => `${c.city}, ${c.state}`).join("|") === "Tacoma, WA|Fife, WA" && mir.services.length > 0, `${s} ${JSON.stringify(b)}`);
[s, b] = await json(await call("/api/my-company", { method: "PATCH", body: { coverage: { mode: "radius", radii: [{ zip: "98402", miles: 3 }] } } }));
ck("the coverage saves", s === 200, `${s} ${JSON.stringify(b)}`);
[s, b] = await json(await call("/api/markets"));
const mir2 = b.markets?.find((m) => m.id === b.mirror?.marketId);
ck("a save of Where you work writes the market again", mir2?.zips?.[0] === "98402" && mir2.zips.length > 1 && mir2.id === mir.id, JSON.stringify(mir2).slice(0, 200));
[s, b] = await json(await call(`/api/markets/${mir.id}`, { method: "PATCH", body: { zips: ["98499"] } }));
ck("its places cannot be changed from the market", s === 409 && b.error === "mirrored_market", `${s} ${JSON.stringify(b)}`);
[s, b] = await json(await call(`/api/markets/${mir.id}`, { method: "PATCH", body: { name: "Home turf", zips: mir2.zips, cities: mir2.cities } }));
ck("its name is still its own, sent with its places unchanged", s === 200 && b.market?.name === "Home turf", `${s} ${JSON.stringify(b).slice(0, 160)}`);
[s, b] = await json(await call("/api/markets/mirror", { method: "PUT", body: { on: false } }));
ck("off leaves the market standing", s === 200 && b.mirror?.on === false && b.markets.some((m) => m.id === mir.id), JSON.stringify(b.mirror));
await call("/api/my-company", { method: "PATCH", body: { coverage: { mode: "cities", cities: ["Olympia"], radii: [] } } });
[s, b] = await json(await call("/api/markets"));
ck("and stops it moving", b.markets.find((m) => m.id === mir.id)?.zips?.[0] === "98402", JSON.stringify(b.markets.map((m) => m.cities)));
await call("/api/markets/mirror", { method: "PUT", body: { on: true } });
[s, b] = await json(await call("/api/markets"));
ck("on again, the same market is rewritten, not a second one", b.markets.length === 1 && b.markets[0].cities[0]?.city === "Olympia", JSON.stringify(b.markets));
[s, b] = await json(await call(`/api/markets/${mir.id}`, { method: "DELETE" }));
[s, b] = await json(await call("/api/markets"));
ck("deleting it turns the switch off", b.mirror?.on === false && !b.markets.length, JSON.stringify(b));
await call("/api/my-company", { method: "PATCH", body: { coverage: { mode: "cities", cities: ["Lacey"], radii: [] } } });
[s, b] = await json(await call("/api/markets"));
ck("so a later save does not write it back", !b.markets.length, JSON.stringify(b.markets));

db.exec(`UPDATE companies SET coverage = '{"mode":"cities","cities":[],"radii":[]}'`);
[s, b] = await json(await call("/api/markets/mirror", { method: "PUT", body: { on: true } }));
ck("with nowhere set, on is refused by name", s === 409 && b.error === "no_coverage", `${s} ${JSON.stringify(b)}`);

db.exec(`DROP TABLE market_mirror`);
[s, b] = await json(await call("/api/markets"));
ck("without 114 the list still loads, the switch naming the file", s === 200 && b.mirror?.migration === "114_estimates_mirror", JSON.stringify(b.mirror));
[s, b] = await json(await call("/api/markets/mirror", { method: "PUT", body: { on: true } }));
ck("and pressing it names the file", s === 503 && b.migration === "114_estimates_mirror", `${s} ${JSON.stringify(b)}`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
