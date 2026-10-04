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
import { runCheck, checkSql, checkRows, checkStatements, D1_MAX_COLUMNS, D1_MAX_COMPOUND } from "./lib/check-sql.mjs";

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
  // THE FILE IS SIX STATEMENTS, so reading one of them is reading part of it.
  // The first version of this ran `prepare(checkSql())`, which takes only the
  // leading statement -- so the invariants went unchecked and the assertions
  // about them passed on an empty list.
  let row = null, err = "", width = 0, rows = [], parts = [];
  try {
    parts = checkRows(fresh);
    rows = parts.flat();
    width = Math.max(0, ...parts.map((p) => (p.length ? Object.keys(p[0]).length : 0)));
    row = runCheck(fresh);
  } catch (e) { err = String(e.message); }
  ck("it runs", !!row && Object.keys(row).length > 0, err);

  // AND IT IS NARROW ENOUGH FOR THE CONSOLE TO RETURN, which is the half this
  // suite could not see. D1 refuses a result set wider than 100 columns with
  // `too many columns in result set`; node:sqlite allows 2000. So this file was
  // one row of 110 columns, green here and DEAD in the console -- unrunnable
  // from migration 063, which took it from 100 to 102, and nobody found out
  // for five migrations because the only place it is ever really run is an
  // iPad. A guard that runs where nobody is looking is a guard that reports to
  // nobody, which this repository had just finished recording about five red
  // deploys.
  //
  // One row per check is two columns whatever gets added, so the assertion is
  // on the SHAPE and not on a count of entries -- the entries are meant to
  // grow without limit and a bound on them would come back.
  ck("and the console will return it", width > 0 && width <= D1_MAX_COLUMNS,
    `${width} columns, D1 allows ${D1_MAX_COLUMNS}`);

  // AND IT IS SHORT ENOUGH FOR THE OTHER LIMIT, which is the one the fix for
  // the first one walked straight into -- twice. D1 refused 110 UNION ALL
  // terms with `too many terms in compound SELECT`, so the did-I-run-it half
  // became a DATA list costing no terms at all; it then refused the 31 that
  // were left, which the note calling 31 safe had asserted on no evidence.
  //
  // So the real ceiling is below 31 and only the console can say where. The
  // bound here is deliberately far under the smallest number ever refused --
  // a generous bound is only generous against a limit somebody has measured,
  // and 60 was generous right up to the paste that failed.
  const terms = checkStatements().map((st) =>
    st.replace(/^\s*--.*$/gm, "").split(/\bUNION\s+ALL\b/i).length);
  ck("no statement is a long compound SELECT", Math.max(...terms) <= D1_MAX_COMPOUND,
    `terms per statement: ${JSON.stringify(terms)}`);
  // The half that grows costs nothing: 79 checks, one term.
  ck("and the did-I-run-it half costs one term however many there are",
    terms[0] === 1 && parts[0].length > 50,
    `${terms[0]} term(s) for ${parts[0]?.length} checks`);

  // AND THE SPLIT IS THE ONLY THING DIVIDING THE INVARIANT STATEMENTS. Each
  // carries its own copy of the verdict CASE, which is five records of one
  // rule -- the shape this repository keeps paying for. A statement whose
  // wrapper drifted would report a healthy database as broken, or a broken one
  // as healthy, for whichever handful of invariants happened to land in it.
  const wrappers = new Set(checkStatements().slice(1).map((st) =>
    st.slice(0, st.indexOf("FROM (")).replace(/^\s*--.*$/gm, "").replace(/\s+/g, " ").trim()));
  ck("and every invariant statement carries the same verdict rule",
    checkStatements().length > 2 && wrappers.size === 1,
    `${wrappers.size} distinct wrappers across ${checkStatements().length - 1} statements`);

  // AND THE VERDICT COLUMN AGREES WITH THE NUMBERS, which is the half a
  // reader cannot check for themselves. CHECK.sql computes 'ok' / 'NOT RUN' /
  // 'BROKEN ROWS' / 'RUN 046' from the naming convention, because a hundred
  // and ten numbers and a four-part rule is an answer that is present and not
  // legible on the device it is read from -- and the prose version of that
  // rule had already been wrong once.
  //
  // A verdict nothing checks is the shape this whole file is about, so:
  //
  //   EVERY ROW READS 'ok' on a fresh database, which is the same claim the
  //   two assertions below make about the raw numbers, read off the column
  //   somebody actually looks at.
  //
  //   AND THE INVARIANTS READ 'ok' AT ZERO, which is the only thing that
  //   proves the CASE is not just `value >= 1` for everything. There are 29
  //   such rows on a fresh database and the length is asserted, because
  //   `[].every(...)` is true -- a check over rows that have disappeared
  //   passes loudest exactly when the subject is gone.
  const notOk = rows.filter((r) => r.verdict !== "ok");
  ck("every row's verdict reads ok on a fresh database", notOk.length === 0,
    JSON.stringify(notOk.slice(0, 5)));
  const zeroes = rows.filter((r) => r.value === 0);
  ck("and a zero invariant is ok rather than not-run",
    zeroes.length > 10 && zeroes.every((r) => r.verdict === "ok"),
    `${zeroes.length} rows read 0: ${JSON.stringify(zeroes.filter((r) => r.verdict !== "ok").slice(0, 5))}`);
  if (row) {
    // On an empty database every did-I-run-it count is 1 and every invariant
    // is 0. That is the shape a new environment should report.
    //
    // WHAT THIS CANNOT PROVE, and a later pass must not read it as more:
    // every invariant reads zero here because there are no ROWS, so none of
    // their comparisons ever run. It checks that CHECK.sql PARSES and that a
    // fresh install is clean -- it cannot check that any invariant's query is
    // right. `m057_inv_drafted_after_finish` shipped comparing an ISO
    // timestamp against a CURRENT_TIMESTAMP one, read 8 on the live database
    // over perfectly ordinary rows, and passed here the whole time. An
    // invariant is only exercised by its own feature's suite seeding the
    // case; `photo-draft-test` does that for 057 by running this same file
    // against a database it has walked.
    const zeroes = Object.entries(row).filter(([k, v]) => /_(unowned|without|others_with)$/.test(k) && v !== 0);
    ck("and every invariant reads zero on an empty database",
      zeroes.length === 0, JSON.stringify(zeroes));
    // m046_kind_check is a SHAPE, where 0 is the ordinary answer ("no CHECK on
    // accounts.kind", which is what 003 deliberately left). Everything else
    // reading 0 means a migration has not run.
    // An invariant says so in its own name (`_inv_`), so adding one to
    // CHECK.sql cannot require remembering to edit this line -- which is
    // what it used to, and the first invariant added after this test was
    // written reported itself as an unrun migration. The three that predate
    // the marker are named here because they are run by hand and CLAUDE.md
    // names them; nothing new should join this list.
    const LEGACY_INVARIANTS = /_(unowned|without|others_with)$/;
    const notRun = Object.entries(row)
      .filter(([k, v]) => !k.includes("_inv_") && !LEGACY_INVARIANTS.test(k)
        && !/_kind_check$/.test(k) && v === 0)
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

console.log("\n-- and a problem sorts to the top --");
{
  // THE ORDERING IS THE WHOLE POINT OF THE VERDICT COLUMN and a clean database
  // cannot check it: every row reads 'ok', so any order satisfies "problems
  // first" vacuously -- deleting `ORDER BY verdict = 'ok'` passed every
  // assertion above. A hundred and ten rows with the one bad number at
  // position 74 is the answer being present and not legible, which is what
  // this column exists to fix, so it needs a database with something wrong
  // with it.
  //
  // `m039_unowned` is the cheapest one to break: `owner_account_id` is
  // nullable, so one property row with it NULL is a real invariant violation
  // of exactly the kind that read 1 on the live database once.
  const db = buildFresh();
  let rows = [], parts = [], err = "";
  try {
    db.exec(`INSERT INTO accounts (id, name, subdomain, kind)
               VALUES ('a_drift', 'Drift', 'drift', 'property_manager');
             INSERT INTO properties (id, account_id, name, owner_account_id)
               VALUES ('p_drift', 'a_drift', 'Unowned', NULL);`);
    parts = checkRows(db);
    rows = parts.flat();
  } catch (e) { err = String(e.message); }
  ck("a broken invariant is seen", rows.some((r) => r.name === "m039_unowned" && r.value === 1), err);
  ck("and it says BROKEN ROWS rather than NOT RUN",
    rows.find((r) => r.name === "m039_unowned")?.verdict === "BROKEN ROWS",
    JSON.stringify(rows.find((r) => r.name === "m039_unowned")));
  // The reader looks at the first row and nowhere else, so that is the
  // assertion: not "it is somewhere in the list sorted correctly", but that
  // the thing wrong with their database is the FIRST thing they see.
  // Problems sort to the top OF THEIR OWN STATEMENT -- the invariants are
  // spread over five of them, so the statement to read is the one this row
  // landed in rather than a position in the file. Hard-coding `parts[1]` would
  // have been right today and wrong the moment an invariant is added, which is
  // the same thing as not checking it.
  const inv = parts.find((p) => p.some((r) => r.name === "m039_unowned")) || [];
  ck("and it is the first row of the statement it is in", inv[0]?.name === "m039_unowned",
    `first row is ${inv[0]?.name}`);
  ck("and everything after the problems reads ok",
    inv.length > 1 && inv.slice(1).every((r) => r.verdict === "ok"),
    JSON.stringify(inv.slice(1).filter((r) => r.verdict !== "ok").slice(0, 3)));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
