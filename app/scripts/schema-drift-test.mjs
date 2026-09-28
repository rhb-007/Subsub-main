// schema.sql and the migrations have to describe the same database.
//
// They are two records of one thing. `worker/schema.sql` is what a FRESH
// database is built from -- a new environment, a preview, and every Worker test
// in this repo that calls freshDb(). The files in `worker/migrations/` are what
// the LIVE database was built from, one hand-run paste at a time.
//
// Nothing checked that they agreed, and they stopped agreeing around migration
// 010. By 045 schema.sql was missing twenty-six tables and thirty columns --
// `accounts.company_id` (031), `properties.owner_account_id` (039),
// `company_docs` (037), `doc_shares` (041) and the rest. Two consequences, one
// loud and one quiet:
//
//   A FRESH INSTALL WAS BORN BROKEN. Not subtly: CHECK.sql could not even be
//   run against it, because the columns its invariants read did not exist.
//
//   AND THE TESTS LIED IN BOTH DIRECTIONS. A Worker test on a freshDb() got a
//   database no customer has, so a route reading a post-010 column threw
//   "no such column" -- which the Worker deliberately reports as
//   `migration_needed` rather than a 500. That is right in production and
//   poison in a test: a genuine bug reads as a database behind the code, and a
//   route that quietly does nothing when a column is missing (the signup
//   company row is exactly this) passes while writing nothing at all. That is
//   how the subcontractor company row looked like a broken route for half an
//   hour.
//
// So this is the check that was missing. It builds both and compares the
// schema, not the data.
//
// HOW TO READ A FAILURE: it names the object or column, and the answer is
// almost always to add it to schema.sql -- the migrations are what customers
// actually ran, so they are the truth and schema.sql is the copy.
//
//   node scripts/schema-drift-test.mjs

import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const M = join(app, "worker", "migrations");
const SCHEMA = readFileSync(join(app, "worker", "schema.sql"), "utf8");

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

// 046 rebuilds `accounts` and drops every constraint with it -- it exists for
// databases that carry a CHECK the migrations never added, and running it here
// would compare schema.sql against a shape nobody is supposed to have.
// 042 repairs DATA, not schema.
const SKIP = new Set(["046_subcontractor_kind.sql", "042_repair_invariants.sql"]);
const files = readdirSync(M)
  .filter((f) => /^\d{3}_.*\.sql$/.test(f) && !SKIP.has(f)).sort();

const statements = (sql) => sql
  .split(/;\s*$/m)
  .map((x) => x.replace(/^\s*--.*$/gm, "").trim())
  .filter(Boolean);

// The live shape: schema.sql, then every migration, tolerating the ones
// schema.sql has already caught up on. That tolerance is the whole trick --
// it is what lets schema.sql be brought forward a piece at a time without
// this test flipping between two different kinds of failure.
// schema.sql not loading at all is the loudest failure here and has to be
// REPORTED, not thrown. An index referring to a column somebody removed is
// exactly the mistake this file exists to catch, and a stack trace naming
// node:sqlite is a worse way to learn it than one line naming the column.
const loadSchema = () => {
  const db = new DatabaseSync(":memory:");
  try { db.exec(SCHEMA); return { db, err: "" }; }
  catch (e) { return { db: null, err: String(e.message) }; }
};

const buildLive = () => {
  const { db, err } = loadSchema();
  if (!db) return { db: null, err, unexpected: [] };
  const unexpected = [];
  for (const f of files) {
    for (const st of statements(readFileSync(join(M, f), "utf8"))) {
      if (/^\s*(SELECT|WITH|PRAGMA)/i.test(st)) continue;
      try { db.exec(st + ";"); }
      catch (e) {
        const m = String(e.message);
        if (/duplicate column name|already exists/i.test(m)) continue;  // caught up
        unexpected.push(`${f}: ${m}`);
      }
    }
  }
  return { db, unexpected };
};

const buildFresh = () => loadSchema().db;

const objects = (db) => new Map(db.prepare(
  `SELECT type, name, tbl_name FROM sqlite_master
    WHERE name NOT LIKE 'sqlite_%' AND type IN ('table','index','view','trigger')`
).all().map((r) => [`${r.type} ${r.name}`, r]));

const columns = (db, table) => {
  try { return db.prepare(`PRAGMA table_info("${table}")`).all().map((c) => c.name); }
  catch { return []; }
};

