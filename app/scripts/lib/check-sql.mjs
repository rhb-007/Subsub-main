// CHECK.sql, read and run.
//
// WHY A HELPER RATHER THAN `db.prepare(CHECK).get().m0xx`, which is what six
// suites used to do: that file is ONE ROW PER CHECK now, not one row of 110
// columns, because D1 refuses a result set wider than 100 columns and the file
// crossed that line at migration 063 -- unrunnable in the console for five
// migrations while `schema-drift-test` stayed green, local SQLite allowing
// 2000 columns where D1 allows 100.
//
// Every reader wants the same thing it always wanted: an object keyed by the
// check's name. So that lives here once rather than six times, and the shape a
// later change has to keep is this function's, not the file's.
import { readFileSync } from "node:fs";

// The statement's `;` is not at end of file -- a note about why 064 has no
// invariant sits after it -- and the terminator cannot be found with
// `indexOf(";")` because a COMMENT in this file contains one. SQLite stops at
// the semicolon by itself, so the whole text is handed over as-is.
export const checkSql = () =>
  readFileSync(new URL("../../worker/migrations/CHECK.sql", import.meta.url), "utf8");

// THE FILE IS SIX STATEMENTS NOW, so splitting it is part of reading it.
//
// D1 refused one row of 110 columns, then refused 110 rows via UNION ALL --
// every term in a compound SELECT is capped too, which the note claiming rows
// "have no ceiling" simply had wrong -- and then refused 31 of them, which the
// note claiming 31 "accepts this" had wrong in exactly the same way. So the
// half that grows is a data list costing no terms at all, and the invariants
// are split across five statements of seven terms and under.
//
// Split on a semicolon at depth zero, skipping strings and comments, for the
// same reason `checkExpr` does: a comment in this file carries a semicolon,
// and `m046_kind_check` compares against a literal holding an unmatched paren.
export function checkStatements() {
  const sql = checkSql();
  const out = [];
  let start = 0, depth = 0;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (c === "'") {
      let j = i + 1;
      for (; j < sql.length; j++) {
        if (sql[j] !== "'") continue;
        if (sql[j + 1] === "'") { j++; continue; }
        break;
      }
      i = j; continue;
    }
    if (c === "-" && sql[i + 1] === "-") {
      const nl = sql.indexOf("\n", i);
      i = (nl === -1 ? sql.length : nl) - 1; continue;
    }
    if (c === "(") { depth++; continue; }
    if (c === ")") { depth--; continue; }
    if (c === ";" && depth === 0) { out.push(sql.slice(start, i + 1)); start = i + 1; }
  }
  // A trailing chunk with no statement in it is the note after the last
  // semicolon, which is prose rather than SQL.
  return out.filter((x) => /\bSELECT\b/i.test(x));
}

// Every row of every statement, in the order the console would show them --
// which the ordering assertions need and `runCheck`'s object cannot carry.
export function checkRows(db) {
  return checkStatements().map((st) => db.prepare(st).all());
}

// `{ m018_user_notify: 1, ... }`, across both statements. Every caller wanted
// this shape before the file was split and still does, which is the whole
// reason this module exists.
export function runCheck(db) {
  const out = {};
  for (const st of checkStatements()) {
    for (const r of db.prepare(st).all()) out[r.name] = r.value;
  }
  return out;
}

// What the console would have refused. D1's ceiling is 100 columns in a result
// set; this file is two, and the assertion is on the SHAPE rather than on a
// count of entries, because the entries are meant to grow without limit.
export const D1_MAX_COLUMNS = 100;

// AND THE SECOND LIMIT, which the fix for the first one walked into: D1
// refused 110 UNION ALL terms with `too many terms in compound SELECT`, and
// then refused 31. So the real ceiling is somewhere BELOW 31 and nobody here
// knows where -- the console is the only place it can be measured, and each
// measurement costs a round trip to the person holding the iPad.
//
// This is therefore a bound no statement should approach rather than a figure
// read off a spec: ten is comfortably under the smallest number ever refused,
// and the file sits at seven. It was 60 while 31 was believed to be fine,
// which is exactly how 31 shipped unchecked -- a generous bound is only
// generous against a limit somebody has measured.
export const D1_MAX_COMPOUND = 10;

// ONE entry's expression, by name.
//
// Two suites want a single check on its own rather than the whole file --
// `propscope-test` runs 054's invariant against a seeded database and
// `sub-signup-test` runs 046's tri-state probe against three hand-written
// `accounts` DDLs, neither of which is a migrated database the whole file
// could be run against. Both used to find it with a regex ending in `AS
// m054_...`, so the row rewrite broke them: the alias is `AS value` now and
// the name is a string literal. That is two more records of this file's shape,
// which is what this module exists to stop, so it is one function.
//
// The scan skips strings and comments for the reason the converter had to: a
// comment in this file carries a comma AND a semicolon, and
// `m046_kind_check`'s own literal carries an unmatched paren.
export function checkExpr(name) {
  const sql = checkSql();
  const head = `SELECT '${name}' AS name,`;
  const at = sql.indexOf(head);
  if (at === -1) throw new Error(`no check named ${name} in CHECK.sql`);
  let i = at + head.length, depth = 0;
  for (; i < sql.length; i++) {
    const c = sql[i];
    if (c === "'") {
      let j = i + 1;
      for (; j < sql.length; j++) {
        if (sql[j] !== "'") continue;
        if (sql[j + 1] === "'") { j++; continue; }
        break;
      }
      i = j; continue;
    }
    if (c === "-" && sql[i + 1] === "-") {
      const nl = sql.indexOf("\n", i);
      i = (nl === -1 ? sql.length : nl) - 1; continue;
    }
    if (c === "(") { depth++; continue; }
    if (c === ")") { depth--; continue; }
    if (depth === 0 && sql.startsWith("AS value", i)) break;
  }
  return sql.slice(at + head.length, i).trim();
}
