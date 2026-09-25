// A database behind the code should say so, not 500.
//
// Reported as: "Could not load your company profile (HTTP 500,
// server_error)". The account had run 031 and not 030, so GET
// /api/my-company resolved the company fine and then asked for
// companies.connect_code -- the column that holds what a contractor's QR
// encodes, which 030 adds. D1 threw, nothing caught it, and the person was
// told the server had a bug. The one thing they needed to know, which file
// to run, was the one thing not said.
//
// Routes that expect to outrun the schema catch this themselves. Most do
// not, so the catch belongs in the handler of last resort as well.
//
// Two halves:
//
//   the detector, fed REAL SQLite wording rather than wording invented here
//   -- both ways SQLite has of saying a column is missing, which share no
//   words -- and lifted out of worker/index.js at runtime so a copy in this
//   file cannot drift from the original;
//
//   and the route, driven through the real Hono app with a stub D1 that
//   throws exactly what a database missing 030 throws.
//
//   node scripts/migration-500-test.mjs

import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

// ---- the real detector, not a copy of it ------------------------------
const src = readFileSync(new URL("../worker/index.js", import.meta.url), "utf8");
const from = src.indexOf("function missingSchema(err) {");
const to = src.indexOf("\n}", from) + 2;
ck("missingSchema was found in the worker", from > 0 && to > from, `${from}..${to}`);
// eslint-disable-next-line no-new-func
const missingSchema = new Function(`${src.slice(from, to)}; return missingSchema;`)();

// ---- wording SQLite actually produces ---------------------------------
// Both forms matter and they share no words: a SELECT says "no such column",
// an INSERT says "table X has no column named Y".
const db = new DatabaseSync(":memory:");
db.exec(`CREATE TABLE companies (id TEXT PRIMARY KEY, company TEXT)`);
const throws = (sql) => { try { db.exec(sql); return null; } catch (e) { return e; } };

console.log("\n-- what SQLite says when 030 has not been run --");
const selectErr = throws(`SELECT connect_code FROM companies WHERE id = 'x'`);
const insertErr = throws(`INSERT INTO companies (id, connect_code) VALUES ('x', 'y')`);
const tableErr = throws(`SELECT * FROM connect_requests`);
ck("a SELECT complains", !!selectErr, String(selectErr?.message).slice(0, 60));
ck("an INSERT complains differently", !!insertErr, String(insertErr?.message).slice(0, 60));
ck("and so does a missing table", !!tableErr, String(tableErr?.message).slice(0, 60));
ck("the two column wordings really do differ",
  String(selectErr?.message) !== String(insertErr?.message));

ck("the SELECT wording names 030", missingSchema(selectErr) === "030_connect_requests", missingSchema(selectErr));
ck("the INSERT wording names 030", missingSchema(insertErr) === "030_connect_requests", missingSchema(insertErr));
ck("the missing table names 030", missingSchema(tableErr) === "030_connect_requests", missingSchema(tableErr));

// D1 wraps SQLite's message in its own prefix and suffix, and sometimes
// carries it on the cause rather than the error.
const wrapped = new Error(`D1_ERROR: no such column: connect_code: SQLITE_ERROR`);
const onCause = Object.assign(new Error("D1_ERROR"), { cause: selectErr });
ck("D1's own wrapping is still recognised", missingSchema(wrapped) === "030_connect_requests");
ck("and a message carried on the cause", missingSchema(onCause) === "030_connect_requests");

console.log("\n-- and it has not forgotten the ones it already knew --");
for (const [sql, want] of [
  [`SELECT notify FROM companies`, "018_user_notify"],
  [`SELECT * FROM visits`, "019_visits"],
  [`SELECT withdrawn_at FROM companies`, "020_withdrawn_reports"],
  [`SELECT severity FROM companies`, "023_emergencies"],
  [`SELECT pay_kind FROM companies`, "024_hourly_work_orders"],
  [`SELECT updated_at FROM companies`, "025_job_activity"],
  [`SELECT material_branch FROM companies`, "026_material_supplier"],
  [`SELECT * FROM user_invites`, "028_user_invites"],
]) {
  const got = missingSchema(throws(sql));
  ck(`${want}`, got === want, `got ${got}`);
}

console.log("\n-- a real error is still a real error --");
for (const e of [new Error("UNIQUE constraint failed: companies.license"),
                 new Error("network"), new Error("D1_ERROR: database is locked")]) {
  ck(`not a migration: ${e.message.slice(0, 40)}`, missingSchema(e) === null, String(missingSchema(e)));
}

// ---- the route, through the real app ----------------------------------
console.log("\n-- GET /api/my-company against a database missing 030 --");
{
  const { default: worker } = await import("../worker/index.js");

  // The smallest D1 that gets the request past auth and then fails the way
  // the reported database failed.
  const row = (sql) => {
    if (/FROM memberships WHERE user_id/i.test(sql)) {
      return { id: "mem1", role: "admin", account_id: "acc1", user_id: "u1", company_id: null };
    }
    if (/FROM accounts WHERE id/i.test(sql)) return { id: "acc1", kind: "general_contractor", company_id: "cmp_own_acc1" };
    if (/company_id FROM accounts/i.test(sql)) return { company_id: "cmp_own_acc1" };
    if (/FROM companies WHERE id/i.test(sql) && /connect_code/i.test(sql)) {
      throw new Error("D1_ERROR: no such column: connect_code: SQLITE_ERROR");
    }
    if (/FROM companies WHERE id/i.test(sql)) return { id: "cmp_own_acc1", company: "Outerhome" };
    return null;
  };
  const DB = { prepare: (sql) => ({
    bind: () => ({ first: async () => row(sql), all: async () => ({ results: [] }), run: async () => ({ meta: { changes: 1 } }) }),
    first: async () => row(sql), all: async () => ({ results: [] }), run: async () => ({ meta: { changes: 1 } }),
  }) };

  const res = await worker.fetch(
    new Request("https://api.subsub.work/api/my-company", { headers: { "X-User-Id": "u1", "X-Account-Id": "acc1" } }),
    { DB });
  const body = await res.json().catch(() => ({}));
  ck("it is not a 500", res.status !== 500, `${res.status} ${JSON.stringify(body)}`);
  ck("it is 503, the database is behind", res.status === 503, `${res.status} ${JSON.stringify(body)}`);
  ck("it says a migration is needed", body.error === "migration_needed", JSON.stringify(body));
  ck("and names the file to run", body.migration === "030_connect_requests", JSON.stringify(body));
  ck("with the wording kept for whoever is reading the console",
    /connect_code/.test(String(body.detail)), String(body.detail));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
