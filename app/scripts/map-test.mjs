// Where things are, for the maps (085). The server half.
//
// The properties that hold it:
//
//   A MAP OF YOUR OWN ROWS AND NOTHING ELSE. The route answers with a point
//   per job or building the same seat could already list -- another account's
//   job is absent, a project manager narrowed to named jobs or buildings gets
//   those and no others, a finished or taken-back job is not "current".
//
//   THE KIND DECIDES WHICH MAP, ON THE SERVER. A general contractor gets jobs
//   and a property manager gets buildings; asking for the other is refused,
//   because a tab hidden on the screen is a suggestion.
//
//   WHAT LEAVES IS THE ADDRESS AND NOTHING ELSE. No job title, no building
//   name, no account -- asserted on the URLs actually requested.
//
//   ONE LOOKUP PER ADDRESS, EVER, UNTIL IT IS WORTH ASKING AGAIN. A second
//   open asks nobody; a failure is cached and retried only once it is old; a
//   large list is placed a batch at a time and the rest come back pending.
//
//   A CENSUS MATCH IN THE WRONG STATE IS NOT AN ANSWER, and a street the
//   Census cannot match falls back to the ZIP, drawn as approximate.
//
//   node --no-warnings scripts/map-test.mjs

import { readFileSync } from "node:fs";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";
import { runCheck, checkStatements } from "./lib/check-sql.mjs";
import { addressLine, addressKey, jobAddress, censusPoint, groupPins, pinBounds, retryDue,
  jobsMapFor, buildingsMapFor, GEOCODE_BATCH, GEOCODE_RETRY_DAYS } from "../shared/mapgeo.js";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");
const SCHEMA = readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8");

// ---- the rules -----------------------------------------------------------
{
  console.log("\n-- the rules --");
  ck("street, town, state and ZIP make one line",
    addressLine({ address: "1620 Belmont Ave", city: "Seattle", state: "wa", zip: "98122-1234" })
      === "1620 Belmont Ave, Seattle, WA 98122");
  ck("a street typed as a whole address is kept whole, with the ZIP added",
    addressLine({ address: "88 Lake Ave, Seattle WA", zip: "98109" }) === "88 Lake Ave, Seattle WA 98109");
  ck("and not added twice", addressLine({ address: "88 Lake Ave, Seattle WA 98109", zip: "98109" })
    === "88 Lake Ave, Seattle WA 98109");
  ck("nothing usable is no line", addressLine({ address: " ", city: "", zip: "123" }) === "");
  ck("the key folds case and spacing", addressKey("1620  Belmont Ave") === addressKey("1620 belmont ave"));
  const atBuilding = jobAddress({ address: "x", area: "Kent", zip: "98032" },
    { address: "2 Pike St", city: "Seattle", state: "WA", zip: "98101" });
  ck("a job at a building is at the building", atBuilding.line === "2 Pike St, Seattle, WA 98101" && atBuilding.state === "WA",
    JSON.stringify(atBuilding));
  ck("otherwise its own street, town and ZIP",
    jobAddress({ address: "5 Oak St", area: "Kent", zip: "98032" }).line === "5 Oak St, Kent, 98032");
  const census = (state, x = -122.3, y = 47.6) => ({ result: { addressMatches: [
    { coordinates: { x, y }, addressComponents: { state } }] } });
  const p = censusPoint(census("WA"), "WA");
  ck("the Census answer is x = longitude, y = latitude", p && p.lat === 47.6 && p.lng === -122.3 && p.precision === "address",
    JSON.stringify(p));
  ck("a match in another state is refused", censusPoint(census("LA", -92.6, 32.5), "WA") === null);
  ck("no match is no point", censusPoint({ result: { addressMatches: [] } }, "WA") === null);
  const g = groupPins([{ lat: 47.1, lng: -122.1, precision: "address" }, { lat: 47.1, lng: -122.1, precision: "zip" },
    { lat: 47.2, lng: -122.2, precision: "address" }, { lat: null, lng: 1 }]);
  ck("things at one point are one pin, and approximate if any of them is",
    g.length === 2 && g.find((x) => x.items.length === 2)?.exact === false, JSON.stringify(g.map((x) => [x.items.length, x.exact])));
  ck("the bounds hold every pin", JSON.stringify(pinBounds(g)) === JSON.stringify([[-122.2, 47.1], [-122.1, 47.2]]));
  ck("no pins, no bounds", pinBounds([]) === null);
  const now = Date.parse("2026-10-15T12:00:00Z");
  ck("a failure is retried only once it is old",
    !retryDue("2026-10-10 12:00:00", now) && retryDue(`2026-0${9 - 1}-01 12:00:00`, now) && GEOCODE_RETRY_DAYS === 30);
  ck("a general contractor gets the jobs map and not the buildings one",
    jobsMapFor("general_contractor") && !buildingsMapFor("general_contractor"));
  ck("the three kinds with buildings get the buildings map, not the jobs one",
    ["property_manager", "portfolio_manager", "building_owner"].every((k) => buildingsMapFor(k) && !jobsMapFor(k))
    && !jobsMapFor("subcontractor") && !buildingsMapFor("subcontractor"));
}

