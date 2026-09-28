// Which accounts get a weather chip, and where the town comes from.
//
// `GET /api/weather` read the city off `accounts.company_id -> companies.city`
// and nothing else. That column belongs to HIREABLE kinds: 031 mints a company
// row for a general contractor and a subcontractor, and CHECK.sql's
// m031_others_with actively forbids one for anybody else. So for a property
// manager, a building owner and a portfolio manager it was not a lookup that
// failed -- it was a join that could never match, on three of the five kinds.
//
// It survived because the route answers `{}` for EVERY failure, deliberately,
// so a dashboard never waits on an outbound host. "No weather" and "no weather
// yet" are the same reply, so nothing on any screen could say the query was
// wrong -- and every browser test drove a subcontractor.
//
// What this covers:
//
//   THE THREE KINDS THAT HAVE NO COMPANY ROW still get a town, off the
//   buildings they run, which is the more honest answer for them anyway.
//
//   OWNED COUNTS, NOT ONLY OPERATED. An owner who appointed a manager still
//   watches those buildings, and that is the whole reason they are here.
//
//   THE COMMONEST TOWN WINS, and a tie resolves the same way every time, or
//   one account produces two cache keys and two answers.
//
//   AND NOTHING LEAKS: the outbound call names a town and a state, never a
//   customer, a person or an address.
//
//   node --no-warnings scripts/weather-test.mjs

import { readFileSync } from "node:fs";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");
const SCHEMA = readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8");
const M031 = `ALTER TABLE accounts ADD COLUMN company_id TEXT REFERENCES companies(id);`;
const M039 = `ALTER TABLE properties ADD COLUMN owner_account_id TEXT REFERENCES accounts(id);`;

// One account of each shape that matters:
//   acc_gc   general contractor, hireable, company row with a city on it
//   acc_pm   property manager, NO company row -- the reported case
//   acc_own  building owner whose only building is operated by acc_pm
//   acc_bare a property manager with nothing at all
const seed = () => {
  const db = freshDb({ base: SCHEMA, migrations: [M031, M039] });
  db.exec(`
    INSERT INTO accounts(id,name,subdomain,kind) VALUES
      ('acc_gc','Alder Construction','alder','general_contractor'),
      ('acc_pm','Sound PM','sound','property_manager'),
      ('acc_own','Harbor Holdings','harbor','building_owner'),
      ('acc_bare','Brand New PM','brandnew','property_manager');
    INSERT INTO companies(id,company,city,state) VALUES
      ('cmp_own_acc_gc','Alder Construction','Bellingham','WA');
    UPDATE accounts SET company_id = 'cmp_own_acc_gc' WHERE id = 'acc_gc';

    INSERT INTO users(id,name,email) VALUES
      ('u_gc','G','g@alder.test'),('u_pm','P','p@sound.test'),
      ('u_ow','O','o@harbor.test'),('u_bare','B','b@brandnew.test');
    INSERT INTO memberships(id,user_id,account_id,role) VALUES
      ('m_gc','u_gc','acc_gc','admin'),('m_pm','u_pm','acc_pm','admin'),
      ('m_ow','u_ow','acc_own','admin'),('m_bare','u_bare','acc_bare','admin');

    -- Two in Tacoma, one in Olympia: the commonest town is Tacoma.
    INSERT INTO properties(id,account_id,owner_account_id,name,city,state) VALUES
      ('p1','acc_pm','acc_pm','Rainier Apartments','Tacoma','WA'),
      ('p2','acc_pm','acc_pm','Pacific Court','Tacoma','WA'),
      ('p3','acc_pm','acc_own','Harbor House','Olympia','WA');
  `);
  return db;
};

// Every outbound call is recorded rather than made. Open-Meteo is two hops --
// geocode the town, then read the current conditions at the coordinates -- and
// what is asserted is not only the answer but WHAT LEFT: a town and a state.
const calls = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (input) => {
  const url = String(input?.url || input);
  calls.push(url);
  if (url.includes("geocoding-api.open-meteo.com")) {
    return new Response(JSON.stringify({ results: [{ latitude: 47.2, longitude: -122.4 }] }),
      { headers: { "Content-Type": "application/json" } });
  }
  if (url.includes("api.open-meteo.com/v1/forecast")) {
    return new Response(JSON.stringify({ current: { temperature_2m: 54.4, weather_code: 61 } }),
      { headers: { "Content-Type": "application/json" } });
  }
  return new Response("{}", { headers: { "Content-Type": "application/json" } });
};

const ask = async (env, userId, accountId) => {
  calls.length = 0;
  const res = await worker.fetch(new Request("https://api.subsub.work/api/weather", {
    headers: { "X-User-Id": userId, "X-Account-Id": accountId },
  }), env);
  return { status: res.status, body: await res.json().catch(() => ({})), sent: [...calls] };
};

