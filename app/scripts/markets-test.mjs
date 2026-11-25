// 112. MARKETS, A LEAD'S MARKET BY ZIP, THE WEATHER WHERE THEY ARE, AND THE
// CONTACT CENTER'S RANK.
//
// What is pinned:
//
//   A MARKET is a name, ZIP codes and towns, and the services offered there.
//   Whole values only: "981" is not a ZIP. A town needs its state.
//
//   A LEAD'S MARKET is its ZIP first, then its town and state, worked out on
//   read; an inactive market is skipped, and the order the list came back in
//   never decides.
//
//   ONLY THE OFFICE CHANGES MARKETS. A contact center seat reads them (it needs
//   them to tell the homeowner what is offered) and is refused a write.
//
//   THE RANK counts appointments booked in the window, by who booked them,
//   leaves out canceled ones, and ties share a rank.
//
//   node --no-warnings scripts/markets-test.mjs

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";
import { runCheck } from "./lib/check-sql.mjs";
import { validMarket, marketFor, servicesNotOffered, weatherTalk } from "../shared/markets.js";
import { rankWindow, bookingLeaderboard } from "../shared/leads.js";

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

// --- the rules ---------------------------------------------------------------
ck("a market needs a name", validMarket({ zips: "98402", services: ["roofing"] }).error === "name_required");
ck("a ZIP is five digits, never a prefix", validMarket({ name: "T", zips: "981", services: ["roofing"] }).error === "bad_zip");
ck("a town needs its state", validMarket({ name: "T", cities: "Tacoma", services: ["roofing"] }).error === "city_needs_state");
ck("a market needs somewhere", validMarket({ name: "T", services: ["roofing"] }).error === "coverage_required");
ck("a market needs a service", validMarket({ name: "T", zips: "98402" }).error === "services_required");
const ok = validMarket({ name: "Tacoma", zips: "98402, 98403 98402", cities: "Tacoma, wa\nGig Harbor, WA", services: ["roofing", "bogus", "gutters"] });
ck("zips dedupe, states upper-case, unknown services drop", ok.ok && ok.market.zips.join() === "98402,98403"
  && ok.market.cities[0].state === "WA" && ok.market.services.join() === "roofing,gutters", JSON.stringify(ok));

const MK = [
  { id: "b", name: "Seattle", zips: ["98101"], cities: [{ city: "Tacoma", state: "WA" }], services: ["windows"] },
  { id: "a", name: "Tacoma", zips: ["98402"], cities: [{ city: "Tacoma", state: "WA" }], services: ["roofing"] },
  { id: "c", name: "Alpha", zips: ["98402"], cities: [], services: ["siding"], active: false },
];
ck("a ZIP match wins", marketFor(MK, { zip: "98101", city: "Tacoma", state: "WA" })?.id === "b");
ck("an inactive market is skipped", marketFor(MK, { zip: "98402" })?.id === "a");
ck("no ZIP match falls back to town and state, in name order", marketFor(MK, { zip: "99999", city: " tacoma ", state: "wa" })?.id === "b");
ck("a town with no state matches nothing", marketFor(MK, { city: "Tacoma" }) === null);
ck("no prefix match on a ZIP", marketFor(MK, { zip: "9840" }) === null);
ck("services not offered are named", servicesNotOffered(MK[1], ["roofing", "windows"]).join() === "windows");
ck("rain on a roofing call asks about leaks", /leaks/.test(weatherTalk({ tempF: 50, code: 63 }, ["roofing"])));
ck("no reading, nothing to say", weatherTalk({}, ["roofing"]) === null);

// --- the rank ------------------------------------------------------------------
const T = "2026-11-25"; // a Wednesday
ck("this week runs from Monday", rankWindow("week", T).from === "2026-11-23");
ck("month to date starts on the 1st", rankWindow("mtd", T).from === "2026-11-01");
ck("a custom range given backwards is put right", rankWindow("custom", T, { from: "2026-11-20", to: "2026-11-10" }).from === "2026-11-10");
const A = (by, name, at, status = "booked") => ({ createdBy: by, createdByName: name, createdAt: at, status });
const appts = [A("u1", "Ann", "2026-11-25 09:00:00"), A("u1", "Ann", "2026-11-25T10:00:00Z"), A("u2", "Bo", "2026-11-25 11:00:00"),
  A("u3", "Cy", "2026-11-25 11:00:00"), A("u3", "Cy", "2026-11-25 12:00:00", "cancelled"), A("u2", "Bo", "2026-11-24 12:00:00")];
const day = bookingLeaderboard({ appointments: appts, meId: "u2", from: T, to: T });
ck("today: Ann first with 2, Bo and Cy tie for second", day.rows[0].id === "u1" && day.myRank === 2
  && day.rows.find((r) => r.id === "u3").rank === 2, JSON.stringify(day.rows));
