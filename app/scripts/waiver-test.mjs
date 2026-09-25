// The waiver chain, and the two things about it that are easy to get wrong.
//
// A waiver binds only the party that signs it. A signed waiver from Cascade
// Roofworks does nothing about the supply house Cascade still owes, and that
// supplier can lien the owner's building. So the useful object is the chain,
// not the document -- and a chain has two properties that trip people up.
//
// IT IS CLEAR THROUGH A DATE, never just clear. Material delivered the
// morning after a waiver is not covered by it, so the chain re-opens as work
// continues and a green tick with no date against it is a lie waiting to
// happen.
//
// IT ROLLS UP AS A STATUS, NOT A ROSTER. A general contractor may know their
// subcontractor's chain is clear. They may not have the subcontractor's
// supplier list -- that is the subcontractor's sources and, by inference,
// their margins, and handing it over is exactly the mining this product does
// not do. So the roll-up counts and dates and never names, and that is
// asserted here rather than left to whoever writes the screen.
//
// And often there is no chain at all: the general contractor buys the
// supplies and the subcontractor is labour. That is a declaration somebody
// signs, not an absence nobody recorded.
//
//   node --no-warnings scripts/waiver-test.mjs

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { chainStatus, needsLowerTier, waiverKindFor, chainReasonText,
         WAIVER_KINDS, SCOPE_KINDS } from "../shared/waivers.js";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const signed = (through, extra = {}) => ({ status: "signed", throughDate: through, ...extra });

console.log("\n-- labour only, which is most of the time --");
{
  const s = chainStatus({ root: signed("2026-09-20", { scopeKind: "labor_only" }),
    children: [], asOf: "2026-09-20", scopeKind: "labor_only" });
  ck("clear with nobody below them", s.clear, JSON.stringify(s));
  ck("and says so, so the screen need not guess", s.laborOnly === true);
  ck("nothing below is asked for", needsLowerTier("labor_only") === false);
  // The case that makes "labour only" safe rather than merely convenient.
  ck("but a declared party still counts", needsLowerTier("labor_only", 1) === true);
  const sub = chainStatus({ root: signed("2026-09-20"), children: [], asOf: "2026-09-20",
    scopeKind: "labor_only", declaredCount: 1 });
  ck("a labour-only sub who subbed some out is not clear",
    !sub.clear && sub.reasons.includes("not_requested"), JSON.stringify(sub.reasons));
}

console.log("\n-- through a date, never just clear --");
{
  const root = signed("2026-09-20", { scopeKind: "labor_only" });
  ck("covered on the day", chainStatus({ root, asOf: "2026-09-20", scopeKind: "labor_only" }).clear);
  ck("covered before it", chainStatus({ root, asOf: "2026-09-19", scopeKind: "labor_only" }).clear);
  const after = chainStatus({ root, asOf: "2026-09-21", scopeKind: "labor_only" });
  ck("not covered the next morning", !after.clear, JSON.stringify(after.reasons));
  ck("and the reason is that it is stale, not missing",
    after.reasons.includes("stale"), JSON.stringify(after.reasons));

  // The chain is only as good as its shortest link.
  const s = chainStatus({ root: signed("2026-09-25"), children: [signed("2026-09-18")],
    asOf: "2026-09-18", scopeKind: "labor_materials", declaredCount: 1 });
  ck("the chain covers only as far as its earliest link",
    s.clear && s.through === "2026-09-18", JSON.stringify(s));
}

console.log("\n-- a chain with people on it --");
{
  const base = { root: signed("2026-09-20"), asOf: "2026-09-20", scopeKind: "labor_materials" };
  ck("three of three signed is clear",
    chainStatus({ ...base, children: [signed("2026-09-20"), signed("2026-09-21"), signed("2026-09-20")],
      declaredCount: 3 }).clear);

  const one = chainStatus({ ...base, children: [signed("2026-09-20"), { status: "requested", throughDate: "2026-09-20" }],
    declaredCount: 2 });
  ck("one outstanding is not", !one.clear && one.reasons.includes("lower_tier_outstanding"),
    JSON.stringify(one.reasons));
  ck("and the count is honest", one.lowerTierSigned === 1 && one.lowerTierTotal === 2, JSON.stringify(one));

  const dec = chainStatus({ ...base, children: [{ status: "declined", throughDate: "2026-09-20" }], declaredCount: 1 });
  ck("declined is its own answer", dec.reasons.includes("lower_tier_declined"), JSON.stringify(dec.reasons));

  // Named but never asked is different from asked and not answered.
  const notAsked = chainStatus({ ...base, children: [], declaredCount: 2 });
  ck("named but never asked says so", notAsked.reasons.includes("not_requested"), JSON.stringify(notAsked.reasons));

  // And nobody named at all, on a job with materials, is a question that was
  // never put -- not a clean chain.
  const silent = chainStatus({ ...base, children: [], declaredCount: 0 });
  ck("silence is not clearance", !silent.clear && silent.reasons.includes("no_declaration"),
    JSON.stringify(silent.reasons));
}

