// WHERE THE RAISED JOB GOT TO, on the row that said "Job raised" for ever.
//
// Reported against the Inspections list with the flagged rows circled:
// *"details or status of the inspection of ones that were flagged for follow
// up should have the status updated from job raised to what's happening
// currently — job scheduled for specific date"*.
//
// That chip was `!!inspection.jobId`, which is a fact about whether a row
// exists rather than about the work. So a unit booked for Thursday, a unit
// whose crew has not answered and a unit whose job was cancelled all read the
// same two words from the one screen a managing agent opens to see what is
// still outstanding — and everything 061, 064 and 066 added happens after
// that chip is earned.
//
// What is pinned here:
//
//   NOBODY ON IT OUTRANKS A DATE. A window settles once everybody who must
//   agree has, and `visitParties` counts only crews who have ACCEPTED — so on
//   a job with nobody assigned the hiring side agrees with itself and the
//   visit reads `confirmed`. "Scheduled Oct 9" over a unit no contractor is
//   coming to is the screen-that-lies rule on the one line somebody scans.
//
//   EVERY STATE IS DRIVEN ON ITS OWN ROW, in one fixture. A rule that
//   answered one word for everything passes a suite with a single job in it.
//
//   node --no-warnings scripts/insp-progress-test.mjs

import { readFileSync } from "node:fs";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";
import { jobProgress, JOB_PROGRESS } from "../shared/jobstate.js";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");
const BASE = readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8");

// Today, and two days either side of it, so the fixture is never stale.
const key = (n) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const TODAY = key(0), SOON = key(5), GONE = key(-9), LATER = key(40);

console.log("\n-- the rule, before anything is driven --");
{
  // THE ORDERING IS THE WHOLE DESIGN, so it is pinned on its own before the
  // route is involved. Each of these differs from the one above it by exactly
  // one fact.
  ck("a job nobody is on needs a contractor",
    jobProgress({}).id === "unassigned", jobProgress({}).id);
  ck("even with a date on it, because a date is not a crew",
    jobProgress({ date: SOON }).id === "unassigned", jobProgress({ date: SOON }).id);
  // NOBODY ON IT OUTRANKS A CONFIRMED WINDOW. The discriminating case: with
  // no crew the hiring side settles a window by itself, so a rule that read
  // the visit first would draw "Scheduled" over a unit nobody is attending.
  ck("and a settled window over nobody still reads as needing a contractor",
    jobProgress({}, { when: { kind: "confirmed", date: SOON } }).id === "unassigned");
  ck("issued and unanswered is waiting on the contractor",
    jobProgress({ assigned: 1 }).id === "offered");
  ck("accepted with nothing anywhere says there is no time",
    jobProgress({ assigned: 1, accepted: 1 }).id === "taken");
  ck("accepted with a job date is a target",
    jobProgress({ assigned: 1, accepted: 1, date: SOON }).id === "target");

  const prop = jobProgress({ assigned: 1, accepted: 1 },
    { when: { kind: "proposed", date: SOON } });
  ck("a proposed window says so and carries its date",
    prop.id === "proposed" && prop.date === SOON, JSON.stringify(prop));
  const sch = jobProgress({ assigned: 1, accepted: 1 },
    { when: { kind: "confirmed", date: SOON } });
  ck("and a confirmed one is scheduled, with the date",
    sch.id === "scheduled" && sch.date === SOON, JSON.stringify(sch));
  // The request's own words: *job scheduled for specific date*.
  ck("which is the sentence that was asked for",
    /^Scheduled/.test(sch.label) && sch.tone === "ok", JSON.stringify(sch));

  // 066's THREE ENDINGS KEEP THEIR OWN WORDS. Somebody who read the problem
  // and decided nothing needed doing is saying a different thing from
  // somebody calling the work off, and a row flattening both to "closed"
  // sends the reader to the wrong question.
  ck("a cancellation says cancelled",
    jobProgress({ ending_kind: "cancelled" }).id === "cancelled");
  ck("closed with nothing to do says that instead",
    jobProgress({ status: "completed", ending_kind: "no_work" }).id === "no_work");
  ck("and a completed job says the work is done",
    jobProgress({ status: "completed" }).id === "done");
  const held = jobProgress({ ending_kind: "deferred", ending_until: LATER }, { today: TODAY });
  ck("a live hold carries the date it comes off",
    held.id === "on_hold" && held.date === LATER, JSON.stringify(held));
  // A HOLD COMES OFF BY ITSELF, which `jobHold` already decides — so a lapsed
  // one must read as live work again rather than sitting on hold for ever.
  ck("and a lapsed hold is back to needing a contractor",
    jobProgress({ ending_kind: "deferred", ending_until: GONE }, { today: TODAY }).id
      === "unassigned");

  // A STEM AND A DATE, never a finished string. The Worker answers in UTC and
  // the browser in the reader's own zone, and this project has already paid
  // for a date helper that disagreed with the one beside it.
  ck("no state carries a formatted date in its label",
    Object.values(JOB_PROGRESS).every((p) => !/\d/.test(p.label)),
    JSON.stringify(Object.values(JOB_PROGRESS).map((p) => p.label)));
  ck("every state names a tone the stylesheet has",
    Object.values(JOB_PROGRESS).every((p) => ["ok", "wait", "plain"].includes(p.tone)),
    JSON.stringify(Object.values(JOB_PROGRESS).map((p) => [p.id, p.tone])));
}