ck("a canceled booking does not count", day.total === 4);
ck("share is mine of everything booked", day.share === 25);
const wk = bookingLeaderboard({ appointments: appts, meId: "u2", ...rankWindow("week", T) });
ck("this week Bo ties Ann for first", wk.myRank === 1 && wk.myBooked === 2);
ck("nobody booked is no rank and no share", bookingLeaderboard({ appointments: [], meId: "u2", from: T, to: T }).share === null);

// --- the routes ---------------------------------------------------------------------
const { default: worker } = await import("../worker/index.js");
const SCHEMA = readFileSync(join(app, "worker", "schema.sql"), "utf8");
const seed = ({ drop = false } = {}) => {
  const db = freshDb({ base: SCHEMA, migrations: [] });
  db.exec(`
    INSERT INTO accounts(id,name,kind,subdomain,plan) VALUES
      ('acc_gc','Outerhome','general_contractor','outerhome','scale'),
      ('acc_other','Other Co','general_contractor','otherco','scale'),
      ('acc_pm','Sound PM','property_manager','soundpm','scale');
    INSERT INTO users(id,name,email) VALUES ('u_admin','R','r@o.test'),('u_cc','C','c@o.test'),('u_o','O','o@o.test'),('u_pm','P','p@o.test');
    INSERT INTO memberships(id,user_id,account_id,role) VALUES
      ('m1','u_admin','acc_gc','admin'),('m2','u_cc','acc_gc','callcenter'),('m3','u_o','acc_other','admin'),('m4','u_pm','acc_pm','admin');
  `);
  if (drop) db.exec(`DROP TABLE sales_markets;`);
  return { db, env: { DB: makeD1(db) } };
};
const call = (env, path, { method = "GET", body, who = "u_admin", acct = "acc_gc" } = {}) => worker.fetch(
  new Request(`https://api.subsub.work${path}`, { method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    headers: { "Content-Type": "application/json", "X-User-Id": who, "X-Account-Id": acct } }), env);
const json = async (r) => [r.status, await r.json().catch(() => ({}))];

{
  const { db, env } = seed();
  let [s, b] = await json(await call(env, "/api/markets", { method: "POST", body: { name: "Tacoma", zips: "98402", services: ["roofing"] } }));
  ck("an admin adds a market", s === 201 && b.market?.name === "Tacoma", `${s} ${JSON.stringify(b)}`);
  const id = b.market?.id;
  [s, b] = await json(await call(env, "/api/markets", { method: "POST", body: { name: "X", zips: "981", services: ["roofing"] } }));
  ck("a bad ZIP is refused by name", s === 400 && b.error === "bad_zip");
  [s, b] = await json(await call(env, "/api/markets", { who: "u_cc" }));
  ck("the contact center reads the markets", s === 200 && b.markets?.length === 1, `${s}`);
  [s, b] = await json(await call(env, "/api/markets", { method: "POST", who: "u_cc", body: { name: "Y", zips: "98403", services: ["roofing"] } }));
  ck("the contact center may not add one", s === 403, `${s} ${b.error}`);
  [s, b] = await json(await call(env, `/api/markets/${id}`, { method: "PATCH", who: "u_cc", body: { name: "Z" } }));
  ck("nor change one", s === 403);
  [s, b] = await json(await call(env, "/api/markets", { who: "u_o", acct: "acc_other" }));
  ck("another account sees none of them", s === 200 && b.markets?.length === 0);
  [s] = await json(await call(env, `/api/markets/${id}`, { method: "DELETE", who: "u_o", acct: "acc_other" }));
  ck("nor deletes one", s === 404 || s === 403, `${s}`);
  [s, b] = await json(await call(env, `/api/markets/${id}`, { method: "PATCH", body: { name: "Tacoma metro", zips: ["98402", "98404"], services: ["roofing", "siding"] } }));
  ck("an admin edits one", s === 200 && b.market?.zips?.length === 2, `${s} ${JSON.stringify(b)}`);
  [s] = await json(await call(env, "/api/markets", { who: "u_pm", acct: "acc_pm" }));
  ck("an account that sells to no homeowner has no markets", s === 403 || s === 404, `${s}`);
  [s] = await json(await call(env, `/api/markets/${id}`, { method: "DELETE" }));
  ck("an admin deletes one", s === 200);
  ck("the row is gone", !db.prepare("SELECT 1 FROM sales_markets WHERE id = ?").get(id));
  ck("CHECK.sql reads 112 as run", String(runCheck(db).m112_sales_markets) === "10", String(runCheck(db).m112_sales_markets));
  // The weather route: nothing to look up is {} and never an error.
  [s, b] = await json(await call(env, "/api/crm-weather?zip=12", { who: "u_cc" }));
  ck("no ZIP or town is an empty answer, not an error", s === 200 && Object.keys(b).length === 0);
}
{
  const { env } = seed({ drop: true });
  const [s, b] = await json(await call(env, "/api/markets"));
  ck("without 112 the list names the migration", s === 503 || b.migration === "112_markets" || b.migration === "112", `${s} ${JSON.stringify(b)}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
