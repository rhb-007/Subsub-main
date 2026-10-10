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

// THE FILE IS TWO STATEMENTS, so splitting it is part of reading it.
//
// D1 refused one row of 110 columns, then 110 rows via UNION ALL, then 31, then
// SEVEN. Every term in a compound SELECT is capped and the cap is below seven,
// so the only safe number of terms is NONE: both statements build a JSON array
// with `||` and read it back through `json_each`, which is the one shape D1 has
// ever been seen to accept -- at 79 entries, in statement 1.
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

// THE FORM SOMEBODY ACTUALLY PASTES: comment-stripped, which is forty lines a
// statement instead of a hundred and fifteen. The comments are the record of
// why each check exists and belong in the file; they are dead weight in a
// console on an iPad.
//
// It lives here rather than in `paste-migration.mjs` so the thing that gets
// pasted and the thing `schema-drift-test` proves answers identically are one
// function. Two copies would let the printed query drift from the checked one,
// which is the shape that reported 1,1,1,0,0 over an `agreements` table
// missing fourteen columns.
//
// Whole lines only. Nothing in CHECK.sql carries a trailing comment, and a
// naive strip would eat the `--` inside a string literal if one ever did.
export const pasteForm = (sql) => sql
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .map((l) => l.trimEnd())
  .join("\n")
  .replace(/\n{3,}/g, "\n\n")
  .trim();

// What the console would have refused. D1's ceiling is 100 columns in a result
// set; this file is two, and the assertion is on the SHAPE rather than on a
// count of entries, because the entries are meant to grow without limit.
export const D1_MAX_COLUMNS = 100;

// AND THE SECOND LIMIT, which the fix for the first one walked into three
// times: D1 refused 110 UNION ALL terms with `too many terms in compound
// SELECT`, then 31, then SEVEN. Nobody here has measured where it actually
// sits -- the console is the only place it can be, and each measurement costs
// a round trip to the person holding the iPad.
//
// So this is ZERO, which is not a bound somebody tuned: it is the statement
// that no part of this file may use a compound SELECT at all. Every number
// above zero has been a guess, and two of the three were wrong. 60 was
// "generous" right up to the paste that failed at 31, and 10 right up to the
// one that failed at 7.
export const D1_MAX_COMPOUND = 0;

// ONE entry's expression, by name.
//
// Two suites want a single check on its own rather than the whole file --
// `propscope-test` runs 054's invariant against a seeded database and
// `sub-signup-test` runs 046's tri-state probe against three hand-written
// `accounts` DDLs, neither of which is a migrated database the whole file
// could be run against. Both used to find it with a regex ending in `AS
// m054_...`, which the row rewrite broke, and then with `SELECT '<name>' AS
// name,`, which the json rewrite broke. That is three records of this file's
// shape living in a test, which is what this module exists to stop, so it is
// one function and a rewrite costs one edit here.
//
// The scan skips strings and comments for the reason every scanner over this
// file has to: a comment in it carries a comma AND a semicolon, and
// `m046_kind_check`'s own literal carries an unmatched paren.
export function checkExpr(name) {
  const sql = checkSql();
  const head = `json_array('${name}', `;
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
    // The close paren of `json_array(` itself, which is where the value ends.
    if (c === ")") { if (depth === 0) break; depth--; }
  }
  return sql.slice(at + head.length, i).trim();
}

// AND THE THIRD LIMIT, found by the paste after 077: `Expression tree is too
// large (maximum depth 100)`. Both statements build their JSON by joining
// pieces with `||`, and a chain of n joins is a tree n deep -- so the list
// that was meant to grow without limit grew into this one, at 84 entries in
// statement 1 and 33 invariants in statement 2. Local SQLite allows 1000, so
// only the console could see it, which is the story of every limit here.
//
// The fix is grouping, not a smaller list: the pieces are joined in
// parenthesised chunks, so the depth is about one chunk plus the number of
// chunks rather than the length of the list. This is an UPPER BOUND on what
// the `||` chains contribute -- per group, the joins in it plus its deepest
// child -- skipping strings and comments for the reason every scanner over
// this file has to.
export const D1_MAX_EXPR_DEPTH = 100;
export function concatDepth(sql) {
  const stack = [{ ops: 0, child: 0 }];
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (c === "'") { i++; while (i < sql.length && !(sql[i] === "'" && sql[i + 1] !== "'")) { if (sql[i] === "'") i++; i++; } continue; }
    if (c === "-" && sql[i + 1] === "-") { while (i < sql.length && sql[i] !== "\n") i++; continue; }
    if (c === "/" && sql[i + 1] === "*") { i = sql.indexOf("*/", i + 2); if (i < 0) break; i++; continue; }
    if (c === "(") stack.push({ ops: 0, child: 0 });
    else if (c === ")" && stack.length > 1) {
      const g = stack.pop();
      const top = stack[stack.length - 1];
      top.child = Math.max(top.child, g.ops + g.child + 1);
    } else if (c === "|" && sql[i + 1] === "|") { stack[stack.length - 1].ops++; i++; }
  }
  return stack[0].ops + stack[0].child;
}
