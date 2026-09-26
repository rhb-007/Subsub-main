// What a subcontractor sees of the account that hired them.
//
// GET /api/jobs narrows an OWNER and a TENANT by property. For a contractor
// seat scopeClause contributes nothing, so the list was every job on the
// account -- and every job carries a work order per trade, each naming the
// company on it, its crew, its work order number and its value. stripMoney
// redacts owners and tenants only, so the money went too.
//
// Accepting one connect request was therefore enough to read a general
// contractor's whole book: which company they use for each trade, on which job,
// at which address, for how much. That is the accumulation this product refuses
// everywhere else, and the send-my-documents loop exists to put more
// subcontractors on more rosters -- so it got worse the better the loop worked.
//
// Two halves, and either one alone still leaks:
//
//   WHICH JOBS. Only the ones their company holds a live work order on.
//
//   WHOSE ASSIGNMENTS. On a job they ARE on, their own trades and no others.
//
// And nothing changes for the account's own people, which is the other way
// this could go wrong.
//
//   node --no-warnings scripts/job-scope-test.mjs

import { readFileSync } from "node:fs";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");
const SCHEMA = readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8");
const M031 = `ALTER TABLE accounts ADD COLUMN company_id TEXT REFERENCES companies(id);`;
const COLS = `
ALTER TABLE jobs ADD COLUMN withdrawn_at TEXT;
ALTER TABLE jobs ADD COLUMN withdrawn_note TEXT;
ALTER TABLE jobs ADD COLUMN declined_at TEXT;
ALTER TABLE jobs ADD COLUMN declined_note TEXT;
ALTER TABLE jobs ADD COLUMN updated_at TEXT;
ALTER TABLE jobs ADD COLUMN severity TEXT;
ALTER TABLE jobs ADD COLUMN photos TEXT;
ALTER TABLE jobs ADD COLUMN report_detail TEXT;
ALTER TABLE work_orders ADD COLUMN pay_kind TEXT NOT NULL DEFAULT 'fixed';
ALTER TABLE work_orders ADD COLUMN rate_cents INTEGER;
ALTER TABLE work_orders ADD COLUMN cap_hours REAL;`;

// Alder Construction hires Bay Roofing and Summit Electric. They are on the
// mill job together. Alder also has two jobs Bay is not on at all.
const seed = () => {
  const db = freshDb({ base: SCHEMA, migrations: [M031, COLS] });
  db.exec(`
    INSERT INTO accounts(id,name,subdomain,kind) VALUES
      ('acc_a','Alder Construction','alder','general_contractor');
    INSERT INTO companies(id,company,phone,email) VALUES
      ('cmp_bay','Bay Roofing','2065550111','rae@bayroofing.test'),
      ('cmp_summit','Summit Electric','2065550222','sal@summitelectric.test'),
      ('cmp_quiet','Quiet Plumbing','2065550333','pat@quietplumbing.test');
    INSERT INTO users(id,name,email) VALUES
      ('u_boss','Pat Boss','pat@alder.test'),
      ('u_bay','Rae Bay','rae@bayroofing.test'),
      ('u_summit','Sal Summit','sal@summitelectric.test');
    INSERT INTO memberships(id,user_id,account_id,role,company_id) VALUES
      ('m0','u_boss','acc_a','admin',NULL),
      ('m1','u_bay','acc_a','contractor','cmp_bay'),
      ('m2','u_summit','acc_a','contractor','cmp_summit');
    INSERT INTO engagements(id,account_id,company_id,status) VALUES
      ('en_bay','acc_a','cmp_bay','active'),
      ('en_sum','acc_a','cmp_summit','active'),
      ('en_qui','acc_a','cmp_quiet','active');
    INSERT INTO jobs(id,account_id,title,address,date,status,trades) VALUES
      ('j_mill','acc_a','Re-roof the mill','12 Mill Lane','2026-10-02','active','["roofing","electrical"]'),
      ('j_barn','acc_a','Rewire the barn','40 Elm Ave','2026-10-09','active','["electrical"]'),
      ('j_shop','acc_a','Shop fit-out','3 Fir Close','2026-10-14','active','["plumbing"]'),
      ('j_old','acc_a','Old gutter run','9 Oak Row','2026-09-01','active','["roofing"]');
    INSERT INTO work_orders(id,wo_number,job_id,trade,company_id,engagement_id,status,value_cents,crew_name) VALUES
      ('wo_bay','WO-1001','j_mill','roofing','cmp_bay','en_bay','accepted',450000,'Bay crew A'),
      ('wo_sum','WO-1002','j_mill','electrical','cmp_summit','en_sum','accepted',300000,'Summit crew'),
      ('wo_sum2','WO-1003','j_barn','electrical','cmp_summit','en_sum','accepted',275000,'Summit crew'),
      ('wo_qui','WO-1004','j_shop','plumbing','cmp_quiet','en_qui','accepted',190000,'Quiet crew'),
      -- Bay's old order, voided when the job was reassigned. Not access.
      ('wo_gone','WO-1005','j_old','roofing','cmp_bay','en_bay','accepted',60000,'Bay crew B');
    UPDATE work_orders SET voided_at = '2026-09-10' WHERE id = 'wo_gone';`);
  return { db, env: { DB: makeD1(db) } };
};