const seed = () => {
  const db = freshDb({ base: BASE, migrations: [] });
  db.exec(`
    INSERT INTO accounts(id,name,kind,subdomain) VALUES
      ('acc1','Sound Property Management','property_manager','soundpm'),
      -- A real second account, so the scoping block below can move a job onto
      -- one rather than onto an id nothing holds -- where the FOREIGN KEY
      -- would refuse it and the assertion would be testing SQLite.
      ('acc2','Other Agent','property_manager','other');
    INSERT INTO users(id,name,email) VALUES ('u_admin','Christopher Lane','chris@soundpm.test');
    INSERT INTO memberships(id,user_id,account_id,role) VALUES ('m_admin','u_admin','acc1','admin');
    INSERT INTO properties(id,account_id,name,address,city,zip,owner_account_id) VALUES
      ('p1','acc1','North Highland LLC','1620 Belmont Ave','Seattle','98122','acc1');
    INSERT INTO companies(id,company,contact,email,state) VALUES
      ('cmp','Pacific apartment maintenance','Juan Soto','juan@pacific.test','WA');
    INSERT INTO engagements(id,account_id,company_id,status) VALUES ('en','acc1','cmp','active');
  `);
  // SIX INSPECTIONS, each carrying a job in a different state. One fixture,
  // because a rule that answered one word for every row passes a suite built
  // round a single job -- and the states are only meaningful against each
  // other.
  const jobs = [
    // Raised, nobody on it. The state the reported screen could not show.
    ["j_none", {}],
    // Issued, not answered.
    ["j_off", { wo: "pending" }],
    // Accepted, with the job's own date and no window.
    ["j_tgt", { wo: "accepted", date: SOON }],
    // Accepted, window proposed and not settled.
    ["j_prop", { wo: "accepted", visit: "proposed" }],
    // Accepted and booked: the row the request is about.
    ["j_sch", { wo: "accepted", visit: "confirmed" }],
    // Called off.
    ["j_can", { wo: "accepted", ending: "cancelled" }],
    // ACCEPTED, AND THE ONLY WINDOW WAS TURNED DOWN. The one row the status
    // filter alone can be checked against: with a live window beside them the
    // ordering hides a dead one, so dropping the filter changes no outcome
    // there -- the two guards covering for each other, which this project
    // keeps paying for. Here there is nothing live to outrank it, and a job
    // reading "Scheduled" for a morning somebody refused is the worst answer
    // on the list.
    ["j_dead", { wo: "accepted", visit: "declined" }],
    // A LIVE WINDOW WITH A NEWER DEAD ONE BEHIND IT. The declined row is
    // stamped later than the live one, which is what the stale-insert shape
    // above leaves when the newest of two live windows is turned down. Only
    // this row can tell the SQL filter from nothing: with the filter the
    // older live window wins, without it the newest row is the declined one
    // and a real appointment disappears off the list.
    ["j_mixed", { wo: "accepted" }],
    // AND ONE WHOSE ONLY WORK ORDER IS VOIDED, which is what re-assigning and
    // ending a job both leave behind. Nobody is on it, and a count that reads
    // every row says a contractor is.
    ["j_void", { wo: "accepted", voided: true }],
    // PUT ON HOLD AND PICKED BACK UP. `job_endings` is append-only, so a
    // resumed job carries TWO rows and the newest is what it means -- the
    // only row the ordering can be told apart on, since every other job here
    // has at most one. Reversed, the hold wins and work somebody restarted
    // reads as still on hold for ever.
    ["j_back", { wo: "pending", endings: [
      ["deferred", "2026-01-02T00:00:00.000Z"],
      ["resumed", "2026-01-05T00:00:00.000Z"],
    ] }],
  ];
  let n = 0;
  for (const [id, spec] of jobs) {
    n += 1;
    db.exec(`INSERT INTO jobs(id,account_id,property_id,title,status,trades,date,approved_at)
      VALUES ('${id}','acc1','p1','Move-out work ${n}','active','["painting"]',
        ${spec.date ? `'${spec.date}'` : "NULL"}, '2026-01-01')`);
    if (spec.wo) {
      db.exec(`INSERT INTO work_orders(id,job_id,company_id,engagement_id,trade,wo_number,status,voided_at)
        VALUES ('wo_${id}','${id}','cmp','en','painting','WO-${n}','${spec.wo}',
          ${spec.voided ? "'2026-01-03'" : "NULL"})`);
    }
    if (spec.visit) {
      db.exec(`INSERT INTO visits(id,account_id,job_id,status,date,start_time,end_time,proposed_by)
        VALUES ('v_${id}','acc1','${id}','${spec.visit}','${SOON}','09:00','11:00','u_admin')`);
      // A SUPERSEDED PROPOSAL BEHIND IT, because a job collects them and
      // serving one would draw a date nobody agreed to as the appointment.
      db.exec(`INSERT INTO visits(id,account_id,job_id,status,date,start_time,end_time,proposed_by,created_at)
        VALUES ('v_old_${id}','acc1','${id}','superseded','${GONE}','08:00','09:00','u_admin','2020-01-01 00:00:00')`);
      // AND AN OLDER ONE THAT IS STILL LIVE, which the status filter cannot
      // catch and the ordering must. Not a hypothetical shape: the propose
      // route supersedes AFTER it inserts -- deliberately, so a failed insert
      // leaves a stale row rather than no appointment at all -- so two live
      // rows on one job is exactly what a failure there leaves behind.
      //
      // Only beside a window that is itself live: adding one to the
      // declined-only job would give it something live to find and destroy
      // the one row the status filter can be told apart on.
      if (spec.visit !== "declined") {
        db.exec(`INSERT INTO visits(id,account_id,job_id,status,date,start_time,end_time,proposed_by,created_at)
          VALUES ('v_stale_${id}','acc1','${id}','proposed','${GONE}','07:00','08:00','u_admin','2019-01-01 00:00:00')`);
      }
    }
    if (id === "j_mixed") {
      db.exec(`INSERT INTO visits(id,account_id,job_id,status,date,start_time,end_time,proposed_by,created_at)
        VALUES ('v_live_mix','acc1','${id}','proposed','${SOON}','09:00','11:00','u_admin','2026-01-01 00:00:00'),
               ('v_dead_mix','acc1','${id}','declined','${GONE}','07:00','08:00','u_admin','2099-01-01 00:00:00')`);
    }
    if (spec.ending) {
      db.exec(`INSERT INTO job_endings(id,job_id,account_id,kind,note,at,by_user_id)
        VALUES ('e_${id}','${id}','acc1','${spec.ending}','Wrong call','2026-01-02T00:00:00.000Z','u_admin')`);
    }
    for (const [k, when] of spec.endings || []) {
      db.exec(`INSERT INTO job_endings(id,job_id,account_id,kind,at,by_user_id)
        VALUES ('e_${id}_${k}','${id}','acc1','${k}','${when}','u_admin')`);
    }
    db.exec(`INSERT INTO inspections(id,account_id,property_id,kind,unit,inspected_on,status,job_id,created_by)
      VALUES ('i_${id}','acc1','p1','move_out','${n}','${TODAY}','finished','${id}','u_admin')`);
    db.exec(`INSERT INTO inspection_rooms(id,inspection_id,name,status,position)
      VALUES ('r_${id}','i_${id}','Walls and floors','fail',1)`);
  }
  // AND ONE WITH NO JOB AT ALL, so "every row got a chip" is not the thing
  // being asserted.
  db.exec(`INSERT INTO inspections(id,account_id,property_id,kind,unit,inspected_on,status,created_by)
    VALUES ('i_raw','acc1','p1','move_out','99','${TODAY}','finished','u_admin');
    INSERT INTO inspection_rooms(id,inspection_id,name,status,position)
      VALUES ('r_raw','i_raw','Kitchen','ok',1);`);
  return { db, env: { DB: makeD1(db), FILES: { put: async () => {}, get: async () => null } } };
};

