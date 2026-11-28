// 116. WHERE YOU WORK, AS AREAS, AND EACH AREA ITS OWN MARKET.
//
// What is pinned:
//   - an area is checked like a market (a name, ZIPs or towns, a state on a
//     town), and an id that is not ours is replaced, never trusted;
//   - areas save through the account's own route, and a bad one is refused
//     with the market's own words;
//   - with "we sell in the same places we work" on, each area is a market of
//     the same name, under an id made from the area's, so renaming an area
//     renames the same market, and taking an area away takes its market away;
//   - the single "Where we work" market an older coverage made is replaced;
//   - a market made from an area cannot have its places or its name changed
//     there, and deleting one turns the mirror off;
//   - the services somebody picks on such a market survive the next save;
//   - the shared readers (Passport text, set-up gaps) read areas.
//
//   node --no-warnings scripts/work-areas-test.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeD1, makeR2, freshDb } from "./lib/d1-sqlite.mjs";
import { validWorkAreas, workAreaFor, mirrorMarketId } from "../shared/markets.js";
import { areaText } from "../shared/passport.js";
import { setupGaps } from "../shared/setup.js";

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

// --- the rules -----------------------------------------------------------------
let v = validWorkAreas([{ id: "abc123", name: "North Seattle", zips: ["98103", "98115"], cities: ["Seattle, WA"] },
  { id: "abc123", name: "Eastside", zips: "98004 98005", cities: "" }, { id: "../x", name: "South", cities: ["Tacoma, WA"] }]);
ck("areas are checked like markets", v.ok && v.areas.length === 3 && v.areas[0].cities[0].state === "WA" && v.areas[1].zips.length === 2, JSON.stringify(v));
ck("an id is kept when it is ours, replaced when it repeats or is not", v.areas[0].id === "abc123" && v.areas[1].id !== "abc123"
  && /^[a-z0-9]{6,24}$/.test(v.areas[2].id), v.areas.map((a) => a.id).join());
ck("a town needs its state", validWorkAreas([{ name: "x", cities: ["Tacoma"] }]).error === "city_needs_state");
ck("an area needs a name and a place", validWorkAreas([{ name: "", zips: ["98101"] }]).error === "name_required"
  && validWorkAreas([{ name: "x" }]).error === "coverage_required");
ck("a job is in the area its ZIP or town is in", workAreaFor(v.areas, { zip: "98005" })?.name === "Eastside"
  && workAreaFor(v.areas, { city: "tacoma", state: "WA" })?.name === "South" && !workAreaFor(v.areas, { zip: "99999" }));
ck("the Passport names the areas", areaText({ mode: "areas", areas: v.areas }) === "North Seattle · Eastside · South");
ck("an area is coverage for the set-up gaps", !setupGaps({ coverage: { mode: "areas", areas: v.areas } }).some((g) => g.key === "coverage"),
  JSON.stringify(setupGaps({ coverage: { mode: "areas", areas: v.areas } })));

// --- the routes ----------------------------------------------------------------
const { default: worker } = await import("../worker/index.js");
const SCHEMA = readFileSync(join(app, "worker", "schema.sql"), "utf8");
globalThis.fetch = async () => new Response("{}", { headers: { "Content-Type": "application/json" } });
const db = freshDb({ base: SCHEMA, migrations: [] });
db.exec(`
  INSERT INTO companies(id,company,state,coverage) VALUES ('cmp_gc','Outerhome','WA','{"mode":"cities","cities":["Tacoma","Fife"],"radii":[]}');
  INSERT INTO accounts(id,name,kind,subdomain,plan,company_id) VALUES ('acc_gc','Outerhome','general_contractor','outerhome','scale','cmp_gc');
  INSERT INTO users(id,name,email) VALUES ('u_admin','R','r@o.test');
  INSERT INTO memberships(id,user_id,account_id,role) VALUES ('m1','u_admin','acc_gc','admin');
`);
const env = { DB: makeD1(db), FILES: makeR2() };
const call = (path, { method = "GET", body } = {}) => worker.fetch(new Request(`https://api.subsub.work${path}`,
  { method, body: body !== undefined ? JSON.stringify(body) : undefined, headers: { "Content-Type": "application/json", "X-User-Id": "u_admin", "X-Account-Id": "acc_gc" } }), env);
