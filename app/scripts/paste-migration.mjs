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
//   npm run paste check        every statement of CHECK.sql, numbered
//
// Comments are stripped whole-line only. Nothing here carries a trailing one,
// and a naive strip would eat the `--` inside a string if one ever did.

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { checkStatements, pasteForm } from "./lib/check-sql.mjs";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "worker", "migrations");

// One strip, shared with the reader module, because `schema-drift-test` proves
// that what this prints answers the same thing the file does -- and it can only
// prove that about the strip this actually uses.
const strip = pasteForm;

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
  console.error("Usage: npm run paste <number> [number...]   |   npm run paste check");
  process.exit(1);
}

// `check` PRINTS THE WHOLE FILE, NEVER ONE MIGRATION'S ENTRIES, and the
// difference is the one that was got wrong once. Pulling a single migration's
// check out means splitting the list on top-level commas, which means tracking
// paren depth -- and `m046_kind_check` compares against the string
// '%CHECK (kind IN%', whose unmatched bracket sends the count off by one for
// the rest of the file. The result printed every migration's check as one
// entry and answered "nothing found" for the one asked for. A check query that
// is subtly wrong is worse than none: it is the shape that reported 1,1,1,0,0
// over an `agreements` table missing fourteen columns.
//
// Running the whole file verifies every migration rather than one and is the
// single record of what to look for. What this adds is only that it comes out
// PASTEABLE: D1 refused the file three times on two different limits, so it is
// six statements run one at a time, and comment-stripped they are about forty
// lines each instead of a hundred and fifteen. Split by `checkStatements`,
// which is the reader every suite uses, so this cannot disagree with them
// about where one statement ends.
const printCheck = () => {
  const parts = checkStatements();
  parts.forEach((st, i) => {
    console.log(`-- ===== STATEMENT ${i + 1} of ${parts.length} -- run this on its own =====`);
    console.log(strip(st));
    console.log("");
  });
  console.log(`-- Read the first row of each. 'ok' means nothing to do.`);
};

if (args[0] === "check") {
  if (args.length > 1) {
    console.error("`npm run paste check` takes no number -- it prints the whole file.");
    process.exit(1);
  }
  printCheck();
  process.exit(0);
}

for (const n of args) {
  if (args.length > 1) console.log(`-- ===== ${fileFor(n)} =====`);
  console.log(strip(readFileSync(join(DIR, fileFor(n)), "utf8")));
  if (args.length > 1) console.log("");
}
