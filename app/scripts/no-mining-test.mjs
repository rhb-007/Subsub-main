// SubSub is not a directory, and one lookup must not become one.
//
// The product is for running the subcontractors you already have and adding
// the ones you meet. Nobody browses here for a roofer. So the one place an
// account can ask about a company it has no relationship with -- the connect
// lookup, which exists to stop you inviting somebody who already has an
// account -- is the place to hold the line.
//
// Four things are asserted, and the first three were already true:
//
//   whole values only. No prefix, no partial, no LIKE. A prefix search is a
//   directory somebody walks one letter at a time.
//
//   rate limited per account, because even whole-value matching is a
//   confirm-and-enrich oracle for somebody holding a list of addresses.
//
//   signed in, and admin or project manager.
//
//   and the answer describes the MATCH, not the company: which company it
//   is, so you ask the right one -- not their staff's names and not their
//   licence number. That one was not true. Every match carried contact and
//   license, and nothing in the app has ever read license.
//
//   node scripts/no-mining-test.mjs

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const worker = readFileSync(join(app, "worker", "index.js"), "utf8");
const ui = readFileSync(join(app, "src", "App.tsx"), "utf8");

// ---- nothing walks the table ------------------------------------------
console.log("\n-- no query turns the roster into a directory --");
{
  // Every read of `companies` that is not pinned to one row, one whole
  // value, or one account's engagements. A new one has to be looked at.
  const reads = [...worker.matchAll(/FROM companies[^;`]*/gi)].map((m) => m[0].replace(/\s+/g, " ").trim());
  ck("there are reads to check", reads.length > 5, String(reads.length));

  const loose = reads.filter((q) => /\bLIKE\b/i.test(q));
  ck("no LIKE against companies anywhere", loose.length === 0, loose.join(" | "));

  // ORDER BY over the whole table is the shape of a listing. One exists and
  // it is staff-only; anything else is new and wants a decision.
  const listings = reads.filter((q) => /FROM companies\s+co\s+ORDER BY/i.test(q));
  ck("exactly one listing of every company", listings.length === 1, listings.join(" | "));
  const before = worker.slice(0, worker.indexOf(listings[0]));
  const route = before.lastIndexOf("app.get(");
  ck("and it is a staff route",
    /\/api\/platform\//.test(worker.slice(route, route + 120)), worker.slice(route, route + 60).trim());
  ck("gated by requireStaff",
    /requireStaff/.test(worker.slice(route, worker.indexOf(listings[0]))), "no requireStaff before it");
}

// ---- the lookup itself -------------------------------------------------
console.log("\n-- the one cross-account question, and its guards --");
{
  const i = worker.indexOf('app.get("/api/connect/lookup"');
  ck("the lookup is there", i > 0);
  const body = worker.slice(i, worker.indexOf("\napp.", i + 10));

  ck("signed in, admin or project manager only",
    /requireRole\("admin", "pm"\)/.test(worker.slice(i, i + 120)), worker.slice(i, i + 80));
  ck("rate limited", /rateLimit\(/.test(body));
  ck("per account, not per IP", /rateLimit\(c\.env, "connect-lookup", accountId/.test(body));
  ck("matched on a whole email", /lower\(email\) = \?/.test(body));
  ck("a whole licence", /UPPER\(TRIM\(license\)\) = \?/.test(body));
  ck("a whole normalised phone", /WHERE phone = \?/.test(body));
  ck("nothing partial", !/LIKE|%/.test(body.replace(/\/\/.*$/gm, "")), "a LIKE or % crept in");
  ck("it refuses to answer about you", /isOwnCompany/.test(body));
  ck("and about a company nobody can answer for", /companyHasLogin/.test(body));
  ck("it needs something to look up", /nothing_to_look_up/.test(body));
}

// ---- what a stranger's match says -------------------------------------
console.log("\n-- and what one match is allowed to tell you --");
{
  const i = worker.indexOf("const connectMatchToJs");
  const shape = worker.slice(i, worker.indexOf("});", i) + 3);
  ck("a match names the company", /company: co\.company/.test(shape));
  ck("and roughly where they are", /co\.city, co\.state/.test(shape));

  // The two that were going out about strangers.
  ck("a licence number is not sent at all", !/license/.test(shape), shape.replace(/\s+/g, " "));
  ck("a contact's name only for somebody you know",
    /contact: \(full \|\| engaged\)/.test(shape), shape.replace(/\s+/g, " "));

  // Nothing read the licence, which is why dropping it costs nothing.
  ck("and nothing in the app was reading it",
    !/match\.license/.test(ui), "match.license is referenced in App.tsx");

  // The code path is the exception, and on purpose: somebody handed it to
  // you, which is them choosing to say who they are.
  const codeRoute = worker.slice(worker.indexOf('app.get("/api/connect/code/:code"'));
  ck("a code shown in person may say more",
    /full: true/.test(codeRoute.slice(0, codeRoute.indexOf("\napp."))), "the code path lost its detail");
}

// ---- the name box is local only ---------------------------------------
console.log("\n-- a typed company name never leaves the browser --");
{
  ck("no endpoint takes a company name to look up",
    !/q\.company\b|query\(\)\.company\b/.test(worker), "something accepts a company name");
  const i = ui.indexOf("const nameHits");
  const block = ui.slice(i, ui.indexOf("}, [nameTyped", i));
  ck("the name match reads state already loaded", /subs \|\| \[\]/.test(block) && /invites \|\| \[\]/.test(block),
    block.replace(/\s+/g, " ").slice(0, 120));
  ck("and calls nothing", !/api\./.test(block), block.replace(/\s+/g, " ").slice(0, 120));
}

// ---- and it is written down -------------------------------------------
console.log("\n-- the rule is written down, not just remembered --");
{
  let doc = "";
  try { doc = readFileSync(join(app, "..", "CLAUDE.md"), "utf8"); } catch { /* reported below */ }
  ck("CLAUDE.md exists", doc.length > 0);
  ck("it says what the product is not", /not a discovery engine|not a .*directory/i.test(doc));
  ck("it states the no-mining rule", /may not mine|no account may mine/i.test(doc));
  ck("it says whole values only", /whole values only/i.test(doc));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