const call = (env, who, acct) => worker.fetch(
  new Request("https://api.subsub.work/api/jobs", {
    headers: { "Content-Type": "application/json", "X-User-Id": who, "X-Account-Id": acct },
  }), env);
const json = async (r) => [r.status, await r.json().catch(() => ({}))];

console.log("\n-- the account's own people are unaffected --");
{
  const { env } = seed();
  const [s, jobs] = await json(await call(env, "u_boss", "acc_a"));
  ck("an admin still gets the whole list", s === 200 && jobs.length === 4,
    `${s} ${jobs.length}`);
  const mill = jobs.find((j) => j.id === "j_mill");
  ck("with every trade on a job", Object.keys(mill?.assignments || {}).sort().join(",")
    === "electrical,roofing", JSON.stringify(Object.keys(mill?.assignments || {})));
  ck("naming both companies",
    mill.assignments.roofing.subId === "cmp_bay"
    && mill.assignments.electrical.subId === "cmp_summit");
  ck("and carrying what each is paid",
    mill.assignments.roofing.value === "4500" && mill.assignments.electrical.value === "3000",
    `${mill.assignments.roofing.value} / ${mill.assignments.electrical.value}`);
}

console.log("\n-- a subcontractor gets the jobs they were issued --");
{
  const { env } = seed();
  const [s, jobs] = await json(await call(env, "u_bay", "acc_a"));
  ck("the call still works", s === 200, String(s));
  ck("one job, not four", jobs.length === 1, `${jobs.length}: ${jobs.map((j) => j.id).join(",")}`);
  ck("and it is the one they are on", jobs[0]?.id === "j_mill", jobs[0]?.id);
  // The three they are not on.
  const ids = jobs.map((j) => j.id);
  ck("a job for another trade is not theirs to read", !ids.includes("j_barn"));
  ck("nor one for a third company", !ids.includes("j_shop"));
  ck("and a voided order is not access", !ids.includes("j_old"));
}

console.log("\n-- and on that job, only their own trade --");
{
  const { env } = seed();
  const [, jobs] = await json(await call(env, "u_bay", "acc_a"));
  const mill = jobs[0];
  ck("assignments is present", !!mill && typeof mill.assignments === "object",
    typeof mill?.assignments);
  ck("carrying exactly one trade", Object.keys(mill.assignments).length === 1,
    JSON.stringify(Object.keys(mill.assignments)));
  ck("theirs", mill.assignments.roofing?.subId === "cmp_bay");
  ck("with their own work order intact", mill.assignments.roofing?.wo === "WO-1001");
  ck("and their own pay, which is theirs to see",
    mill.assignments.roofing?.value === "4500", mill.assignments.roofing?.value);
  ck("and their own crew", mill.assignments.roofing?.crewName === "Bay crew A");

  // The whole point.
  const flat = JSON.stringify(jobs);
  ck("the other company's id is gone", !flat.includes("cmp_summit"));
  ck("its work order number is gone", !flat.includes("WO-1002"));
  ck("its crew is gone", !flat.includes("Summit crew"));
  ck("what it is paid is gone", !flat.includes("3000"));
  ck("and the electrical slot is not there at all", !("electrical" in mill.assignments));
  // Nothing about the companies they have never worked with.
  ck("no sign of the third company", !flat.includes("cmp_quiet") && !flat.includes("Quiet"));
}

console.log("\n-- each subcontractor sees their own half, and only that --");
{
  const { env } = seed();
  const [, bay] = await json(await call(env, "u_bay", "acc_a"));
  const [, sum] = await json(await call(env, "u_summit", "acc_a"));
  ck("Summit is on two jobs", sum.length === 2, `${sum.length}: ${sum.map((j) => j.id).join(",")}`);
  ck("Bay is on one", bay.length === 1);
  ck("they share the mill job",
    sum.some((j) => j.id === "j_mill") && bay.some((j) => j.id === "j_mill"));
  const sumMill = sum.find((j) => j.id === "j_mill");
  ck("and Summit sees only its own trade on it",
    Object.keys(sumMill.assignments).join(",") === "electrical",
    JSON.stringify(Object.keys(sumMill.assignments)));
  ck("never Bay's", !JSON.stringify(sum).includes("cmp_bay")
    && !JSON.stringify(sum).includes("WO-1001") && !JSON.stringify(sum).includes("4500"));
  ck("and neither answer is a superset of the other",
    !JSON.stringify(bay).includes("WO-1003"));
  // Nothing in the request names a company: the seat is the only lever.
  ck("two seats in the same account get different answers",
    JSON.stringify(bay) !== JSON.stringify(sum));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
