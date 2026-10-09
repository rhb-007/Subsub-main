// Verifying a WA contractor registration with L&I, end to end through the
// Worker, with data.wa.gov stubbed at fetch.
//
// Three things were wrong and each is pinned here:
//
//   - The screen drew L&I's bond and insurance as an empty amount from an
//     unnamed surety, because it read {surety, amount} and was handed the
//     registry's own rows {surety_company, bond_amount}. checkView translates,
//     on the way in AND on the way out, so a row stored before it reads too.
//   - A check that could not reach L&I overwrote a real answer, so L&I being
//     down for an evening made every contractor on every roster unassignable
//     until the next night. A failed attempt is recorded in the history and
//     never replaces an answer on the company row.
//   - The pack page compared the status against lower-case "active", which no
//     registry sends, so a real L&I check never read as verified there.
//
//   node --no-warnings scripts/license-verify-test.mjs

import { readFileSync } from "node:fs";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";
import { checkView, licenseActive, nextStoredCheck, bondView } from "../shared/licensecheck.js";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");
const SCHEMA = readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8");
const APP = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const WORKER = readFileSync(new URL("../worker/index.js", import.meta.url), "utf8");

// What L&I answers. "ok" is a registered contractor, "missing" is a number
// nobody holds, "down" is the registry not answering at all.
let LNI = "ok";
const asked = [];
globalThis.fetch = async (url) => {
  const u = String(url);
  const ok = (j, status = 200) => new Response(JSON.stringify(j), { status, headers: { "Content-Type": "application/json" } });
  if (u.startsWith("https://data.wa.gov/")) {
    asked.push(u);
    if (LNI === "down") return ok({ message: "unavailable" }, 503);
    if (LNI === "missing") return ok([]);
    if (u.includes("/m8qx-ubtq.json")) return ok([{
      contractorlicensenumber: "CASCAAS900T1", businessname: "CASCADE APARTMENT SERVICES LLC",
      contractorlicensestatus: "ACTIVE", contractorlicensetypecodedesc: "CONSTRUCTION CONTRACTOR",
      ubi: "604123456", licenseeffectivedate: "2025-01-15T00:00:00.000",
      licenseexpirationdate: "2027-12-31T00:00:00.000", primaryprincipalname: "R BRAUN" }]);
    if (u.includes("/ciwg-agsx.json")) return ok([{ insurance_company: "State National Ins Co",
      policy_number: "NXT9-01-GL", coverage_amount: "1000000", effective_date: "2026-01-01T00:00:00.000",
      insurance_expiration_date: "2027-01-01T00:00:00.000" }]);
    if (u.includes("/bzff-4fmt.json")) return ok([{ surety_company: "North River Insurance Company",
      bond_amount: "30000", effective_date: "2025-01-15T00:00:00.000" }]);
    return ok([]);
  }
  return ok({});
};

const seed = () => {
  const db = freshDb({ base: SCHEMA, migrations: [] });
  db.exec(`
    INSERT INTO accounts(id,name,subdomain,kind,plan) VALUES ('acc_s','Sound','sound','property_manager','scale');
    INSERT INTO companies(id,company,contact,email,state,license,license_check) VALUES
      ('cmp_c','Cascade Apartment Services','R','r@c.test','WA','CASCAAS900T1',NULL),
      ('cmp_n','No Number Co','N','n@c.test','WA',NULL,NULL),
      ('cmp_old','Old Shape Co','O','o@c.test','WA','OLD*1',
        '{"found":true,"status":"ACTIVE","expirationDate":"2099-01-01","bond":{"surety_company":"Old Surety","bond_amount":"12000"},"insurance":{"insurance_company":"Old Carrier","coverage_amount":"2000000"}}');
    INSERT INTO engagements(id,account_id,company_id,status,categories) VALUES
      ('en_c','acc_s','cmp_c','active','["plumbing"]'),
      ('en_n','acc_s','cmp_n','active','["plumbing"]'),
      ('en_old','acc_s','cmp_old','active','["plumbing"]');
    INSERT INTO users(id,name,email) VALUES ('u_pm','Chris','chris@sound.test');
    INSERT INTO memberships(id,user_id,account_id,role) VALUES ('m_pm','u_pm','acc_s','admin');
  `);
  return { db, env: { DB: makeD1(db), FILES: { put: async () => {}, get: async () => null }, CRON_SECRET: "cron" } };
};
const call = (env, path, { method = "GET", body, headers } = {}) =>
  worker.fetch(new Request(`https://api.subsub.work${path}`, {
    method, body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "Content-Type": "application/json", ...(headers || { "X-User-Id": "u_pm", "X-Account-Id": "acc_s" }) },
  }), env);
