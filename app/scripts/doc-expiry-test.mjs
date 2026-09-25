// Documents that stay current, and the three ways that quietly fails.
//
// "Compliant" meant a file exists. An expired certificate of insurance that
// still reads as approved is worse than a missing one: a missing one makes
// somebody ask, an expired one makes everybody stop asking. So the question
// is not whether there is a file but what it says and how long that stays
// true.
//
// Three things asserted here, all of which are easy to get wrong in ways
// nobody notices until a claim:
//
//   NULL IS NOT UNKNOWN. A W-9 and a signed contract do not expire. If a
//   missing date meant "we don't know", two thirds of every roster sits
//   permanently amber and people learn to ignore the colour -- which is the
//   exact failure this feature exists to prevent.
//
//   THE DATE THAT MATTERS IS THE JOB'S. A certificate current today and
//   expiring Friday does not cover work booked for the Tuesday after, and
//   the moment to say so is while somebody is assigning it.
//
//   AN EXPIRY UNDER BOOKED WORK IS CHASED, NOT BLOCKED. Stranding scheduled
//   work over paperwork helps nobody, so it raises the urgent chase rather
//   than cancelling the job.
//
//   node --no-warnings scripts/doc-expiry-test.mjs

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { docStatus, companyDocStatus, coversJob, dueReminder, docStatusText,
         addDaysIso, daysBetween, DOC_KINDS, EXPIRING_KINDS, CHASE_AT, WARN_DAYS } from "../shared/docs.js";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const TODAY = "2026-09-25";
const file = (expiresOn) => ({ fileName: "doc.pdf", expiresOn });

console.log("\n-- one document --");
{
  ck("nothing uploaded is missing", docStatus(null, TODAY).state === "missing");
  ck("a row with no file is still missing", docStatus({ expiresOn: "2027-01-01" }, TODAY).state === "missing");
  ck("in force with room is current", docStatus(file("2027-01-01"), TODAY).state === "current");
  ck("lapsed is expired", docStatus(file("2026-09-24"), TODAY).state === "expired");
  ck("and says how long ago", docStatus(file("2026-09-18"), TODAY).days === -7,
    String(docStatus(file("2026-09-18"), TODAY).days));
  ck("today is not yet expired", docStatus(file(TODAY), TODAY).state === "expiring");
  ck("thirty days out is expiring", docStatus(file(addDaysIso(TODAY, 30)), TODAY).state === "expiring");
  ck("thirty-one is not", docStatus(file(addDaysIso(TODAY, 31)), TODAY).state === "current");
  ck("the boundary is the documented one", WARN_DAYS === 30);
}

console.log("\n-- and a blank date means it does not expire --");
{
  // The one that would put every roster permanently amber.
  const s = docStatus({ fileName: "w9.pdf" }, TODAY);
  ck("no date is current, not unknown", s.state === "current", JSON.stringify(s));
  ck("and says so", s.neverExpires === true);
  ck("a contract and a W-9 are the kinds that do not expire",
    !EXPIRING_KINDS.includes("contract") && !EXPIRING_KINDS.includes("w9"), EXPIRING_KINDS.join(","));
  ck("insurance and bond are the ones that do",
    EXPIRING_KINDS.includes("insurance") && EXPIRING_KINDS.includes("bond"));
}

console.log("\n-- a whole company --");
{
  const good = { insurance: file("2027-01-01"), bond: file("2027-06-01"),
    contract: { fileName: "c.pdf" }, w9: { fileName: "w.pdf" } };
  let s = companyDocStatus(good, TODAY);
  ck("all four in order is current", s.state === "current" && s.ok, JSON.stringify(s.state));
  ck("and assignable", s.assignable);

  s = companyDocStatus({ ...good, insurance: file(addDaysIso(TODAY, 10)) }, TODAY);
  ck("one expiring makes the company expiring", s.state === "expiring", s.state);
  // A warning, not a bar. Refusing to book somebody whose certificate runs
  // out in three weeks would stop a business working.
  ck("but still assignable", s.assignable === true);
  ck("and names which one", s.problems.join(",") === "insurance", s.problems.join(","));

  s = companyDocStatus({ ...good, insurance: file("2026-09-01") }, TODAY);
  ck("one expired makes the company expired", s.state === "expired", s.state);
  ck("and not assignable", s.assignable === false);

  s = companyDocStatus({ ...good, w9: null }, TODAY);
  ck("missing outranks everything", s.state === "missing", s.state);
  ck("the soonest date is the soonest", companyDocStatus(good, TODAY).soonest === "2027-01-01",
    String(companyDocStatus(good, TODAY).soonest));
}

