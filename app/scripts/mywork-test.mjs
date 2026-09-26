// A subcontractor's own work, across every client.
//
// /api/jobs is `WHERE j.account_id = ?`. The contractor portal's job list and
// its amber badge were both derived from it, so a subcontractor on twenty-five
// GCs' rosters answered "does anybody need me tomorrow" by switching account
// twenty-five times -- and the badge only ever counted the account they were
// standing in. Four jobs could sit waiting on a yes behind a clean nav. That is
// not a long menu, it is missed work, and the doc-share flow exists to put a
// subcontractor on MORE rosters, so the better the growth loop works the worse
// it gets.
//
// What this covers:
//
//   IT SPANS ACCOUNTS. One call answers every client, and says which client
//   each row is for -- because "who is this for" is the whole question when the
//   answer is a different company every row.
//
//   IT IS SCOPED BY THE WORK ORDER, NOT THE JOB. `w.company_id = mine` is the
//   only thing that selects a row, so it cannot be widened into a client's job
//   list, and it never names the OTHER trades on the same job. Telling a roofer
//   which electrician the GC uses is the accumulation this product refuses.
//
//   NOBODY ELSE'S WORK, whatever they ask for. No id in the request, so
//   nothing to walk.
//
//   node --no-warnings scripts/mywork-test.mjs

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
ALTER TABLE jobs ADD COLUMN updated_at TEXT;
ALTER TABLE jobs ADD COLUMN severity TEXT;
ALTER TABLE work_orders ADD COLUMN pay_kind TEXT NOT NULL DEFAULT 'fixed';
ALTER TABLE work_orders ADD COLUMN rate_cents INTEGER;
ALTER TABLE work_orders ADD COLUMN cap_hours REAL;`;

// Bay Roofing is hired by three general contractors. Summit Electric is hired
// by one of them, on the same job -- which is the row that must never appear.
const seed = () => {
  const db = freshDb({ base: SCHEMA, migrations: [M031, COLS] });
  db.exec(`
    INSERT INTO accounts(id,name,subdomain,kind) VALUES
      ('acc_a','Alder Construction','alder','general_contractor'),
      ('acc_b','Birch Builders','birch','general_contractor'),
      ('acc_c','Cedar Contracting','cedar','general_contractor');
    INSERT INTO companies(id,company) VALUES
      ('cmp_bay','Bay Roofing'),
      ('cmp_summit','Summit Electric');
    INSERT INTO users(id,name,email) VALUES
      ('u_bay','Rae Bay','rae@bayroofing.test'),
      ('u_summit','Sal Summit','sal@summitelectric.test');
    INSERT INTO memberships(id,user_id,account_id,role,company_id) VALUES
      ('m1','u_bay','acc_a','contractor','cmp_bay'),
      ('m2','u_bay','acc_b','contractor','cmp_bay'),
      ('m3','u_bay','acc_c','contractor','cmp_bay'),
      ('m4','u_summit','acc_a','contractor','cmp_summit');
    INSERT INTO engagements(id,account_id,company_id,status) VALUES
      ('en_a','acc_a','cmp_bay','active'),
      ('en_b','acc_b','cmp_bay','active'),
      ('en_c','acc_c','cmp_bay','active'),
      ('en_as','acc_a','cmp_summit','active');
    INSERT INTO properties(id,account_id,name,address) VALUES
      ('p_a','acc_a','Alder Mill','12 Mill Lane');
    INSERT INTO jobs(id,account_id,title,address,date,property_id,status,trades) VALUES
      ('j_a','acc_a','Re-roof the mill','12 Mill Lane','2026-10-02','p_a','active','["roofing","electrical"]'),
      ('j_b','acc_b','Gutter run','40 Elm Ave','2026-10-09',NULL,'active','["roofing"]'),
      ('j_c','acc_c','Flat roof patch','3 Fir Close','2026-10-14',NULL,'active','["roofing"]'),
      ('j_gone','acc_b','Cancelled job','9 Oak Row','2026-10-20',NULL,'active','["roofing"]'),
      ('j_void','acc_c','Reassigned job','5 Ash St','2026-10-22',NULL,'active','["roofing"]');
    UPDATE jobs SET withdrawn_at = '2026-09-20' WHERE id = 'j_gone';
    INSERT INTO work_orders(id,wo_number,job_id,trade,company_id,engagement_id,status,value_cents,respond_by) VALUES
      ('wo_a','WO-1001','j_a','roofing','cmp_bay','en_a','pending',450000,'2026-09-30T17:00:00Z'),
      ('wo_b','WO-1002','j_b','roofing','cmp_bay','en_b','accepted',120000,NULL),
      ('wo_c','WO-1003','j_c','roofing','cmp_bay','en_c','pending',88000,'2026-10-01T17:00:00Z'),
      ('wo_gone','WO-1004','j_gone','roofing','cmp_bay','en_b','pending',50000,NULL),
      ('wo_void','WO-1005','j_void','roofing','cmp_bay','en_c','accepted',60000,NULL),
      -- The other trade on the mill job. Summit's, not Bay's.
      ('wo_sum','WO-1006','j_a','electrical','cmp_summit','en_as','accepted',300000,NULL);
    UPDATE work_orders SET voided_at = '2026-09-21' WHERE id = 'wo_void';`);
  return { db, env: { DB: makeD1(db) } };
};

const call = (env, who, acct, path) => worker.fetch(
  new Request(`https://api.subsub.work/api${path}`, {
    headers: { "Content-Type": "application/json", "X-User-Id": who, "X-Account-Id": acct },
  }), env);