const json = async (r) => [r.status, await r.json().catch(() => ({}))];
const stored = (db, id) => JSON.parse(db.prepare(`SELECT license_check FROM companies WHERE id = ?`).get(id).license_check || "null");

console.log("\n-- the rules --");
{
  ck("ACTIVE in capitals is active", licenseActive({ found: true, status: "ACTIVE", expirationDate: "2099-01-01" }));
  ck("and so is lower case", licenseActive({ found: true, status: "active" }));
  ck("expired is not", !licenseActive({ found: true, status: "ACTIVE", expirationDate: "2020-01-01" }));
  ck("suspended is not", !licenseActive({ found: true, status: "ACTIVE", suspendDate: "2026-01-01" }));
  ck("not found is not", !licenseActive({ found: false, status: "NOT_FOUND" }));
  const b = bondView({ surety_company: "S", bond_amount: "30,000", bond_expiration_date: "2027-01-01T00:00:00" });
  ck("a registry bond row reads in the screen's shape", b.surety === "S" && b.amount === 30000 && b.expires === "2027-01-01", JSON.stringify(b));
  ck("a bond already in that shape is left as it is",
    JSON.stringify(bondView({ surety: "X", amount: 5, number: "N", expires: "Until Canceled" })) === JSON.stringify({ surety: "X", number: "N", amount: 5, expires: "Until Canceled" }));
  ck("a check with no bond gets none invented", !("bond" in checkView({ found: true, status: "ACTIVE" })));
  const prev = { found: true, status: "ACTIVE", checkedAt: "2026-10-01" };
  const kept = nextStoredCheck(prev, { found: false, status: "CHECK_FAILED" }, "2026-10-09");
  ck("a failed check keeps the last real answer", kept.kept && kept.stored.status === "ACTIVE" && kept.stored.lastFailedAt === "2026-10-09");
  const nf = nextStoredCheck(prev, { found: false, status: "NOT_FOUND" }, "2026-10-09");
  ck("a clean 'no such number' is an answer and replaces it", !nf.kept && nf.stored.status === "NOT_FOUND");
  const none = nextStoredCheck(null, { found: false, status: "CHECK_FAILED" }, "2026-10-09");
  ck("with nothing to keep, the failure is what is stored", !none.kept && none.stored.status === "CHECK_FAILED");
}