console.log("\n-- the date that matters is the job's, not today's --");
{
  // Current today, gone by the job. This is the case a roster colour cannot
  // show and the only moment anybody can act on it.
  const docs = { insurance: file("2026-10-10"), bond: file("2027-01-01"),
    contract: { fileName: "c.pdf" }, w9: { fileName: "w.pdf" } };
  ck("fine for a job next week", coversJob(docs, "2026-10-01").ok);
  const later = coversJob(docs, "2026-11-01");
  ck("not fine for one after it lapses", !later.ok, JSON.stringify(later));
  ck("and it names what lapses", later.lapsing.join(",") === "insurance", later.lapsing.join(","));
  ck("today's roster would have said assignable",
    companyDocStatus(docs, TODAY).assignable === true, "the roster is not the answer");
}

console.log("\n-- chasing, without sending the same warning for thirty nights --");
{
  const doc = file("2026-10-25");   // thirty days out
  ck("thirty days out, the thirty-day chase", dueReminder({ doc, asOf: TODAY }) === 30,
    String(dueReminder({ doc, asOf: TODAY })));
  ck("already sent, nothing due", dueReminder({ doc, asOf: TODAY, alreadySent: [30] }) === null);
  ck("fourteen out, the fourteen", dueReminder({ doc, asOf: "2026-10-11", alreadySent: [30] }) === 14,
    String(dueReminder({ doc, asOf: "2026-10-11", alreadySent: [30] })));
  ck("three out, the three", dueReminder({ doc, asOf: "2026-10-22", alreadySent: [30, 14] }) === 3);
  ck("on the day, the last one", dueReminder({ doc, asOf: "2026-10-25", alreadySent: [30, 14, 3] }) === 0);
  ck("all sent, nothing more", dueReminder({ doc, asOf: "2026-10-25", alreadySent: [30, 14, 3, 0] }) === null);
  ck("forty days out, nothing yet", dueReminder({ doc, asOf: "2026-09-15" }) === null);
  ck("a document that never expires is never chased",
    dueReminder({ doc: { fileName: "w9.pdf" }, asOf: TODAY }) === null);
  ck("the milestones are the documented ones", CHASE_AT.join(",") === "30,14,3,0", CHASE_AT.join(","));

  // Missing a window entirely -- a sweep that did not run for a week -- must
  // still send the closest one rather than nothing.
  ck("a missed window still chases",
    dueReminder({ doc, asOf: "2026-10-20", alreadySent: [30] }) === 14,
    String(dueReminder({ doc, asOf: "2026-10-20", alreadySent: [30] })));
}

console.log("\n-- lapsed under booked work is chased, never blocked --");
{
  const doc = file("2026-09-20");   // already gone
  ck("with nothing booked, the ordinary last chase",
    dueReminder({ doc, asOf: TODAY }) === 0, String(dueReminder({ doc, asOf: TODAY })));
  ck("with work booked, the urgent one",
    dueReminder({ doc, asOf: TODAY, hasBookedWork: true }) === -1,
    String(dueReminder({ doc, asOf: TODAY, hasBookedWork: true })));
  ck("and it is not sent twice",
    dueReminder({ doc, asOf: TODAY, hasBookedWork: true, alreadySent: [-1] }) === null);
  // The decision, asserted: nothing here cancels or blocks anything.
  const src = readFileSync(join(app, "shared/docs.js"), "utf8");
  ck("nothing in here blocks a booked job",
    !/cancel|unassign|block/i.test(src.replace(/^\s*\/\/.*$/gm, "")), "something blocks");
}

console.log("\n-- in words --");
{
  ck("missing", /has not been uploaded/.test(docStatusText("insurance", docStatus(null, TODAY))));
  ck("expired, with how long ago",
    /expired 7 days ago/.test(docStatusText("bond", docStatus(file("2026-09-18"), TODAY))),
    docStatusText("bond", docStatus(file("2026-09-18"), TODAY)));
  ck("expiring, with how long left",
    /expires in 10 days/.test(docStatusText("insurance", docStatus(file(addDaysIso(TODAY, 10)), TODAY))));
  ck("today reads as today",
    /expires today/.test(docStatusText("insurance", docStatus(file(TODAY), TODAY))));
  ck("one day is singular",
    /in 1 day\./.test(docStatusText("insurance", docStatus(file(addDaysIso(TODAY, 1)), TODAY))),
    docStatusText("insurance", docStatus(file(addDaysIso(TODAY, 1)), TODAY)));
}