console.log("\n-- the root itself --");
{
  const base = { children: [], asOf: "2026-09-20", scopeKind: "labor_only" };
  ck("no waiver at all", chainStatus({ ...base, root: null }).reasons.includes("no_waiver"));
  ck("requested and unsigned",
    chainStatus({ ...base, root: { status: "requested", throughDate: "2026-09-20" } }).reasons.includes("unsigned"));
  ck("refused",
    chainStatus({ ...base, root: { status: "declined", throughDate: "2026-09-20" } }).reasons.includes("declined"));
  ck("every reason has words", ["no_waiver", "unsigned", "declined", "stale", "no_declaration",
    "not_requested", "lower_tier_outstanding", "lower_tier_declined"]
    .every((r) => chainReasonText(r).length > 10));
}

console.log("\n-- it counts, it never names --");
{
  const s = chainStatus({ root: signed("2026-09-20"), asOf: "2026-09-20", scopeKind: "labor_materials",
    declaredCount: 2,
    children: [signed("2026-09-20", { fromName: "ABC Supply", fromEmail: "ar@abc.test" }),
               signed("2026-09-20", { fromName: "SRS Distribution" })] });
  const json = JSON.stringify(s);
  ck("the roll-up is clear", s.clear, json);
  ck("and carries no supplier name", !/ABC Supply|SRS/.test(json), json);
  ck("nor an address", !/abc\.test/.test(json), json);
  ck("only how many, and through when",
    s.lowerTierTotal === 2 && s.lowerTierSigned === 2 && s.through === "2026-09-20", json);
}

console.log("\n-- which waiver belongs where in a release's life --");
{
  ck("before the money, conditional", waiverKindFor({ settled: false, isFinal: false }) === "conditional_progress");
  ck("after it clears, unconditional", waiverKindFor({ settled: true, isFinal: false }) === "unconditional_progress");
  ck("the last one is final", waiverKindFor({ settled: false, isFinal: true }) === "conditional_final");
  ck("and unconditional once settled", waiverKindFor({ settled: true, isFinal: true }) === "unconditional_final");
  ck("all four are kinds the database accepts",
    [false, true].flatMap((s) => [false, true].map((f) => waiverKindFor({ settled: s, isFinal: f })))
      .every((k) => WAIVER_KINDS.includes(k)));
}

console.log("\n-- and the schema agrees with the code --");
{
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE accounts(id TEXT PRIMARY KEY);CREATE TABLE users(id TEXT PRIMARY KEY);
           CREATE TABLE companies(id TEXT PRIMARY KEY);CREATE TABLE jobs(id TEXT PRIMARY KEY);
           CREATE TABLE work_orders(id TEXT PRIMARY KEY, value_cents INTEGER);`);
  for (const f of ["033_job_ledger", "034_retainage", "035_waiver_chain", "036_wo_scope"]) {
    db.exec(readFileSync(join(app, `worker/migrations/${f}.sql`), "utf8"));
  }
  ck("033 through 036 apply in order", true);
  ck("035 is repeatable", (() => {
    try { db.exec(readFileSync(join(app, "worker/migrations/035_waiver_chain.sql"), "utf8")); return true; }
    catch { return false; }
  })());

  db.exec(`INSERT INTO accounts(id) VALUES ('a1');
           INSERT INTO companies(id) VALUES ('c1');
           INSERT INTO jobs(id) VALUES ('j1');`);
  const ins = (id, kind, scope) => db.exec(
    `INSERT INTO lien_waivers(id, job_id, account_id, from_company_id, tier, kind, through_date, scope_kind)
     VALUES ('${id}','j1','a1','c1',0,'${kind}','2026-09-20','${scope}')`);

  for (const k of WAIVER_KINDS) { ins(`w_${k}`, k, "labor_materials"); }
  ck("every kind the code produces is a kind the table takes", true);
  let bad = null;
  try { ins("w_bad", "whenever", "labor_materials"); } catch (e) { bad = e.message; }
  ck("and one it does not is refused", /CHECK/i.test(String(bad)), String(bad).slice(0, 50));

  for (const s of SCOPE_KINDS) { ins(`s_${s}`, "conditional_progress", s); }
  ck("every scope the code knows is a scope the table takes", true);
  let badScope = null;
  try { ins("s_bad", "conditional_progress", "labour"); } catch (e) { badScope = e.message; }
  ck("and a misspelling is refused", /CHECK/i.test(String(badScope)), String(badScope).slice(0, 50));

  ck("a work order defaults to assuming there are materials",
    (() => { db.exec(`INSERT INTO work_orders(id) VALUES ('w1')`);
      return db.prepare(`SELECT scope_kind FROM work_orders WHERE id='w1'`).get().scope_kind === "labor_materials"; })());

  // A token is how somebody with no account signs, and it is single use.
  db.exec(`UPDATE lien_waivers SET token='tok1' WHERE id='w_conditional_progress'`);
  let dupe = null;
  try { db.exec(`UPDATE lien_waivers SET token='tok1' WHERE id='w_conditional_final'`); }
  catch (e) { dupe = e.message; }
  ck("two waivers cannot share a signing link", /UNIQUE/i.test(String(dupe)), String(dupe).slice(0, 50));
  ck("but any number can have none",
    db.prepare(`SELECT COUNT(*) n FROM lien_waivers WHERE token IS NULL`).get().n > 1);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