console.log("\n-- a registered contractor --");
{
  const { db, env } = seed();
  LNI = "ok";
  const [st, r] = await json(await call(env, "/api/subs/cmp_c/verify-license", { method: "POST" }));
  ck("the check answers", st === 200, `${st} ${JSON.stringify(r)}`);
  ck("found and ACTIVE", r.found === true && r.status === "ACTIVE", JSON.stringify(r).slice(0, 200));
  ck("the bond is in the shape the screen draws", r.bond?.surety === "North River Insurance Company" && r.bond?.amount === 30000, JSON.stringify(r.bond));
  ck("and the insurance", r.insurance?.carrier === "State National Ins Co" && r.insurance?.coverage === 1000000
    && r.insurance?.policy === "NXT9-01-GL" && r.insurance?.expires === "2027-01-01", JSON.stringify(r.insurance));
  ck("it carries the number it checked and the day", r.licenseNumber === "CASCAAS900T1" && /^\d{4}-\d{2}-\d{2}$/.test(r.checkedAt || ""), `${r.licenseNumber} ${r.checkedAt}`);
  ck("and is not marked as a failed check", !r.checkFailed);
  const s = stored(db, "cmp_c");
  ck("the company row stores the same shape", s?.bond?.amount === 30000 && s?.insurance?.carrier === "State National Ins Co");
  const h = db.prepare(`SELECT status, bond_amount_cents, bond_surety, insurance_coverage_cents, insurance_carrier FROM license_checks WHERE company_id = 'cmp_c'`).all();
  ck("the history row carries the bond and insurance in cents", h.length === 1 && h[0].bond_amount_cents === 3000000
    && h[0].insurance_coverage_cents === 100000000 && h[0].bond_surety === "North River Insurance Company", JSON.stringify(h));
  const [, subs] = await json(await call(env, "/api/subs"));
  const row = (Array.isArray(subs) ? subs : []).find((x) => x.id === "cmp_c");
  ck("the roster reads it as an active registration", row && licenseActive(row.licenseCheck), JSON.stringify(row?.licenseCheck)?.slice(0, 160));

  console.log("\n-- then L&I does not answer --");
  LNI = "down";
  const [st2, r2] = await json(await call(env, "/api/subs/cmp_c/verify-license", { method: "POST" }));
  ck("the press still answers", st2 === 200, String(st2));
  ck("and says the check failed", r2.checkFailed === true && r2.failure === "CHECK_FAILED", JSON.stringify(r2).slice(0, 200));
  ck("while the registration it already had stands", r2.status === "ACTIVE" && licenseActive(r2));
  const s2 = stored(db, "cmp_c");
  ck("the company row was not overwritten with the failure", s2.status === "ACTIVE" && !!s2.lastFailedAt, JSON.stringify(s2).slice(0, 200));
  const h2 = db.prepare(`SELECT status FROM license_checks WHERE company_id = 'cmp_c' ORDER BY id`).all().map((x) => x.status);
  ck("but the failed attempt is in the history", JSON.stringify(h2) === '["ACTIVE","CHECK_FAILED"]', JSON.stringify(h2));

  console.log("\n-- the nightly sweep, with L&I down --");
  const [st3] = await json(await call(env, "/api/cron/license-sweep", { headers: { Authorization: "Bearer cron" } }));
  ck("the sweep runs", st3 === 200, String(st3));
  ck("and leaves the roster assignable", licenseActive(stored(db, "cmp_c")), JSON.stringify(stored(db, "cmp_c")).slice(0, 160));

  console.log("\n-- and then L&I has no such number --");
  LNI = "missing";
  const [, r4] = await json(await call(env, "/api/subs/cmp_c/verify-license", { method: "POST" }));
  ck("a clean 'not found' replaces the answer", r4.found === false && r4.status === "NOT_FOUND" && !r4.checkFailed, JSON.stringify(r4));
  ck("and the registration is no longer active", !licenseActive(stored(db, "cmp_c")));
}

console.log("\n-- the edges --");
{
  const { db, env } = seed();
  const [st, r] = await json(await call(env, "/api/subs/cmp_n/verify-license", { method: "POST" }));
  ck("no number on file is refused by name", st === 400 && r.error === "no_license_on_file", `${st} ${JSON.stringify(r)}`);
  LNI = "down";
  const [, r2] = await json(await call(env, "/api/subs/cmp_c/verify-license", { method: "POST" }));
  ck("a first check that fails is stored as a failure, not an answer", r2.status === "CHECK_FAILED" && !r2.checkFailed && !licenseActive(stored(db, "cmp_c")), JSON.stringify(r2));
  const [, subs] = await json(await call(env, "/api/subs"));
  const old = (Array.isArray(subs) ? subs : []).find((x) => x.id === "cmp_old");
  ck("a check stored in the registry's own shape reads in the screen's",
    old?.licenseCheck?.bond?.amount === 12000 && old?.licenseCheck?.bond?.surety === "Old Surety"
    && old?.licenseCheck?.insurance?.carrier === "Old Carrier" && old?.licenseCheck?.insurance?.coverage === 2000000,
    JSON.stringify(old?.licenseCheck));
}

console.log("\n-- the screen and the pack page --");
{
  ck("the screen no longer invents a check when the call fails",
    !/lookupLicense|local simulation/.test(APP));
  ck("Verify is awaited and says why it did not run",
    /function LicenseVerifyButton/.test(APP) && /licenseVerifyErrText\(err\)/.test(APP));
  ck("both Verify buttons are that one control",
    (APP.match(/<LicenseVerifyButton /g) || []).length === 2);
  ck("the roster's rule is the shared one", /return licenseActive\(sub\?\.licenseCheck\)/.test(APP));
  ck("the pack page reads the shared rule, not a lower-case 'active'",
    /licenseVerified: licenseActive\(lic\)/.test(WORKER) && !/lic\?\.status === "active"/.test(WORKER));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