// The route caches per town for WEATHER_TTL_MIN, in a module-level Map that
// outlives a test. Each case therefore gets its OWN town, and where two cases
// must share one the order is stated -- a suite whose second assertion is
// served from the first one's cache is a suite that proves nothing.
try {
  console.log("\n-- a hireable account reads its own company row --");
  {
    const db = seed();
    const env = { DB: makeD1(db) };
    const r = await ask(env, "u_gc", "acc_gc");
    ck("it answers a reading", r.body.tempF === 54.4, JSON.stringify(r.body));
    ck("and names the town it used", r.body.place === "Bellingham", String(r.body.place));
    ck("which is the one on their company row",
      r.sent.some((u) => /name=Bellingham/.test(u)), r.sent.join(" | "));
  }

  console.log("\n-- a property manager has NO company row, and still gets one --");
  {
    // The reported bug. Before the fix this answered {} forever: the join had
    // nothing to match, so the outbound call was never even made.
    const db = seed();
    const env = { DB: makeD1(db) };
    const r = await ask(env, "u_pm", "acc_pm");
    ck("their company_id really is null",
      db.prepare("SELECT company_id FROM accounts WHERE id='acc_pm'").get().company_id == null);
    ck("and they get a reading anyway", r.body.tempF === 54.4, JSON.stringify(r.body));
    // Two buildings in Tacoma against one in Olympia.
    ck("off the commonest town in the portfolio", r.body.place === "Tacoma", String(r.body.place));
  }

  console.log("\n-- an owner who appointed a manager still gets their building --");
  {
    // acc_own operates nothing: Harbor House is run by acc_pm. Watching it is
    // the whole reason that account exists, so owning has to count.
    const db = seed();
    const env = { DB: makeD1(db) };
    ck("they operate no buildings at all",
      db.prepare("SELECT COUNT(*) AS n FROM properties WHERE account_id='acc_own'").get().n === 0);
    const r = await ask(env, "u_ow", "acc_own");
    ck("and still get a reading", r.body.tempF === 54.4, JSON.stringify(r.body));
    ck("from the building they own", r.body.place === "Olympia", String(r.body.place));
  }

  console.log("\n-- a tie resolves the same way every time --");
  {
    // One account must produce one cache key, or it gets two answers depending
    // on the order SQLite happened to return the rows in.
    // One building each, so the count decides nothing and only the tie-break
    // can. Asserting the winner against ONE fixture proves nothing: dropping
    // the ORDER BY entirely still passes, because SQLite's GROUP BY happens to
    // hand back the groups in key order anyway. That is an implementation
    // detail, not a guarantee, and a test resting on it is a test that cannot
    // fail.
    //
    // What IS verifiable is the property the tie-break exists for: the answer
    // must not depend on the order the rows went in. So the same two towns are
    // seeded twice, in opposite orders, and both have to agree.
    const tie = async (first, second) => {
      const db = seed();
      db.exec(`DELETE FROM properties;
               INSERT INTO properties(id,account_id,owner_account_id,name,city,state) VALUES
                 ('t1','acc_pm','acc_pm','One','${first}','WA'),
                 ('t2','acc_pm','acc_pm','Two','${second}','WA');`);
      return (await ask({ DB: makeD1(db) }, "u_pm", "acc_pm")).body.place;
    };
    const forwards = await tie("Yakima", "Zillah");
    const backwards = await tie("Zillah", "Yakima");
    ck("a tie picks the earlier name", forwards === "Yakima", String(forwards));
    ck("whichever order the buildings went in", backwards === forwards,
      `${forwards} vs ${backwards}`);
  }

  console.log("\n-- an account with nowhere at all is silent, not broken --");
  {
    const db = seed();
    const env = { DB: makeD1(db) };
    const r = await ask(env, "u_bare", "acc_bare");
    ck("it answers 200", r.status === 200, String(r.status));
    ck("with an empty object, so no caller has to branch",
      JSON.stringify(r.body) === "{}", JSON.stringify(r.body));
    // Nothing to ask about, so nothing is asked. A geocode for "" would be an
    // outbound request on somebody else's rate limit for a guaranteed miss.
    ck("and nothing left the building", r.sent.length === 0, r.sent.join(" | "));
  }

  console.log("\n-- what leaves is a town, and never a customer --");
  {
    const db = seed();
    // Its OWN town. The cache is a module-level Map keyed on town, so re-using
    // Tacoma here would be served from the property-manager case above and
    // `sent` would be empty -- and every "no X leaked" assertion below would
    // pass against a request that was never made. That is the shape of a test
    // that cannot fail, and it caught me writing one.
    db.exec(`UPDATE properties SET city = 'Spokane';
             UPDATE properties SET name = 'Rainier Apartments', address = '412 Pine St'
              WHERE id = 'p1';`);
    const env = { DB: makeD1(db) };
    const r = await ask(env, "u_pm", "acc_pm");
    const all = r.sent.join(" ");
    ck("the call was actually made, not served from cache", r.sent.length === 2, String(r.sent.length));
    ck("a town and a state go out", /name=Spokane/.test(all) && /admin1=WA/.test(all), all);
    ck("no street address", !/Pine/.test(all) && !/412/.test(all), all);
    ck("no building name", !/Rainier/.test(all), all);
    ck("no account or person", !/acc_pm/.test(all) && !/sound\.test/.test(all), all);
  }

  console.log("\n-- and a database behind the code still renders a dashboard --");
  {
    // No 031 and no 039: both reads throw "no such column". Weather is
    // decoration and must never cost a dashboard, so this is {} and a 200,
    // not a 500 and not migration_needed.
    const db = freshDb({ base: SCHEMA, migrations: [] });
    db.exec(`
      INSERT INTO accounts(id,name,subdomain,kind) VALUES ('a','A','a','property_manager');
      INSERT INTO users(id,name,email) VALUES ('u','U','u@a.test');
      INSERT INTO memberships(id,user_id,account_id,role) VALUES ('m','u','a','admin');`);
    // The index has to go first, or the drop fails on it rather than on the
    // thing being tested.
    db.exec(`DROP INDEX IF EXISTS ux_accounts_company`);
    db.exec(`DROP INDEX IF EXISTS ix_properties_owner`);
    db.exec(`ALTER TABLE accounts DROP COLUMN company_id`);
    db.exec(`ALTER TABLE properties DROP COLUMN owner_account_id`);
    const env = { DB: makeD1(db) };
    const r = await ask(env, "u", "a");
    ck("it still answers 200", r.status === 200, String(r.status));
    ck("with nothing, rather than an error", JSON.stringify(r.body) === "{}", JSON.stringify(r.body));
  }
} finally {
  globalThis.fetch = realFetch;
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