// ---- a stubbed Census Bureau and Open-Meteo -------------------------------
const realFetch = globalThis.fetch;
let asked = [];
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json" } });
const CENSUS = {
  "1620 belmont ave, seattle, 98122": { x: -122.3252, y: 47.6185, state: "WA" },
  "2 pike st, seattle, wa 98101": { x: -122.3422, y: 47.6097, state: "WA" },
  // The Census matches the street in LOUISIANA; the building is in Washington.
  "1 market st, seattle, wa 98107": { x: -92.6, y: 32.5, state: "LA" },
  "400 pine st, tacoma, wa 98402": { x: -122.44, y: 47.25, state: "WA" },
};
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.startsWith("https://geocoding.geo.census.gov/")) {
    const addr = new URL(u).searchParams.get("address") || "";
    asked.push({ to: "census", url: u, addr });
    const hit = CENSUS[addr.toLowerCase()] || (/^bulk /i.test(addr) ? { x: -122 - Number(addr.split(" ")[1]) / 1000, y: 47.5, state: "" } : null);
    return json({ result: { addressMatches: hit ? [{ coordinates: { x: hit.x, y: hit.y }, addressComponents: { state: hit.state } }] : [] } });
  }
  if (u.startsWith("https://geocoding-api.open-meteo.com/")) {
    const name = new URL(u).searchParams.get("name") || "";
    asked.push({ to: "open-meteo", url: u, addr: name });
    if (name === "98109") return json({ results: [{ name: "Seattle", latitude: 47.63, longitude: -122.35, admin1: "Washington", country_code: "US", postcodes: ["98109"] }] });
    if (name === "98107") return json({ results: [{ name: "Seattle", latitude: 47.668, longitude: -122.384, admin1: "Washington", country_code: "US", postcodes: ["98107"] }] });
    return json({ results: [] });
  }
  return realFetch(url, init);
};

