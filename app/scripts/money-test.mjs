// Money that adds up, and a ledger that cannot be quietly rewritten.
//
// A percentage taken repeatedly does not add up. Hold 5% of each of three
// $333.33 milestones, round each one, and the total held is not 5% of
// $1,000 -- it is 5% short a cent or two that no ledger can account for.
// Across thirty subcontractors and a year of retainage that is a real number
// somebody has to explain to somebody else.
//
// So the arithmetic is asserted twice: on the handful of cases anybody would
// think to check, and then on ten thousand random ones, because the failures
// that matter here are the ones nobody thinks to check.
//
//   node scripts/money-test.mjs

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { BPS, cumulativeCut, releaseAmounts, splitEven, milestonesCover, heldBack } from "../shared/money.js";

const app = join(fileURLToPath(new URL(".", import.meta.url)), "..");
let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

console.log("\n-- a rate taken over several releases --");
{
  // The case that drifts if each cut is rounded on its own.
  const parts = [];
  let prior = 0;
  for (const g of [33333, 33333, 33334]) {
    parts.push(releaseAmounts({ gross: g, priorGross: prior, retainageBps: 500, feeBps: 250 }));
    prior += g;
  }
  const held = parts.reduce((n, p) => n + p.retainage, 0);
  const fees = parts.reduce((n, p) => n + p.fee, 0);
  ck("retainage over three thirds is exactly 5% of the whole",
    held === Math.floor(100000 * 500 / BPS), `${held} vs ${Math.floor(100000 * 500 / BPS)}`);
  ck("and the fee is exactly 2.5%", fees === Math.floor(100000 * 250 / BPS), String(fees));
  ck("the pennies are spread, not lost",
    parts.map((p) => p.retainage).join(",") === "1666,1667,1667", parts.map((p) => p.retainage).join(","));
  ck("net is gross less both, every time",
    parts.every((p) => p.net === p.gross - p.retainage - p.fee));
  ck("nothing is taken at a zero rate",
    releaseAmounts({ gross: 12345 }).net === 12345);
}

console.log("\n-- and over ten thousand random ones --");
{
  // A seeded generator, so a failure is reproducible rather than a story
  // about something that happened once on a Tuesday.
  let seed = 20260925;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  let drift = 0, negative = 0, worst = null;
  for (let t = 0; t < 10000; t++) {
    const n = 1 + rnd(8);
    const total = 1 + rnd(5_000_00);
    const retBps = rnd(1500);
    const feeBps = rnd(800);
    const parts = splitEven(total, n);
    if (parts.reduce((a, b) => a + b, 0) !== total) { drift++; worst = worst || ["split", total, n]; continue; }
    let prior = 0, held = 0, fees = 0, net = 0;
    for (const g of parts) {
      const a = releaseAmounts({ gross: g, priorGross: prior, retainageBps: retBps, feeBps });
      held += a.retainage; fees += a.fee; net += a.net; prior += g;
      if (a.net < 0) negative++;
    }
    const wantHeld = Math.floor(total * retBps / BPS);
    const wantFees = Math.floor(total * feeBps / BPS);
    if (held !== wantHeld || fees !== wantFees) { drift++; worst = worst || ["cut", total, n, retBps, feeBps, held, wantHeld]; }
    if (net + held + fees !== total) { drift++; worst = worst || ["sum", total, n]; }
  }
  ck("no case drifts by a cent", drift === 0, `${drift} of 10000 · ${JSON.stringify(worst)}`);
  ck("and no release comes out negative", negative === 0, String(negative));
}

console.log("\n-- splitting a total --");
for (const [total, n] of [[100000, 3], [1, 3], [0, 4], [7, 7], [999999, 11], [100, 1]]) {
  const parts = splitEven(total, n);
  ck(`${total} into ${n} sums back to ${total}`,
    parts.reduce((a, b) => a + b, 0) === total, JSON.stringify(parts));
  ck(`  and differs by at most a cent`,
    Math.max(...parts) - Math.min(...parts) <= 1, JSON.stringify(parts));
}

