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

// `{ m018_user_notify: 1, ... }`.
export function runCheck(db) {
  const rows = db.prepare(checkSql()).all();
  return Object.fromEntries(rows.map((r) => [r.name, r.value]));
}

// What the console would have refused. D1's ceiling is 100 columns in a result
// set; this file is two, and the assertion is on the SHAPE rather than on a
// count of entries, because the entries are meant to grow without limit.
export const D1_MAX_COLUMNS = 100;

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
