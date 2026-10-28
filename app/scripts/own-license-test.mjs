// A general contractor's OWN license -- the "Working as a subcontractor"
// profile on Account -> Company -- is checked against the state's register
// when it is saved, and can be checked again by the account and by staff.
//
// Asked for with that form on screen: "should verify this online as it's
// added ... and let admin re check as well". The roster's Verify button did
// this for a contractor somebody hires; the account's own number was stored
// and never asked about.
//
// Pinned: a new number is checked on save; an unchanged one is not; a changed
// one never keeps the old number's answer when the register is down; no state
// is assumed; the account can re-check; staff can re-check and edits from the
// console check too; a non-staff seat cannot use the console route.
//
//   node --no-warnings scripts/own-license-test.mjs

import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const supa = createServer((req, res) => {
  const who = String(req.headers.authorization || "").replace("Bearer ", "");
  if (!who || who === "nobody") { res.writeHead(401); return res.end("{}"); }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ id: `auth_${who}`, email: `${who}@subsub.test` }));
}).listen(8932);

const { default: worker } = await import("../worker/index.js");
const SCHEMA = readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8");

let LNI = "ok";
const asked = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.startsWith("http://127.0.0.1:8932")) return realFetch(url, init);
  const ok = (j, status = 200) => new Response(JSON.stringify(j), { status, headers: { "Content-Type": "application/json" } });
  if (u.startsWith("https://data.wa.gov/")) {
    asked.push(u);
    if (LNI === "down") return ok({ message: "unavailable" }, 503);
    if (LNI === "missing") return ok([]);
    if (u.includes("/m8qx-ubtq.json")) return ok([{
      contractorlicensenumber: decodeURIComponent(u).match(/'([A-Z0-9*]+)'/)?.[1] || "RUDDDCI044LF",
      businessname: "RUDD DEVELOPMENT LLC", contractorlicensestatus: "ACTIVE",
      contractorlicensetypecodedesc: "CONSTRUCTION CONTRACTOR",
      licenseeffectivedate: "2025-01-15T00:00:00.000", licenseexpirationdate: "2027-12-31T00:00:00.000" }]);
    return ok([]);
  }
  return ok({});
};

const seed = () => {
  const db = freshDb({ base: SCHEMA, migrations: [] });
  db.exec(`
    INSERT INTO companies(id,company,contact,email,state,license) VALUES
      ('cmp_own','Rudd Development','Matthew Rudd','m@rudd.test','WA',NULL),
      ('cmp_x','Somebody Else','X','x@x.test','WA','OTHER0001AB');
    INSERT INTO accounts(id,name,subdomain,kind,plan,company_id) VALUES
      ('acc_r','Rudd Development','rudd','general_contractor','scale','cmp_own');
    INSERT INTO users(id,name,email,auth_id) VALUES
      ('u_m','Matthew','m@rudd.test','auth_m'),
      ('u_super','Richard','super@subsub.test','auth_super');
    INSERT INTO memberships(id,user_id,account_id,role) VALUES ('m_m','u_m','acc_r','admin');
    INSERT INTO superadmins(user_id,role,finance,impersonate) VALUES ('u_super','superadmin',1,1);
  `);
  const base = { DB: makeD1(db), FILES: { put: async () => {}, get: async () => null } };
  return { db, env: base,
    staffEnv: { ...base, SUPABASE_URL: "http://127.0.0.1:8932", SUPABASE_ANON_KEY: "stub", STAFF_ALLOW_PASSWORD: "1" } };
};
const call = (env, path, { method = "GET", body, headers } = {}) =>
  worker.fetch(new Request(`https://api.subsub.work${path}`, {
    method, body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "Content-Type": "application/json", ...(headers || { "X-User-Id": "u_m", "X-Account-Id": "acc_r" }) },
  }), env);
const staff = (who) => ({ Authorization: `Bearer ${who}` });
const json = async (r) => [r.status, await r.json().catch(() => ({}))];
const stored = (db, id) => JSON.parse(db.prepare(`SELECT license_check FROM companies WHERE id = ?`).get(id).license_check || "null");
const history = (db, id) => db.prepare(`SELECT status FROM license_checks WHERE company_id = ? ORDER BY id`).all(id).map((r) => r.status);