const call = (env, path) =>
  worker.fetch(new Request(`https://api.subsub.work${path}`, {
    headers: { "X-User-Id": "u_admin", "X-Account-Id": "acc1" },
  }), env);
const json = async (r) => [r.status, await r.json().catch(() => ({}))];

try {
  console.log("\n-- the list carries it, one state per row --");
  const { db, env } = seed();
  const [s, list] = await json(await call(env, "/api/inspections"));
  ck("the list answers", s === 200 && Array.isArray(list), `${s} ${JSON.stringify(list).slice(0, 120)}`);
  const by = {};
  for (const r of list || []) by[r.id] = r;
  ck("every inspection is on it", Object.keys(by).length === 11, Object.keys(by).join(","));

  ck("a job nobody is on reads as needing a contractor",
    by.i_j_none?.job?.id === "unassigned", JSON.stringify(by.i_j_none?.job));
  ck("an unanswered work order reads as waiting on them",
    by.i_j_off?.job?.id === "offered", JSON.stringify(by.i_j_off?.job));
  ck("a date with no window is a target, and carries the date",
    by.i_j_tgt?.job?.id === "target" && by.i_j_tgt.job.date === SOON,
    JSON.stringify(by.i_j_tgt?.job));
  ck("a proposed window says proposed",
    by.i_j_prop?.job?.id === "proposed" && by.i_j_prop.job.date === SOON,
    JSON.stringify(by.i_j_prop?.job));
  // THE REPORTED ASK, end to end.
  ck("and a booked one says scheduled, for the specific date",
    by.i_j_sch?.job?.id === "scheduled" && by.i_j_sch.job.date === SOON,
    JSON.stringify(by.i_j_sch?.job));
  ck("a cancelled job says cancelled rather than job raised",
    by.i_j_can?.job?.id === "cancelled", JSON.stringify(by.i_j_can?.job));

  // NEITHER OLD ROW MAY WIN, and they are two different guards. The
  // superseded one is caught by the status filter; the older LIVE one can
  // only be caught by the ordering, and a route taking whichever row came
  // back first draws a date from 2019 as the appointment.
  ck("a superseded proposal behind it is not the date drawn",
    by.i_j_sch?.job?.date !== GONE && by.i_j_prop?.job?.date !== GONE,
    `${by.i_j_sch?.job?.date} ${by.i_j_prop?.job?.date}`);
  ck("nor is an older window that is still live",
    by.i_j_sch?.job?.date === SOON && by.i_j_sch?.job?.id === "scheduled",
    JSON.stringify(by.i_j_sch?.job));
  // AND A JOB WHOSE ONLY WINDOW WAS DECLINED HAS NO TIME. Driving to a day
  // somebody refused is worse than having no day at all, and this is the only
  // row the status filter can be told apart on.
  ck("a declined window is not an appointment",
    by.i_j_dead?.job?.id === "taken", JSON.stringify(by.i_j_dead?.job));
  ck("and a live one behind a newer dead one is still the appointment",
    by.i_j_mixed?.job?.id === "proposed" && by.i_j_mixed?.job?.date === SOON,
    JSON.stringify(by.i_j_mixed?.job));
  // A VOIDED WORK ORDER IS NOT A CREW. Re-assigning voids the old row and so
  // does ending a job, so a count that reads every row says somebody is on a
  // unit nobody is coming to.
  ck("a voided work order leaves the job needing a contractor",
    by.i_j_void?.job?.id === "unassigned", JSON.stringify(by.i_j_void?.job));
  ck("a job taken back off hold reads as live work again",
    by.i_j_back?.job?.id === "offered", JSON.stringify(by.i_j_back?.job));

  // AN INSPECTION WITH NO JOB CARRIES NOTHING, so the screen's own `jobId`
  // gate is what decides whether a chip is drawn at all.
  ck("an inspection with no job raised carries no progress",
    !by.i_raw?.jobId && !by.i_raw?.job, JSON.stringify(by.i_raw?.job));

  console.log("\n-- and the detail screen reads the same answer --");
  {
    const [s2, one] = await json(await call(env, "/api/inspections/i_j_sch"));
    ck("the inspection answers", s2 === 200, String(s2));
    // ONE RULE, TWO SCREENS. A second derivation on the detail panel is how
    // the list and the thing it opens come to disagree about one job.
    ck("with the same state the list gave",
      one?.job?.id === by.i_j_sch?.job?.id && one?.job?.date === by.i_j_sch?.job?.date,
      `${JSON.stringify(one?.job)} vs ${JSON.stringify(by.i_j_sch?.job)}`);
  }

  console.log("\n-- another account's job is not readable through it --");
  {
    // The join is scoped to the caller's account as well as to the ids. The
    // ids come off this account's own inspections so nothing can be named
    // from outside, but a query without the clause would answer for a job
    // moved to another account -- which a handover does not do today and
    // which costs one clause to be right about anyway.
    db.exec(`UPDATE jobs SET account_id = 'acc2' WHERE id = 'j_sch'`);
    const [, after] = await json(await call(env, "/api/inspections"));
    const row = (after || []).find((r) => r.id === "i_j_sch");
    ck("a job on another account carries no progress line",
      !!row && !row.job && row.jobId === "j_sch", JSON.stringify(row?.job));
  }

  console.log("\n-- a database behind the code costs the line, never the list --");
  {
    const { db: d2, env: e2 } = seed();
    d2.exec("DROP TABLE job_endings");
    const [s3, rows] = await json(await call(e2, "/api/inspections"));
    // 066's table missing must not blank the screen: the cancelled job reads
    // as live work rather than the whole list refusing.
    ck("the list still lists", s3 === 200 && (rows || []).length === 11,
      `${s3} ${(rows || []).length}`);
    const can = Array.isArray(rows) ? rows.find((r) => r.id === "i_j_can") : null;
    ck("and the row still carries a state, just not the ending",
      can?.job?.id === "offered" || can?.job?.id === "taken" || can?.job?.id === "target",
      JSON.stringify(can?.job));
  }
  {
    const { db: d3, env: e3 } = seed();
    d3.exec("DROP TABLE work_orders");
    const [s4, rows] = await json(await call(e3, "/api/inspections"));
    ck("a missing work-order table does not blank the list either",
      s4 === 200 && (rows || []).length === 11, `${s4} ${(rows || []).length}`);
  }
} catch (e) {
  fail += 1;
  console.log("FAIL  the run itself  --", e?.message || e);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