const json = async (r) => [r.status, await r.json().catch(() => ({}))];
const stored = () => JSON.parse(db.prepare("SELECT coverage FROM companies WHERE id = 'cmp_gc'").get().coverage);
const markets = () => db.prepare("SELECT id, name, zips, services FROM sales_markets WHERE account_id = 'acc_gc' ORDER BY name").all();

// The older coverage mirrored first, the way an account already has it.
let [s, b] = await json(await call("/api/markets/mirror", { method: "PUT", body: { on: true } }));
ck("an older coverage mirrors as one market", s === 200 && markets().length === 1 && markets()[0].name === "Where we work", `${s} ${JSON.stringify(b).slice(0, 160)}`);

[s, b] = await json(await call("/api/my-company", { method: "PATCH", body: { coverage: { mode: "areas", areas: [{ name: "Bad", cities: ["Tacoma"] }] } } }));
ck("a bad area is refused in the market's words", s === 400 && b.error === "city_needs_state", `${s} ${JSON.stringify(b)}`);
const AREAS = [{ id: "north1", name: "North Seattle", zips: ["98103", "98115"], cities: ["Seattle, WA"] },
  { id: "east01", name: "Eastside", zips: ["98004"], cities: [] }];
[s, b] = await json(await call("/api/my-company", { method: "PATCH", body: { coverage: { mode: "areas", areas: AREAS } } }));
ck("areas save", s === 200 && stored().mode === "areas" && stored().areas.length === 2 && stored().areas[0].cities[0].city === "Seattle", `${s} ${JSON.stringify(stored())}`);
let m = markets();
ck("each area is its own market, named as the area, and the old one is gone", m.length === 2 && m.map((x) => x.name).join() === "Eastside,North Seattle"
  && m.find((x) => x.name === "North Seattle").id === mirrorMarketId("acc_gc", "north1"), JSON.stringify(m));
[s, b] = await json(await call("/api/markets"));
ck("the list says the mirror is on", b.mirror?.on === true && b.markets.length === 2);

// Narrow what is sold in one, then rename its area and change its ZIPs.
const nid = mirrorMarketId("acc_gc", "north1");
[s, b] = await json(await call(`/api/markets/${nid}`, { method: "PATCH", body: { services: ["roofing"] } }));
ck("what is sold there can be changed on the market", s === 200 && b.market.services.join() === "roofing", `${s} ${JSON.stringify(b)}`);
[s, b] = await json(await call(`/api/markets/${nid}`, { method: "PATCH", body: { zips: ["98101"] } }));
ck("its places cannot", s === 409 && b.error === "mirrored_market");
[s, b] = await json(await call(`/api/markets/${nid}`, { method: "PATCH", body: { name: "Other" } }));
ck("nor its name", s === 409 && b.error === "mirrored_market_name");
[s] = await json(await call("/api/my-company", { method: "PATCH", body: { coverage: { mode: "areas",
  areas: [{ ...AREAS[0], name: "North End", zips: ["98103", "98115", "98117"] }] } } }));
m = markets();
ck("renaming an area renames the same market, keeps what is sold, and an area taken away takes its market",
  s === 200 && m.length === 1 && m[0].id === nid && m[0].name === "North End" && JSON.parse(m[0].zips).length === 3 && JSON.parse(m[0].services).join() === "roofing",
  JSON.stringify(m));
[s, b] = await json(await call(`/api/markets/${nid}`, { method: "DELETE" }));
[s, b] = await json(await call("/api/markets"));
ck("deleting a market made from an area turns the mirror off", b.mirror?.on === false && b.markets.length === 0, JSON.stringify(b.mirror));
[s] = await json(await call("/api/my-company", { method: "PATCH", body: { coverage: { mode: "areas", areas: AREAS } } }));
ck("and the next save does not write it back", markets().length === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