try {
  console.log("\n-- saving a new number checks it --");
  {
    const { db, env } = seed();
    LNI = "ok"; asked.length = 0;
    const [st, r] = await json(await call(env, "/api/my-company", { method: "PATCH", body: { license: "RUDDDCI044LF" } }));
    ck("the save answers", st === 200, `${st} ${JSON.stringify(r).slice(0, 200)}`);
    ck("the register was asked", asked.length > 0, String(asked.length));
    ck("the reply carries the check", r.licenseCheck?.found === true && r.licenseCheck?.status === "ACTIVE", JSON.stringify(r.licenseCheck)?.slice(0, 200));
    ck("and says it ran", r.licenseVerify?.checked === true, JSON.stringify(r.licenseVerify));
    ck("the company row stores it", stored(db, "cmp_own")?.status === "ACTIVE");
    const [, g] = await json(await call(env, "/api/my-company"));
    ck("the form reads it back on load", g.licenseCheck?.status === "ACTIVE", JSON.stringify(g.licenseCheck)?.slice(0, 160));

    console.log("\n-- an unchanged number is not asked about again --");
    asked.length = 0;
    const [st2] = await json(await call(env, "/api/my-company", { method: "PATCH", body: { license: "RUDDDCI044LF", contact: "Matt Rudd" } }));
    ck("the save answers", st2 === 200);
    ck("nothing was asked", asked.length === 0, String(asked.length));
    ck("and only one check is in the history", history(db, "cmp_own").length === 1, JSON.stringify(history(db, "cmp_own")));

    console.log("\n-- a CHANGED number, with the register down --");
    LNI = "down";
    const [, r3] = await json(await call(env, "/api/my-company", { method: "PATCH", body: { license: "RUDDDNEW99ZZ" } }));
    const s3 = stored(db, "cmp_own");
    ck("the save still answers", !!r3.companyId, JSON.stringify(r3).slice(0, 160));
    ck("the old number's ACTIVE is not kept under the new one", s3?.status !== "ACTIVE", JSON.stringify(s3)?.slice(0, 160));
    ck("it reads as a failed check", s3?.status === "CHECK_FAILED", JSON.stringify(s3)?.slice(0, 160));

    console.log("\n-- the account re-checks --");
    LNI = "ok";
    const [st4, r4] = await json(await call(env, "/api/my-company/verify-license", { method: "POST" }));
    ck("Check now answers", st4 === 200 && r4.status === "ACTIVE", `${st4} ${JSON.stringify(r4).slice(0, 160)}`);
    ck("and the row follows", stored(db, "cmp_own")?.status === "ACTIVE");

    console.log("\n-- clearing the number clears the check --");
    await json(await call(env, "/api/my-company", { method: "PATCH", body: { license: "" } }));
    ck("no check about a number nobody holds", stored(db, "cmp_own") === null, JSON.stringify(stored(db, "cmp_own")));
    const [st5, r5] = await json(await call(env, "/api/my-company/verify-license", { method: "POST" }));
    ck("and Check now says there is no number", st5 === 400 && r5.error === "no_license_on_file", `${st5} ${JSON.stringify(r5)}`);
  }

  console.log("\n-- no state is assumed --");
  {
    const { db, env } = seed();
    db.prepare(`UPDATE companies SET state = NULL WHERE id = 'cmp_own'`).run();
    LNI = "ok"; asked.length = 0;
    const [, r] = await json(await call(env, "/api/my-company", { method: "PATCH", body: { license: "RUDDDCI044LF" } }));
    ck("the save goes through", !!r.companyId);
    ck("but nothing was asked of Washington", asked.length === 0, String(asked.length));
    ck("and the reply says why", r.licenseVerify?.skipped === "state_required", JSON.stringify(r.licenseVerify));
    const [st, r2] = await json(await call(env, "/api/my-company/verify-license", { method: "POST" }));
    ck("Check now names the missing state", st === 400 && r2.error === "state_required", `${st} ${JSON.stringify(r2)}`);
    // Setting the state is the moment the number can be read.
    const [, r3] = await json(await call(env, "/api/my-company", { method: "PATCH", body: { state: "WA" } }));
    ck("adding the state checks the number already saved", r3.licenseCheck?.status === "ACTIVE", JSON.stringify(r3.licenseCheck)?.slice(0, 120));
  }

  console.log("\n-- staff --");
  {
    const { db, staffEnv } = seed();
    LNI = "ok";
    db.prepare(`UPDATE companies SET license = 'RUDDDCI044LF' WHERE id = 'cmp_own'`).run();
    const [st, r] = await json(await call(staffEnv, "/api/platform/companies/cmp_own/verify-license", { method: "POST", headers: staff("super") }));
    ck("staff re-check answers", st === 200 && r.status === "ACTIVE", `${st} ${JSON.stringify(r).slice(0, 160)}`);
    ck("and is audited", db.prepare(`SELECT COUNT(*) AS n FROM events WHERE kind = 'company_license_checked'`).get().n === 1);
    const [st2] = await json(await call(staffEnv, "/api/platform/companies/cmp_own/verify-license", { method: "POST", headers: staff("m") }));
    ck("a customer's sign-in cannot use the console route", st2 === 401 || st2 === 403, String(st2));
    asked.length = 0;
    const [st3, r3] = await json(await call(staffEnv, "/api/platform/companies/cmp_x", { method: "PATCH", body: { license: "NEWNUM0001AB" }, headers: staff("super") }));
    ck("a license edited in the console is checked too", st3 === 200 && asked.length > 0 && r3.licenseCheck?.status === "ACTIVE",
      `${st3} ${asked.length} ${JSON.stringify(r3).slice(0, 160)}`);
    asked.length = 0;
    await json(await call(staffEnv, "/api/platform/companies/cmp_x", { method: "PATCH", body: { contact: "Y" }, headers: staff("super") }));
    ck("an edit that leaves the number alone does not ask", asked.length === 0, String(asked.length));
  }
} finally {
  supa.close();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