console.log("\n-- schema.sql is valid SQL --");
const live = buildLive();
ck("it loads", !live.err, live.err);
if (live.err) {
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(1);
}

console.log("\n-- every migration still applies --");
// A migration that errors for any reason OTHER than "already there" means one
// of the two files is wrong about the other, and every comparison below is
// built on a database that did not finish being made.
ck("no migration failed against schema.sql", live.unexpected.length === 0,
  live.unexpected.slice(0, 3).join(" | "));

const fresh = buildFresh();
const L = objects(live.db), F = objects(fresh);

console.log("\n-- and a fresh database has everything a live one has --");
{
  const missing = [...L.keys()].filter((k) => !F.has(k));
  ck(`no tables or indexes missing from schema.sql (${L.size} expected)`,
    missing.length === 0, missing.slice(0, 8).join(", ") + (missing.length > 8 ? ` …+${missing.length - 8}` : ""));

  // THE OTHER DIRECTION CANNOT BE CHECKED HERE, and it is worth saying so
  // rather than writing an assertion that always passes.
  //
  // Something in schema.sql that no migration creates would be a table
  // customers do not have -- it would work in every test and fail for
  // everybody. But the live shape above is built BY APPLYING THE MIGRATIONS TO
  // schema.sql, because there is no migration 001: this file is the base. So
  // anything added here is in both sides by construction, and a comparison
  // would report clean whatever was put in.
  //
  // Catching that would need an independent record of the original schema,
  // which does not exist. What does catch it is the live database itself: a
  // route reading a table nobody ran a migration for fails there, loudly, and
  // CHECK.sql is how you find out which one.
}

console.log("\n-- column by column --");
{
  const bad = [];
  for (const [key, r] of L) {
    if (r.type !== "table") continue;
    const want = columns(live.db, r.name);
    const have = columns(fresh.db ? fresh.db : fresh, r.name);
    const gone = want.filter((c) => !have.includes(c));
    const extra = have.filter((c) => !want.includes(c));
    if (gone.length) bad.push(`${r.name} missing ${gone.join(",")}`);
    if (extra.length) bad.push(`${r.name} has unmigrated ${extra.join(",")}`);
  }
  ck("every table has the same columns in both", bad.length === 0,
    bad.slice(0, 6).join(" | ") + (bad.length > 6 ? ` …+${bad.length - 6}` : ""));
}

console.log("\n-- and CHECK.sql can be run against a fresh database --");
{
  // The point of CHECK.sql is to answer "did I run that one?" against the
  // schema itself. It could not be run at all on a fresh database, because the
  // invariants read columns schema.sql did not have -- so the one tool for
  // spotting this drift was disabled BY the drift.
  const sql = readFileSync(join(M, "CHECK.sql"), "utf8").replace(/;\s*$/, "");
  let row = null, err = "";
  try { row = fresh.prepare(sql).get(); } catch (e) { err = String(e.message); }
  ck("it runs", !!row, err);
  if (row) {
    // On an empty database every did-I-run-it count is 1 and every invariant
    // is 0. That is the shape a new environment should report.
    const zeroes = Object.entries(row).filter(([k, v]) => /_(unowned|without|others_with)$/.test(k) && v !== 0);
    ck("and every invariant reads zero on an empty database",
      zeroes.length === 0, JSON.stringify(zeroes));
    // m046_kind_check is a SHAPE, where 0 is the ordinary answer ("no CHECK on
    // accounts.kind", which is what 003 deliberately left). Everything else
    // reading 0 means a migration has not run.
    const notRun = Object.entries(row)
      .filter(([k, v]) => !/_(unowned|without|others_with|kind_check)$/.test(k) && v === 0)
      .map(([k]) => k);
    ck("and no migration reads as not-run", notRun.length === 0,
      notRun.slice(0, 8).join(", "));

    // Specifically: subdomain uniqueness, which 046's rebuild drops with the
    // table and has to put back. It used to be asked as "does an index with
    // this NAME exist", and schema.sql gets its uniqueness from the inline
    // UNIQUE on the column -- an autoindex with a NULL sql, invisible to a name
    // or LIKE test. So it read 0 on a perfectly good database, and 046 tells
    // somebody to check that number after rebuilding their accounts table.
    ck("subdomain uniqueness is seen however it is enforced",
      row.m046_subdomain_unique >= 1, String(row.m046_subdomain_unique));
  }
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