console.log("\n-- the parts have to account for the whole --");
{
  const ms = (...a) => a.map((amountCents) => ({ amountCents }));
  ck("exact is fine", milestonesCover(ms(5000, 5000), 10000).ok);
  ck("short is not", milestonesCover(ms(5000, 4000), 10000).ok === false);
  ck("and says by how much", milestonesCover(ms(5000, 4000), 10000).by === -1000,
    String(milestonesCover(ms(5000, 4000), 10000).by));
  ck("over is not either", milestonesCover(ms(6000, 5000), 10000).ok === false);
  ck("a single milestone covering the lot is the ordinary case",
    milestonesCover(ms(10000), 10000).ok);
  // An hourly work order whose ceiling is not yet known is not broken.
  ck("no value means nothing to check", milestonesCover(ms(1), null).ok);
  ck("held back is the sum of what was held",
    heldBack([{ retainage: 100 }, { retainage: 250 }]) === 350);
}

console.log("\n-- the ledger will not let the same milestone be paid twice --");
{
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE accounts(id TEXT PRIMARY KEY, company_id TEXT);
           CREATE TABLE users(id TEXT PRIMARY KEY);
           CREATE TABLE companies(id TEXT PRIMARY KEY);
           CREATE TABLE work_orders(id TEXT PRIMARY KEY, value_cents INTEGER);`);
  db.exec(readFileSync(join(app, "worker/migrations/033_job_ledger.sql"), "utf8"));
  db.exec(readFileSync(join(app, "worker/migrations/034_retainage.sql"), "utf8"));
  ck("the migration applies", true);
  ck("and applies twice — it is all IF NOT EXISTS", (() => {
    try { db.exec(readFileSync(join(app, "worker/migrations/033_job_ledger.sql"), "utf8")); return true; }
    catch { return false; }
  })());

  db.exec(`INSERT INTO accounts(id) VALUES ('a1');
           INSERT INTO companies(id) VALUES ('c1');
           INSERT INTO work_orders(id, value_cents) VALUES ('w1', 10000);
           INSERT INTO wo_milestones(id, work_order_id, account_id, seq, label, amount_cents)
             VALUES ('m1','w1','a1',1,'Rough-in',10000);`);
  const release = (id, idem) => db.exec(
    `INSERT INTO wo_releases(id, work_order_id, account_id, milestone_id, company_id,
       gross_cents, net_cents, idem_key)
     VALUES ('${id}','w1','a1','m1','c1',10000,10000,${idem ? `'${idem}'` : "NULL"})`);
  release("r1", "k1");
  let second = null;
  try { release("r2", "k2"); } catch (e) { second = e.message; }
  ck("a second release against the same milestone is refused",
    /UNIQUE/i.test(String(second)), String(second).slice(0, 60));

  let retry = null;
  try { release("r3", "k1"); } catch (e) { retry = e.message; }
  ck("and a retry of the same write is refused by its key",
    /UNIQUE/i.test(String(retry)), String(retry).slice(0, 60));

  // Two events with no key are two real events; two with the same key are
  // one event written twice.
  const ev = (id, idem) => db.exec(
    `INSERT INTO wo_events(id, work_order_id, account_id, kind, idem_key)
     VALUES ('${id}','w1','a1','checkin',${idem ? `'${idem}'` : "NULL"})`);
  ev("e1"); ev("e2");
  ck("unkeyed events are allowed to repeat",
    db.prepare(`SELECT COUNT(*) n FROM wo_events`).get().n === 2);
  ev("e3", "x1");
  let dupe = null;
  try { ev("e4", "x1"); } catch (e) { dupe = e.message; }
  ck("a keyed one is written once", /UNIQUE/i.test(String(dupe)), String(dupe).slice(0, 60));

  // The status vocabulary is the two-party rule, enforced by the database
  // rather than by whoever writes the next route.
  let bad = null;
  try {
    db.exec(`INSERT INTO wo_milestones(id, work_order_id, account_id, seq, label, status)
             VALUES ('m9','w1','a1',9,'x','done')`);
  } catch (e) { bad = e.message; }
  ck("a milestone cannot take a status nobody defined",
    /CHECK/i.test(String(bad)), String(bad).slice(0, 60));

  ck("retainage defaults to holding nothing",
    db.prepare(`SELECT retainage_bps FROM work_orders WHERE id='w1'`).get().retainage_bps === 0);
}

console.log("\n-- and the fee is recorded, not recomputed --");
{
  const w = readFileSync(join(app, "worker/migrations/033_job_ledger.sql"), "utf8");
  ck("the rate is stored on the release", /fee_bps\s+INTEGER/.test(w));
  ck("so is the money", /fee_cents\s+INTEGER/.test(w));
  ck("there is a seam for a processor", /method\s+TEXT/.test(w) && /reference\s+TEXT/.test(w));
  ck("and amounts are integers, never floats",
    !/REAL|FLOAT|DOUBLE/i.test(w), "a float crept into the ledger");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
