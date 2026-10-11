// HOURS ON AN HOURLY WORK ORDER, AND ASKING FOR MORE OF THEM.
//
// Asked for as: *"if hourly can the subcontractor say how many hours he spent
// on the project before completing? How do we know how many hours it took?"*
// and *"should we add the ability to leave the hourly open ended instead of
// capping so we aren't limiting reality of what it actually takes?"*
//
// 024 stored a rate and a cap and nothing else, so an hourly job was paid as
// rate x cap whatever it took. Migration 078, app/shared/hours.js. What this
// pins:
//
//   THE SUB SAYS THE HOURS, BY DAY, AND THE PAY IS THOSE HOURS x THE RATE.
//   A submission is a milestone (verify, reject, release, fee, cover gate and
//   waiver all unchanged) plus one row per day.
//
//   ONLY THE COMPANY DOING THE WORK SENDS HOURS, and the hiring side approves
//   them -- the two-party rule completion already follows.
//
//   THE ESTIMATE IS A CEILING ON WHAT IS APPROVED, NOT ON WHAT HAPPENED.
//   Going over is a question the sub asks with a reason; the hiring side
//   answers; an approved extra raises the ceiling by exactly that much,
//   derived on read and never written onto the work order.
//
//   A FIXED PRICE, A WORK ORDER NOBODY HAS ACCEPTED, AND ONE ALREADY SPLIT INTO
//   DRAWS ARE NOT OFFERED HOURS -- two answers to what is owed is one too many.
//
//   AND THE TWO INVARIANTS ARE RUN AGAINST REAL ROWS, out of the real
//   CHECK.sql, because every invariant reads zero on an empty database.
//
//   node --no-warnings scripts/hours-test.mjs

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";
import { runCheck } from "./lib/check-sql.mjs";
import { checkEntries, ceilingHours, hoursUsed, submitRefusal, requestRefusal,
  hoursAmountCents, fmtHours, isDay, HOURS_ERRORS } from "../shared/hours.js";

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");
const SCHEMA = readFileSync(join(app, "worker", "schema.sql"), "utf8");