console.log("\n-- dates, without a timezone anywhere near them --");
{
  ck("a day is a day across a month", daysBetween("2026-09-25", "2026-10-25") === 30);
  ck("and across a year", daysBetween("2026-12-31", "2027-01-01") === 1);
  ck("and backwards", daysBetween("2026-10-01", "2026-09-25") === -6);
  ck("leap day is a day", daysBetween("2028-02-28", "2028-03-01") === 2);
  ck("adding crosses a month", addDaysIso("2026-09-25", 10) === "2026-10-05");
  ck("and a year", addDaysIso("2026-12-25", 10) === "2027-01-04");
  // No Date parsing of a bare day, which is the timezone bug this avoids.
  const src = readFileSync(join(app, "shared/docs.js"), "utf8");
  ck("no local-time Date parsing", !/new Date\((?!\s*t\b)/.test(src.replace(/Date\.UTC/g, "")),
    "a bare Date() crept in");
}

console.log("\n-- and the schema holds what the code needs --");
{
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE companies(id TEXT PRIMARY KEY);CREATE TABLE users(id TEXT PRIMARY KEY);`);
  db.exec(readFileSync(join(app, "worker/migrations/037_document_detail.sql"), "utf8"));
  ck("037 applies", true);
  ck("and is repeatable", (() => {
    try { db.exec(readFileSync(join(app, "worker/migrations/037_document_detail.sql"), "utf8")); return true; }
    catch { return false; }
  })());

  db.exec(`INSERT INTO companies(id) VALUES ('c1')`);
  const ins = (id, kind) => db.exec(
    `INSERT INTO company_docs(id, company_id, kind, file_name, issuer, policy_no, coverage_cents, expires_on)
     VALUES ('${id}','c1','${kind}','coi.pdf','State National','NXT9-01',100000000,'2027-01-01')`);
  for (const k of DOC_KINDS) ins(`d_${k}`, k);
  ck("every kind the code knows is a kind the table takes", true);
  let bad = null;
  try { ins("d_bad", "licence"); } catch (e) { bad = e.message; }
  ck("and one it does not is refused", /CHECK/i.test(String(bad)), String(bad).slice(0, 44));

  const row = db.prepare(`SELECT * FROM company_docs WHERE id='d_insurance'`).get();
  ck("carrier is kept", row.issuer === "State National", String(row.issuer));
  ck("policy number is kept", row.policy_no === "NXT9-01", String(row.policy_no));
  ck("coverage is whole cents", row.coverage_cents === 100000000, String(row.coverage_cents));
  ck("and so is the expiry", row.expires_on === "2027-01-01", String(row.expires_on));

  // History, which is the reason this is a table.
  db.exec(`UPDATE company_docs SET superseded_at = CURRENT_TIMESTAMP WHERE id='d_insurance'`);
  ins("d_ins2", "insurance");
  ck("an old certificate is superseded, not deleted",
    db.prepare(`SELECT COUNT(*) n FROM company_docs WHERE kind='insurance'`).get().n === 2);
  ck("and the current one is the one nothing replaced",
    db.prepare(`SELECT id FROM company_docs WHERE kind='insurance' AND superseded_at IS NULL`).get().id === "d_ins2");

  // A chase is sent once.
  db.exec(`INSERT INTO doc_reminders(id, company_doc_id, company_id, days_out) VALUES ('r1','d_ins2','c1',30)`);
  let dupe = null;
  try { db.exec(`INSERT INTO doc_reminders(id, company_doc_id, company_id, days_out) VALUES ('r2','d_ins2','c1',30)`); }
  catch (e) { dupe = e.message; }
  ck("the same chase cannot be sent twice", /UNIQUE/i.test(String(dupe)), String(dupe).slice(0, 44));
  db.exec(`INSERT INTO doc_reminders(id, company_doc_id, company_id, days_out) VALUES ('r3','d_ins2','c1',14)`);
  ck("but the next one can", db.prepare(`SELECT COUNT(*) n FROM doc_reminders`).get().n === 2);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