const json = async (r) => [r.status, await r.json().catch(() => ({}))];

console.log("\n-- one call answers every client --");
{
  const { env } = seed();
  // Signed in at Alder, which is one of the three.
  const [s, body] = await json(await call(env, "u_bay", "acc_a", "/my-work"));
  ck("the route answers a contractor seat", s === 200, String(s));
  const work = body.work || [];
  ck("three live slots, at three different companies", work.length === 3,
    `${work.length}: ${work.map((w) => w.wo).join(",")}`);
  ck("across three accounts", new Set(work.map((w) => w.accountId)).size === 3);
  ck("each one names the client", work.every((w) => w.accountName),
    work.map((w) => w.accountName).join(" / "));
  ck("and names it by subdomain too, which is how you get there",
    work.every((w) => w.accountSubdomain));

  const here = work.filter((w) => w.here);
  ck("exactly one row is at the account we are standing in", here.length === 1,
    String(here.length));
  ck("and it is the right one", here[0]?.accountId === "acc_a", here[0]?.accountName);
  ck("the other two say they are elsewhere",
    work.filter((w) => !w.here).every((w) => w.accountId !== "acc_a"));

  // The whole point of the badge.
  const waiting = work.filter((w) => w.status === "pending" && !w.auto);
  ck("two jobs are waiting on a yes", waiting.length === 2, String(waiting.length));
  ck("and only one of them is at this account",
    waiting.filter((w) => w.here).length === 1);
  ck("so a badge counting this account alone would have missed one",
    waiting.filter((w) => !w.here).length === 1);

  // A withdrawn job is out of everything live; a voided order is gone.
  ck("a withdrawn job is not on the list", !work.some((w) => w.jobId === "j_gone"));
  ck("nor is a voided work order", !work.some((w) => w.wo === "WO-1005"));
}

console.log("\n-- it never names anybody else on the job --");
{
  const { env } = seed();
  const [, body] = await json(await call(env, "u_bay", "acc_a", "/my-work"));
  const work = body.work || [];
  const mill = work.filter((w) => w.jobId === "j_a");
  ck("the mill job appears once, as our slot", mill.length === 1, String(mill.length));
  ck("as our trade", mill[0]?.trade === "roofing", mill[0]?.trade);
  const flat = JSON.stringify(work);
  ck("the other trade's work order number is absent", !flat.includes("WO-1006"));
  ck("the other company's id is absent", !flat.includes("cmp_summit"));
  ck("and so is its name -- a roofer does not learn the GC's electrician",
    !flat.includes("Summit"));
  ck("nothing carries an assignments map at all", !work.some((w) => w.assignments));

  // Summit sees its own half and nothing of Bay's.
  const [, sbody] = await json(await call(env, "u_summit", "acc_a", "/my-work"));
  const swork = sbody.work || [];
  ck("Summit gets exactly its own one slot", swork.length === 1, String(swork.length));
  ck("on the same job", swork[0]?.jobId === "j_a");
  ck("and never Bay's", !JSON.stringify(swork).includes("cmp_bay")
    && !JSON.stringify(swork).includes("Bay Roofing"));
}

console.log("\n-- what a row carries, and what it does not --");
{
  const { env } = seed();
  const [, body] = await json(await call(env, "u_bay", "acc_a", "/my-work"));
  const row = (body.work || []).find((w) => w.jobId === "j_a");
  ck("where the work is", row?.address === "12 Mill Lane", row?.address);
  ck("which building, when there is one", row?.propertyName === "Alder Mill", row?.propertyName);
  ck("when it is due", row?.date === "2026-10-02", row?.date);
  ck("what they are being paid, because it is their own order",
    row?.value === "4500", row?.value);
  ck("and by when they must answer", !!row?.respondBy, row?.respondBy);
  // Not the client's business, and not needed to answer "where am I due".
  ck("no tenant report", !("reportDetail" in (row || {})));
  ck("no measurement docs", !("measurementDocs" in (row || {})));
  ck("no photos", !("photos" in (row || {})));
  ck("no notes", !("notes" in (row || {})));
  ck("nothing about the account but its name and subdomain",
    Object.keys(row || {}).filter((k) => k.startsWith("account")).sort().join(",")
      === "accountId,accountName,accountSubdomain");
}

console.log("\n-- nobody reads anybody else's --");
{
  const { env } = seed();
  // Nothing in the request names a company, so there is nothing to walk.
  // The only lever is the seat, and a seat speaks for one company.
  const [, bay] = await json(await call(env, "u_bay", "acc_a", "/my-work"));
  const [, sum] = await json(await call(env, "u_summit", "acc_a", "/my-work"));
  ck("two seats in the same account get different answers",
    JSON.stringify(bay) !== JSON.stringify(sum));
  ck("and neither is a superset of the other",
    !JSON.stringify(bay).includes("WO-1006") && !JSON.stringify(sum).includes("WO-1001"));

  // A seat with no company gets an empty list rather than everything.
  const { db, env: env2 } = seed();
  db.exec(`INSERT INTO users(id,name,email) VALUES ('u_boss','Pat Boss','pat@alder.test');
           INSERT INTO memberships(id,user_id,account_id,role) VALUES ('m5','u_boss','acc_a','admin');`);
  const [as, abody] = await json(await call(env2, "u_boss", "acc_a", "/my-work"));
  ck("an admin of a GC account gets their own account's company, not a roster",
    as === 200 && !JSON.stringify(abody).includes("WO-1001"),
    `${as} ${JSON.stringify(abody).slice(0, 80)}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
