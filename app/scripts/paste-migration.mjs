// Print a migration as paste-ready SQL.
//
// Migrations here are applied BY HAND in the D1 console, from a browser on an
// iPad. The files are heavily commented -- that is deliberate and the comments
// are the record of why each column exists -- but a hundred lines of prose is
// a hundred lines to scroll past when what somebody needs is the statements.
//
// SO IT IS GENERATED, NEVER A SECOND FILE. Writing the stripped SQL to disk
// beside the real migration is two records of one fact, and the stale one is
// the one that gets pasted into a production database. That is not a
// hypothetical: the SQL for 052 was once typed from memory instead of read
// from the file, and the table it created was missing fourteen columns and
// carried five that do not exist. It passed a check that only asked whether
// the table existed.
//
//   npm run paste 053          one migration
//   npm run paste 052 053      several, in order
//   npm run paste check 052    the did-I-run-it query for one or more
//
// Comments are stripped whole-line only. Nothing here carries a trailing one,
// and a naive strip would eat the `--` inside a string if one ever did.

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "worker", "migrations");

const strip = (sql) => sql
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .map((l) => l.trimEnd())
  .join("\n")
  .replace(/\n{3,}/g, "\n\n")
  .trim();

const fileFor = (n) => {
  const want = String(n).padStart(3, "0");
  const hit = readdirSync(DIR).find((f) => f.startsWith(`${want}_`) && f.endsWith(".sql"));
  if (!hit) {
    console.error(`No migration ${want}. Have: ${readdirSync(DIR).filter((f) => /^\d/.test(f)).join(", ")}`);
    process.exit(1);
  }
  return hit;
};

const args = process.argv.slice(2);
if (!args.length) {
  console.error("Usage: npm run paste <number> [number...]   |   npm run paste check <number> [number...]");
  process.exit(1);
}

// The check query lives in CHECK.sql, which is the one record of what to run
// afterwards. Pulled out by the migration number its lines are named for, so
// it cannot drift from the invariants that file actually carries.
// NO `check` SUB-COMMAND, and the attempt at one is worth recording. Pulling
// a migration's entries out of CHECK.sql means splitting on top-level commas,
// which means tracking paren depth -- and `m046_kind_check` compares against
// the string '%CHECK (kind IN%', whose unmatched bracket sends the depth
// count off by one for the rest of the file. The result was one giant entry
// that printed every migration's check and answered "nothing found" for the
// one actually asked for.
//
// A check query that is subtly wrong is worse than none: it is the shape that
// reported 1,1,1,0,0 over an `agreements` table missing fourteen columns. So
// run the whole of CHECK.sql, which verifies every migration rather than one
// and is the single record of what to look for.

for (const n of args) {
  if (args.length > 1) console.log(`-- ===== ${fileFor(n)} =====`);
  console.log(strip(readFileSync(join(DIR, fileFor(n)), "utf8")));
  if (args.length > 1) console.log("");
}