const day = (n) => {
  const d = new Date(); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const seed = () => {
  const db = freshDb({ base: SCHEMA, migrations: [] });
  db.exec(`
    INSERT INTO accounts(id,name,kind,subdomain,plan) VALUES
      ('acc_pm','Sound Property Management','property_manager','soundpm','scale');
    INSERT INTO users(id,name,email) VALUES
      ('u_mgr','Chris Lane','chris@soundpm.test'),
      ('u_pm','Dev Patel','dev@soundpm.test'),
      ('u_crew','Juan Soto','juan@pacific.test'),
      ('u_oth','Ana Ruiz','ana@other.test');
    INSERT INTO properties(id,account_id,name,address,city,state,zip) VALUES
      ('prop_1','acc_pm','Press Apartments','1620 Belmont','Seattle','WA','98122');
    INSERT INTO companies(id,company,contact,email,state,insurance,bond,contract) VALUES
      ('cmp_1','Pacific apartment maintenance','Juan Soto','juan@pacific.test','WA',1,1,1),
      ('cmp_2','Other Painting','Ana Ruiz','ana@other.test','WA',1,1,1);
    INSERT INTO memberships(id,user_id,account_id,role,company_id) VALUES
      ('m_mgr','u_mgr','acc_pm','admin',NULL),
      ('m_pm','u_pm','acc_pm','pm',NULL),
      ('m_crew','u_crew','acc_pm','contractor','cmp_1'),
      ('m_oth','u_oth','acc_pm','contractor','cmp_2');
    INSERT INTO engagements(id,account_id,company_id,status,categories) VALUES
      ('en_1','acc_pm','cmp_1','active','["plumbing","painting"]'),
      ('en_2','acc_pm','cmp_2','active','["painting"]');
    INSERT INTO jobs(id,account_id,property_id,title,trades,status,created_at) VALUES
      ('job_1','acc_pm','prop_1','Leak behind the wall','["plumbing","painting"]','active','2026-10-01'),
      ('job_2','acc_pm','prop_1','Older hourly job','["plumbing"]','active','2026-10-01');
    -- $45 an hour, 10 hours estimated: the one under test.
    INSERT INTO work_orders(id,job_id,company_id,engagement_id,trade,wo_number,status,
                            pay_kind,rate_cents,cap_hours,value_cents) VALUES
      ('wo_h','job_1','cmp_1','en_1','plumbing','WO-200100','accepted','hourly',4500,10,45000),
      -- A fixed price on the same job: no timesheet.
      ('wo_f','job_1','cmp_1','en_1','painting','WO-200101','accepted','fixed',NULL,NULL,90000),
      -- Hourly, and split into draws in dollars before hours existed.
      ('wo_legacy','job_2','cmp_1','en_1','plumbing','WO-200102','accepted','hourly',4500,8,36000);
    INSERT INTO wo_milestones(id,work_order_id,account_id,seq,label,amount_cents) VALUES
      ('ms_old','wo_legacy','acc_pm',1,'All of it',36000);
  `);
  return { db, env: { DB: makeD1(db) } };
};

const call = (env, method, path, body, who = "u_crew") => worker.fetch(
  new Request(`https://api.subsub.work${path}`, {
    method, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: { "Content-Type": "application/json", "X-User-Id": who, "X-Account-Id": "acc_pm" },
  }), env);
const post = (env, path, body, who) => call(env, "POST", path, body ?? {}, who);
const get = (env, path, who) => call(env, "GET", path, undefined, who);
const json = async (r) => [r.status, await r.json().catch(() => ({}))];
const entriesOf = (db, ms) => db.prepare(
  `SELECT work_date, hours FROM wo_hour_entries WHERE milestone_id = ? ORDER BY work_date`).all(ms);
const msOf = (db, id) => db.prepare(`SELECT * FROM wo_milestones WHERE id = ?`).get(id);

try {
  console.log("\n-- the rule, before any route --");
  {
    ck("a real day", isDay("2026-10-03") && !isDay("2026-02-31") && !isDay("10/3/2026"));
    const ok = checkEntries([{ date: day(-1), hours: "3.5" }, { date: day(-2), hours: 4 }], { today: day(0) });
    ck("two days add up", ok.hours === 7.5 && ok.entries.length === 2, JSON.stringify(ok));
    ck("and come back in date order", ok.entries[0].date === day(-2));
    ck("quarter hours only", checkEntries([{ date: day(0), hours: "7.3" }]).error === "quarter_hours");
    ck("one line per day", checkEntries([{ date: day(0), hours: 2 }, { date: day(0), hours: 3 }]).error === "duplicate_day");
    ck("not a day that hasn't happened",
      checkEntries([{ date: day(3), hours: 2 }], { today: day(0) }).error === "future_date");
    // Tomorrow in UTC is still tonight on the West Coast.
    ck("but tomorrow in UTC is allowed", !checkEntries([{ date: day(1), hours: 2 }], { today: day(0) }).error);
    ck("not more than a day holds", checkEntries([{ date: day(0), hours: 25 }]).error === "too_many_hours");
    ck("nothing at all is refused", checkEntries([]).error === "no_hours");
    ck("the ceiling counts approved extras only",
      ceilingHours(10, [{ status: "approved", hours: 4 }, { status: "declined", hours: 9 },
        { status: "pending", hours: 3 }]) === 14);
    ck("a sent-back submission does not use hours",
      hoursUsed([{ id: "a", status: "rejected", hours: 6 }, { id: "b", status: "reached", hours: 2 }]) === 2);
    const over = submitRefusal({ hours: 3, capHours: 10, submissions: [{ id: "a", status: "verified", hours: 8.5 }] });
    ck("over the ceiling names the shortfall exactly",
      over?.error === "over_estimate" && over.overBy === 1.5 && over.remainingHours === 1.5, JSON.stringify(over));
    ck("exactly to the ceiling goes", !submitRefusal({ hours: 1.5, capHours: 10,
      submissions: [{ id: "a", status: "verified", hours: 8.5 }] }));
    ck("replacing a submission does not count it twice", !submitRefusal({ hours: 9, capHours: 10,
      submissions: [{ id: "a", status: "reached", hours: 8.5 }], replacing: "a" }));
    ck("asking for more needs a reason", requestRefusal({ hours: 4, reason: " " })?.error === "reason_required");
    ck("one open question at a time",
      requestRefusal({ hours: 4, reason: "rot", requests: [{ status: "pending" }] })?.error === "already_pending");
    ck("the amount is rounded once, from the total", hoursAmountCents(7.75, 4533) === 35131);
    ck("hours read without trailing zeros", fmtHours(8) === "8 h" && fmtHours(7.5) === "7.5 h");
    const codes = ["no_hours", "bad_date", "future_date", "duplicate_day", "bad_hours", "quarter_hours",
      "over_estimate", "already_pending", "reason_required", "not_hourly", "not_accepted", "drawn_plan"];
    ck("every refusal has words", codes.every((k) => !!HOURS_ERRORS[k]), codes.filter((k) => !HOURS_ERRORS[k]).join());
  }

  const { db, env } = seed();
  let first, second;

  console.log("\n-- the sub sends the hours they worked --");
  {
    const [s, b] = await json(await post(env, "/api/work-orders/wo_h/hours", {
      entries: [{ date: day(-2), hours: 4 }, { date: day(-1), hours: "3.5", note: "found the leak" }],
      note: "Opened the wall, replaced the joint" }));
    ck("it is accepted", s === 201 && b.ok, `${s} ${JSON.stringify(b)}`);
    first = b.milestoneId;
    ck("it says how many hours", b.hours === 7.5, String(b.hours));
    // THE WHOLE POINT: hours x rate, not the estimate x rate.
    ck("and is worth hours x the rate, not the estimate", b.amountCents === 33750, String(b.amountCents));
    const m = msOf(db, first);
    ck("as a milestone waiting on approval", m?.status === "reached" && m.amount_cents === 33750,
      JSON.stringify(m));
    ck("with one row per day", entriesOf(db, first).length === 2, JSON.stringify(entriesOf(db, first)));
    ck("and the note kept", m?.note === "Opened the wall, replaced the joint");

    const [ps, plan] = await json(await get(env, "/api/work-orders/wo_h/plan", "u_mgr"));
    ck("the plan says it is hourly", ps === 200 && plan.payKind === "hourly" && plan.rateCents === 4500,
      `${ps} ${plan.payKind}`);
    ck("and carries the hours", plan.hours?.submissions?.length === 1
      && plan.hours.submissions[0].entries.length === 2, JSON.stringify(plan.hours?.submissions));
    ck("used 7.5 of 10, 2.5 left", plan.hours?.usedHours === 7.5 && plan.hours?.remainingHours === 2.5,
      JSON.stringify({ used: plan.hours?.usedHours, left: plan.hours?.remainingHours }));
    ck("none approved yet", plan.hours?.approvedHours === 0);
    ck("and it is not a drawn plan", plan.hours?.legacyPlan === false);
  }

  console.log("\n-- only the company doing the work sends hours --");
  {
    const body = { entries: [{ date: day(-1), hours: 1 }] };
    const [a] = await json(await post(env, "/api/work-orders/wo_h/hours", body, "u_mgr"));
    ck("not the hiring side", a === 403);
    const [o] = await json(await post(env, "/api/work-orders/wo_h/hours", body, "u_oth"));
    ck("not another contractor on the account", o === 403);
    const [f, fb] = await json(await post(env, "/api/work-orders/wo_f/hours", body));
    ck("not on a fixed price", f === 409 && fb.error === "not_hourly", `${f} ${fb.error}`);
    db.exec(`UPDATE work_orders SET status = 'pending' WHERE id = 'wo_h'`);
    const [p, pb] = await json(await post(env, "/api/work-orders/wo_h/hours", body));
    ck("not before the work order is accepted", p === 409 && pb.error === "not_accepted", `${p} ${pb.error}`);
    db.exec(`UPDATE work_orders SET status = 'accepted' WHERE id = 'wo_h'`);
    const [l, lb] = await json(await post(env, "/api/work-orders/wo_legacy/hours", body));
    ck("not on one already split into draws", l === 409 && lb.error === "drawn_plan", `${l} ${lb.error}`);
    const [r, rb] = await json(await post(env, `/api/milestones/${first}/reach`, {}));
    ck("and a timesheet is not marked done by hand", r === 409 && rb.error === "use_hours", `${r} ${rb.error}`);
    const [pl, plb] = await json(await call(env, "PUT", "/api/work-orders/wo_h/plan",
      { milestones: [{ label: "All", amountCents: 45000 }] }, "u_mgr"));
    ck("and the hiring side cannot cut it into dollar draws", pl === 409 && plb.error === "hourly_uses_hours",
      `${pl} ${plb.error}`);
    const [lp] = await json(await call(env, "PUT", "/api/work-orders/wo_legacy/plan",
      { milestones: [{ label: "All", amountCents: 36000 }] }, "u_mgr"));
    ck("while the older drawn one keeps its plan", lp === 200, String(lp));
  }

  console.log("\n-- going over the estimate is a question, not a submission --");
  {
    const [s, b] = await json(await post(env, "/api/work-orders/wo_h/hours",
      { entries: [{ date: day(0), hours: 3 }] }));
    ck("three more hours is refused", s === 409 && b.error === "over_estimate", `${s} ${JSON.stringify(b)}`);
    ck("and names the half hour over", b.overBy === 0.5 && b.remainingHours === 2.5, JSON.stringify(b));
    ck("nothing was written", db.prepare(`SELECT COUNT(*) AS n FROM wo_milestones WHERE work_order_id = 'wo_h'`).get().n === 1);

    const [nr, nrb] = await json(await post(env, "/api/work-orders/wo_h/hour-requests", { hours: 4, reason: "" }));
    ck("asking needs a reason", nr === 400 && nrb.error === "reason_required", `${nr} ${nrb.error}`);
    const [rq, rqb] = await json(await post(env, "/api/work-orders/wo_h/hour-requests",
      { hours: 4, reason: "Found rot behind the wall" }));
    ck("asking with one is accepted", rq === 201 && rqb.id, `${rq} ${JSON.stringify(rqb)}`);
    const [two, twob] = await json(await post(env, "/api/work-orders/wo_h/hour-requests",
      { hours: 2, reason: "and more" }));
    ck("a second open question is refused", two === 409 && twob.error === "already_pending", `${two} ${twob.error}`);
    // The pre-check makes the ordinary case cheap; the index is what is correct
    // when two presses arrive at once, so it is asserted on its own.
    let raced = false;
    try {
      db.exec(`INSERT INTO wo_hour_requests(id,work_order_id,account_id,hours,reason)
                 VALUES ('rq_race','wo_h','acc_pm',1,'race')`);
    } catch { raced = true; }
    ck("and the index refuses a second pending row directly", raced);

    const [subd] = await json(await post(env, `/api/hour-requests/${rqb.id}/decide`, { approve: true }));
    ck("the sub cannot answer their own question", subd === 403, String(subd));
    const [dn, dnb] = await json(await post(env, `/api/hour-requests/${rqb.id}/decide`, { approve: false }, "u_pm"));
    ck("declining needs a reason", dn === 400 && dnb.error === "reason_required", `${dn} ${dnb.error}`);
    const [ap, apb] = await json(await post(env, `/api/hour-requests/${rqb.id}/decide`, { approve: true }, "u_pm"));
    ck("a project manager approves it", ap === 200 && apb.status === "approved", `${ap} ${JSON.stringify(apb)}`);
    ck("and the ceiling is the estimate plus the extra", apb.ceilingHours === 14, String(apb.ceilingHours));
    const [again] = await json(await post(env, `/api/hour-requests/${rqb.id}/decide`, { approve: true }, "u_mgr"));
    ck("it is decided once", again === 409, String(again));
    // DERIVED, never written onto the work order.
    const w = db.prepare(`SELECT cap_hours, value_cents FROM work_orders WHERE id = 'wo_h'`).get();
    ck("the work order itself is untouched", w.cap_hours === 10 && w.value_cents === 45000, JSON.stringify(w));

    const [s2, b2] = await json(await post(env, "/api/work-orders/wo_h/hours",
      { entries: [{ date: day(0), hours: 3 }] }));
    ck("now the three hours go", s2 === 201, `${s2} ${JSON.stringify(b2)}`);
    second = b2.milestoneId;
  }

  console.log("\n-- the hiring side approves, and is paid the hours --");
  {
    const [v, vb] = await json(await post(env, `/api/milestones/${first}/verify`, {}, "u_mgr"));
    ck("approving is the ordinary verify", v === 200 && vb.ok, `${v} ${JSON.stringify(vb)}`);
    ck("and the release is the hours, not the estimate", vb.gross === 33750, String(vb.gross));
    const [e, eb] = await json(await post(env, "/api/work-orders/wo_h/hours",
      { milestoneId: first, entries: [{ date: day(-1), hours: 9 }] }));
    ck("an approved one cannot be changed", e === 409 && eb.error === "not_editable", `${e} ${eb.error}`);

    const [rj] = await json(await post(env, `/api/milestones/${second}/reject`,
      { reason: "We agreed 2 hours for the patch" }, "u_mgr"));
    ck("sending one back is the ordinary reject", rj === 200, String(rj));
    const [ps, plan] = await json(await get(env, "/api/work-orders/wo_h/plan", "u_crew"));
    ck("a sent-back submission no longer uses hours", ps === 200 && plan.hours.usedHours === 7.5,
      String(plan.hours?.usedHours));
    const [rs, rsb] = await json(await post(env, "/api/work-orders/wo_h/hours",
      { milestoneId: second, entries: [{ date: day(0), hours: 2 }], note: "Corrected" }));
    ck("the sub corrects it in place", rs === 200 && rsb.milestoneId === second, `${rs} ${JSON.stringify(rsb)}`);
    const m = msOf(db, second);
    ck("it is back up for approval at the new amount", m.status === "reached" && m.amount_cents === 9000,
      JSON.stringify(m));
    ck("with its days replaced, not added to", entriesOf(db, second).length === 1
      && entriesOf(db, second)[0].hours === 2, JSON.stringify(entriesOf(db, second)));
  }

  console.log("\n-- the invariants, against real rows --");
  {
    let r = runCheck(db);
    ck("amounts match their hours", r.m078_inv_hours_amount === 0, String(r.m078_inv_hours_amount));
    ck("no timesheet on a fixed price", r.m078_inv_hours_on_fixed === 0, String(r.m078_inv_hours_on_fixed));
    db.exec(`UPDATE wo_milestones SET amount_cents = amount_cents + 1 WHERE id = '${first}'`);
    db.exec(`INSERT INTO wo_milestones(id,work_order_id,account_id,seq,label,amount_cents,status)
               VALUES ('ms_f','wo_f','acc_pm',1,'x',100,'reached');
             INSERT INTO wo_hour_entries(id,work_order_id,milestone_id,work_date,hours)
               VALUES ('he_f','wo_f','ms_f','2026-10-01',1);`);
    r = runCheck(db);
    ck("a cent off is caught", r.m078_inv_hours_amount === 2, String(r.m078_inv_hours_amount));
    ck("and hours on a fixed price are caught", r.m078_inv_hours_on_fixed === 1, String(r.m078_inv_hours_on_fixed));
  }

  console.log("\n-- a database without 078 --");
  {
    const { db: d2, env: e2 } = seed();
    d2.exec(`DROP TABLE wo_hour_entries; DROP TABLE wo_hour_requests;`);
    const [s, b] = await json(await post(e2, "/api/work-orders/wo_h/hours", { entries: [{ date: day(-1), hours: 1 }] }));
    ck("sending hours names the file", s === 503 && b.migration === "078_wo_hours", `${s} ${JSON.stringify(b)}`);
    const [ps, plan] = await json(await get(e2, "/api/work-orders/wo_h/plan", "u_mgr"));
    ck("the plan still loads", ps === 200 && plan.hours?.migration === "078_wo_hours", `${ps} ${JSON.stringify(plan.hours)}`);
  }
} catch (err) {
  // One real failure reported as a crash would hide every assertion after it.
  ck("the suite ran to the end", false, err?.stack || String(err));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