const seed = ({ migrated = true } = {}) => {
  const db = freshDb({ base: SCHEMA, migrations: [] });
  if (!migrated) db.exec(`DROP TABLE geocodes;`);
  db.exec(`
    INSERT INTO accounts(id,name,subdomain,kind,plan,billing) VALUES
      ('acc_gc','Outerhome','outerhome','general_contractor','scale','monthly'),
      ('acc_other','Rival GC','rival','general_contractor','scale','monthly'),
      ('acc_pm','Sound PM','sound','property_manager','scale','monthly'),
      ('acc_own','Owner Co','ownerco','building_owner','scale','monthly');
    INSERT INTO users(id,name,email) VALUES ('u_gc','Gus','gus@x.test'),('u_gpm','Pam','pam@x.test'),
      ('u_pm','Rae','rae@x.test'),('u_ppm','Pia','pia@x.test'),('u_ten','Ten','ten@x.test'),
      ('u_own','Oona','oona@x.test'),('u_rival','Rivo','rivo@x.test');
    INSERT INTO memberships(id,user_id,account_id,role) VALUES
      ('m_gc','u_gc','acc_gc','admin'),('m_gpm','u_gpm','acc_gc','pm'),('m_rival','u_rival','acc_other','admin'),
      ('m_pm','u_pm','acc_pm','admin'),('m_ppm','u_ppm','acc_pm','pm'),('m_ten','u_ten','acc_pm','tenant'),
      ('m_own','u_own','acc_own','admin');
    INSERT INTO properties(id,account_id,name,address,city,state,zip,units,owner_account_id) VALUES
      ('p1','acc_pm','Ballard Apts','1 Market St','Seattle','WA','98107',12,'acc_pm'),
      ('p2','acc_pm','Press Apts','2 Pike St','Seattle','WA','98101',8,'acc_pm'),
      ('p3','acc_pm','Nowhere Court','77 Unknown Way','Seattle','WA','98199',4,'acc_pm'),
      ('p_appointed','acc_other','Owner Tower','400 Pine St','Tacoma','WA','98402',20,'acc_pm');
    INSERT INTO membership_properties(membership_id,property_id) VALUES ('m_ppm','p2'),('m_ten','p1');
    INSERT INTO jobs(id,account_id,title,address,area,zip,trades) VALUES
      ('j_a','acc_gc','Secret Re-roof for Mrs Smith','1620 Belmont Ave','Seattle','98122','["roofing"]'),
      ('j_b','acc_gc','Basement drainage','88 Lake Ave','Seattle','98109','["roofing"]'),
      ('j_c','acc_gc','Fence repair',NULL,NULL,NULL,'["roofing"]'),
      ('j_rival','acc_other','Rival job','1620 Belmont Ave','Seattle','98122','["roofing"]');
    INSERT INTO jobs(id,account_id,title,address,area,zip,trades,status,completed_at) VALUES
      ('j_done','acc_gc','Old job','9 Done Rd','Seattle','98105','["roofing"]','completed','2026-09-01');
    INSERT INTO jobs(id,account_id,title,address,area,zip,trades,withdrawn_at) VALUES
      ('j_gone','acc_gc','Taken back','10 Gone Rd','Seattle','98105','["roofing"]','2026-09-01');
    INSERT INTO membership_jobs(membership_id,job_id) VALUES ('m_gpm','j_b');
  `);
  asked = [];
  return db;
};
const ENV = (db) => ({ DB: makeD1(db) });
const call = async (env, path, seat) => {
  const res = await worker.fetch(new Request(`https://api.subsub.work${path}`, {
    headers: { "Content-Type": "application/json", "X-User-Id": seat[0], "X-Account-Id": seat[1] },
  }), env);
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
const GC = ["u_gc", "acc_gc"], PM = ["u_pm", "acc_pm"];

// ---- the jobs map ---------------------------------------------------------
{
  console.log("\n-- a general contractor's jobs --");
  const db = seed(); const env = ENV(db);
  const r = await call(env, "/api/map/points?of=jobs", GC);
  const ids = Object.keys(r.body.points || {}).sort();
  ck("it answers", r.status === 200 && r.body.of === "jobs", JSON.stringify(r.body));
  ck("its own current jobs, placed", ids.join(",") === "j_a,j_b", ids.join(","));
  ck("another account's job at the same address is not there", !("j_rival" in (r.body.points || {})));
  ck("a finished job and a taken-back one are not current",
    !["j_done", "j_gone"].some((id) => id in r.body.points || r.body.pending.includes(id) || r.body.noAddress.includes(id)));
  ck("a job with no address is said to have none", r.body.noAddress.join(",") === "j_c", JSON.stringify(r.body.noAddress));
  ck("a street the Census matched is the address", r.body.points.j_a?.precision === "address"
    && r.body.points.j_a.lat === 47.6185 && r.body.points.j_a.lng === -122.3252, JSON.stringify(r.body.points.j_a));
  ck("a street it could not match falls back to the ZIP, marked approximate",
    r.body.points.j_b?.precision === "zip" && r.body.points.j_b.lat === 47.63, JSON.stringify(r.body.points.j_b));
  ck("what left was the address and never the job's name",
    asked.length > 0 && asked.every((a) => !/Secret|Smith|Outerhome|Drainage/i.test(decodeURIComponent(a.url))),
    asked.map((a) => a.addr).join(" | "));
  const cached = db.prepare(`SELECT COUNT(*) AS n FROM geocodes`).get().n;
  ck("each address is cached once", cached === 2, String(cached));

  asked = [];
  const again = await call(env, "/api/map/points?of=jobs", GC);
  ck("a second open asks nobody", asked.length === 0 && again.body.points.j_a?.lat === 47.6185, asked.map((a) => a.addr).join(","));

  const nar = await call(env, "/api/map/points?of=jobs", ["u_gpm", "acc_gc"]);
  ck("a project manager narrowed to one job gets that job and no other",
    Object.keys(nar.body.points || {}).join(",") === "j_b" && !(nar.body.noAddress || []).length, JSON.stringify(nar.body));

  const rival = await call(env, "/api/map/points?of=jobs", ["u_rival", "acc_other"]);
  ck("the rival sees their own job at that address, from the shared cache, and nothing of ours",
    Object.keys(rival.body.points || {}).join(",") === "j_rival", JSON.stringify(rival.body));

  const wrong = await call(env, "/api/map/points?of=buildings", GC);
  ck("a general contractor asking for the buildings map is refused", wrong.status === 403
    && wrong.body.error === "no_map_for_this_account", JSON.stringify(wrong.body));
}

// ---- the account's own HQ ----------------------------------------------------
{
  console.log("\n-- the account's HQ --");
  const db = seed(); const env = ENV(db);
  db.exec(`INSERT INTO companies(id,company,mail_street,mail_city,mail_state,mail_zip,city,state,zip) VALUES
      ('cmp_gc','Outerhome','400 Pine St','Tacoma','WA','98402','Seattle','WA','98109'),
      ('cmp_rival','Rival GC','',NULL,NULL,NULL,NULL,'WA',NULL);
    UPDATE accounts SET company_id = 'cmp_gc' WHERE id = 'acc_gc';
    UPDATE accounts SET company_id = 'cmp_rival' WHERE id = 'acc_other';`);
  const r = await call(env, "/api/map/points?of=jobs", GC);
  ck("the company row's address is the HQ, placed", r.body.hqState === "set" && r.body.hq?.lat === 47.25
    && r.body.hq.lng === -122.44 && r.body.hq.precision === "address", JSON.stringify({ hq: r.body.hq, s: r.body.hqState }));
  ck("the HQ is never one of the points, pending or the unplaced",
    !Object.keys(r.body.points).some((k) => k.startsWith("__")) && !r.body.pending.concat(r.body.noAddress).some((k) => String(k).startsWith("__")),
    JSON.stringify(r.body));
  ck("its address is cached like any other", !!db.prepare(`SELECT 1 FROM geocodes WHERE address_key = ?`)
    .get(addressKey("400 Pine St, Tacoma, WA 98402")));
  ck("the account's jobs are unchanged beside it", Object.keys(r.body.points).sort().join(",") === "j_a,j_b");
  const rival = await call(env, "/api/map/points?of=jobs", ["u_rival", "acc_other"]);
  ck("a company row with no street says so, and draws no HQ",
    rival.body.hqState === "no_address" && rival.body.hq === null, JSON.stringify({ hq: rival.body.hq, s: rival.body.hqState }));
  ck("and it is our HQ, never another account's", rival.body.hq?.lat !== 47.25);
  const pm = await call(env, "/api/map/points?of=buildings", PM);
  ck("an account with no company row has no HQ, and nothing is guessed from its buildings",
    pm.body.hqState === "none" && pm.body.hq === null, JSON.stringify({ hq: pm.body.hq, s: pm.body.hqState }));
  db.exec(`UPDATE companies SET mail_street = NULL WHERE id = 'cmp_gc'`);
  const near = await call(env, "/api/map/points?of=jobs", GC);
  ck("with no street, the profile's own ZIP places it, approximately",
    near.body.hqState === "set" && near.body.hq?.precision === "zip" && near.body.hq.lat === 47.63, JSON.stringify(near.body.hq));
  db.exec(`UPDATE companies SET mail_street = '1 Nowhere Rd', mail_zip = '00000', zip = '00000', mail_city = NULL, city = NULL WHERE id = 'cmp_gc'`);
  const nf = await call(env, "/api/map/points?of=jobs", GC);
  ck("an HQ the geocoder cannot place says so", nf.body.hqState === "not_found" && nf.body.hq === null, JSON.stringify(nf.body.hqState));
}

// ---- the buildings map ----------------------------------------------------
{
  console.log("\n-- a property manager's buildings --");
  const db = seed(); const env = ENV(db);
  const r = await call(env, "/api/map/points?of=buildings", PM);
  ck("it answers", r.status === 200 && r.body.of === "buildings", JSON.stringify(r.body));
  ck("the Census match in the wrong state was refused; the ZIP placed it instead",
    r.body.points.p1?.precision === "zip" && r.body.points.p1.lat === 47.668, JSON.stringify(r.body.points.p1));
  ck("a building at a matched street is placed exactly", r.body.points.p2?.precision === "address");
  ck("a building nobody can place is said so (null), not left out", "p3" in r.body.points && r.body.points.p3 === null,
    JSON.stringify(r.body.points));
  ck("a building it owns and somebody else runs is on its map",
    r.body.points.p_appointed?.precision === "address", JSON.stringify(r.body.points.p_appointed));
  const failed = db.prepare(`SELECT precision, lat FROM geocodes WHERE address_key = ?`)
    .get(addressKey("77 Unknown Way, Seattle, WA 98199"));
  ck("the failure is cached, so the next open does not ask again",
    failed?.precision === "none" && failed.lat === null, JSON.stringify(failed));
  asked = [];
  await call(env, "/api/map/points?of=buildings", PM);
  ck("and it does not", asked.length === 0, asked.map((a) => a.addr).join(","));
  db.exec(`UPDATE geocodes SET checked_at = '2025-01-01 00:00:00' WHERE precision = 'none'`);
  asked = [];
  await call(env, "/api/map/points?of=buildings", PM);
  ck("an old failure is asked about again", asked.some((a) => /77 Unknown Way/i.test(a.addr)),
    asked.map((a) => a.addr).join(","));

  const nar = await call(env, "/api/map/points?of=buildings", ["u_ppm", "acc_pm"]);
  ck("a project manager narrowed to one building gets that one, and not the appointed-out one",
    Object.keys(nar.body.points || {}).join(",") === "p2", JSON.stringify(nar.body.points));

  const ten = await call(env, "/api/map/points?of=buildings", ["u_ten", "acc_pm"]);
  ck("a tenant seat is refused", ten.status === 403, String(ten.status));
  const jobsAsPm = await call(env, "/api/map/points?of=jobs", PM);
  ck("a property manager asking for the jobs map is refused", jobsAsPm.status === 403, String(jobsAsPm.status));
  const own = await call(env, "/api/map/points?of=buildings", ["u_own", "acc_own"]);
  ck("a building owner account gets the buildings map", own.status === 200, String(own.status));
}

// ---- a large portfolio is placed a batch at a time --------------------------
{
  console.log("\n-- a batch at a time --");
  const db = seed(); const env = ENV(db);
  const n = GEOCODE_BATCH + 5;
  const rows = Array.from({ length: n }, (_, i) =>
    `('pb${i}','acc_pm','B${i}','bulk ${i}',NULL,NULL,NULL,1,'acc_pm')`).join(",");
  db.exec(`DELETE FROM properties WHERE account_id = 'acc_pm' OR owner_account_id = 'acc_pm';
    INSERT INTO properties(id,account_id,name,address,city,state,zip,units,owner_account_id) VALUES ${rows};`);
  const first = await call(env, "/api/map/points?of=buildings", PM);
  const placed1 = Object.keys(first.body.points).length;
  ck(`one call places ${GEOCODE_BATCH} and says the rest are pending`,
    placed1 === GEOCODE_BATCH && first.body.pending.length === 5, `${placed1} placed, ${first.body.pending.length} pending`);
  const second = await call(env, "/api/map/points?of=buildings", PM);
  ck("the next call places the rest", Object.keys(second.body.points).length === n && second.body.pending.length === 0,
    `${Object.keys(second.body.points).length}, ${second.body.pending.length} pending`);
}

// ---- the migration and the invariant -----------------------------------------
{
  console.log("\n-- before 085 is pasted --");
  const db = seed({ migrated: false }); const env = ENV(db);
  const r = await call(env, "/api/map/points?of=jobs", GC);
  ck("the route names the file to paste", r.status === 503 && r.body.migration === "085_geocodes", JSON.stringify(r.body));
  const [s1] = checkStatements();
  const row = db.prepare(s1).all().find((x) => x.name === "m085_geocodes");
  ck("CHECK.sql says it is not run", row?.verdict === "NOT RUN", JSON.stringify(row));
}
{
  console.log("\n-- the invariant --");
  const db = seed(); const env = ENV(db);
  await call(env, "/api/map/points?of=buildings", PM);
  const ok = runCheck(db);
  ck("real rows read zero", ok.m085_inv_geocode_half === 0 && ok.m085_geocodes === 6, JSON.stringify({ i: ok.m085_inv_geocode_half, c: ok.m085_geocodes }));
  db.exec(`INSERT INTO geocodes(address_key,lat,lng,precision) VALUES ('half','47.1',NULL,'address')`);
  ck("half a point is counted", runCheck(db).m085_inv_geocode_half === 1);
  db.exec(`DELETE FROM geocodes WHERE address_key='half';
    INSERT INTO geocodes(address_key,lat,lng,precision) VALUES ('liar',47.1,-122.1,'none')`);
  ck("a 'none' with a point is counted", runCheck(db).m085_inv_geocode_half === 1);
}

globalThis.fetch = realFetch;
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
