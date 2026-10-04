// MOVING A JOB'S DATE ASKS THE PEOPLE WHO HAVE TO BE THERE.
//
// Reported with two screenshots of the same job. The manager had changed its
// date; the handyman's own portal read **"Target date. The date on the job. No
// visit time has been agreed"** over that date -- *"it should have showed an
// accept or decline option when I updated it from the property manager
// side."*
//
// `PATCH /api/jobs/:id` wrote `jobs.date` and `jobs.time` and stopped. The
// crew's card was reading the row correctly: there was no live visit, because
// nothing had proposed one. And the edit form carried a sentence SAYING so --
// *"changing the date here changes the date on the job"* -- which is why it
// went unnoticed for as long as it did: the screen and the server agreed with
// each other about a behaviour nobody wanted.
//
// What is pinned here is the handful of decisions a later pass would undo:
//
//   ONLY WHEN THERE IS SOMEBODY BUT US TO ASK. A crew who has ACCEPTED, or a
//   tenant who has to be in. On a job with nobody on it the date is a target
//   and proposing one would draw "Confirmed. Agreed by everybody who has to be
//   there" over work nobody is booked for.
//
//   ACCEPTED, NOT MERELY ASSIGNED, which is the same line `partiesFor` draws:
//   somebody who has not said yes to the JOB cannot be waited on for the TIME.
//
//   ONLY WHEN IT MOVED. Re-saving the same date is not a reschedule, and
//   asking a crew to re-confirm a day they already agreed to is exactly the
//   round trip 064's chain is ordered to avoid.
//
//   THROUGH THE REAL ROUTE, so every gate it carries applies -- and an
//   unapproved request still gets nothing.
//
//   AND THE INSERT COMES BEFORE THE SUPERSEDE. The two are not a transaction,
//   so the old order lost the appointment entirely whenever the insert failed.
//
//   node --no-warnings scripts/job-reschedule-test.mjs

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";
import { windowEnd, othersMustAgree, WINDOW_MINS } from "../shared/schedule.js";

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");
const SCHEMA = readFileSync(join(app, "worker", "schema.sql"), "utf8");

// FIVE JOBS, AND EACH IS A BRANCH THE OTHERS CANNOT SHOW.
const seed = (extra = "") => {
  const db = freshDb({ base: SCHEMA, migrations: [] });
  db.exec(`
    INSERT INTO accounts(id,name,kind,subdomain,plan) VALUES
      ('acc_pm','Sound Property Management','property_manager','soundpm','scale');
    INSERT INTO users(id,name,email) VALUES
      ('u_mgr','Chris Lane','chris@soundpm.test'),
      ('u_ten','John Smith','john@tenant.test');
    INSERT INTO companies(id,company,contact,email,state) VALUES
      ('cmp_pac','Pacific apartment maintenance','Juan Soto','juan@pacific.test','WA');
    INSERT INTO engagements(id,account_id,company_id,status,categories) VALUES
      ('en_pac','acc_pm','cmp_pac','active','["plumbing"]');
    INSERT INTO properties(id,account_id,name,address,city,state,zip) VALUES
      ('prop_1','acc_pm','Press Apartments','1620 Belmont','Seattle','WA','98122');
    INSERT INTO memberships(id,user_id,account_id,role) VALUES
      ('m_ten','u_ten','acc_pm','tenant'),
      ('m_mgr','u_mgr','acc_pm','admin');
    INSERT INTO membership_properties(membership_id,property_id) VALUES ('m_ten','prop_1');

    -- THE REPORTED ONE. A crew has ACCEPTED it, and the access answer takes
    -- the tenant out of the loop -- which is what the screenshot showed, so
    -- the only party left to ask is the company that turns up.
    INSERT INTO jobs(id,account_id,property_id,title,trades,status,date,time,access,approved_at,created_at)
      VALUES ('job_live','acc_pm','prop_1','Press Apartments - leaking sink','["plumbing"]','active',
              '2026-10-07','11:30','none','2026-10-01','2026-10-01');
    INSERT INTO work_orders(id,job_id,company_id,engagement_id,trade,wo_number,status)
      VALUES ('wo_live','job_live','cmp_pac','en_pac','plumbing','WO-745746','accepted');

    -- THE SAME SHAPE WITH A PENDING WORK ORDER. Somebody who has not said yes
    -- to the job cannot be waited on for the time, so this must NOT ask -- and
    -- it is the only row that tells "accepted" from "assigned".
    INSERT INTO jobs(id,account_id,property_id,title,trades,status,date,access,approved_at,created_at)
      VALUES ('job_pend','acc_pm','prop_1','Rewire unit 12','["plumbing"]','active',
              '2026-10-07','none','2026-10-01','2026-10-01');
    INSERT INTO work_orders(id,job_id,company_id,engagement_id,trade,wo_number,status)
      VALUES ('wo_pend','job_pend','cmp_pac','en_pac','plumbing','WO-000002','pending');

    -- NOBODY ON IT AT ALL. The date is a target and saying so is the honest
    -- answer, which is what this route has always done.
    INSERT INTO jobs(id,account_id,property_id,title,trades,status,date,access,approved_at,created_at)
      VALUES ('job_bare','acc_pm','prop_1','Repaint hallway','["painting"]','active',
              '2026-10-07','none','2026-10-01','2026-10-01');

    -- A TENANT'S OWN REPORT, nobody assigned. There IS somebody to ask and it
    -- is not a contractor, which is the only row that can show the predicate
    -- is the parties rather than "has a crew".
    INSERT INTO jobs(id,account_id,property_id,title,trades,status,date,requested_by,approved_at,created_at)
      VALUES ('job_ten','acc_pm','prop_1','Bathroom extractor','["electrical"]','active',
              '2026-10-07','u_ten','2026-10-01','2026-10-01');

    -- AN UNAPPROVED REQUEST. Scheduling one would book work nobody has agreed
    -- to do, and the real route is what refuses it.
    INSERT INTO jobs(id,account_id,property_id,title,trades,status,date,requested_by,created_at)
      VALUES ('job_req','acc_pm','prop_1','Repaint the lobby','["painting"]','active',
              '2026-10-07','u_ten','2026-10-01');
    ${extra}
  `);
  return { db, env: { DB: makeD1(db) } };
};

const patch = (env, id, body, who = "u_mgr") => worker.fetch(
  new Request(`https://api.subsub.work/api/jobs/${id}`, {
    method: "PATCH", body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", "X-User-Id": who, "X-Account-Id": "acc_pm" },
  }), { ...env });
const json = async (r) => [r.status, await r.json().catch(() => ({}))];
const live = (db, jobId) => db.prepare(
  `SELECT * FROM visits WHERE job_id = ? AND status IN ('proposed','confirmed')
    ORDER BY created_at DESC, rowid DESC`).all(jobId);
const jobOf = (db, id) => db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(id);

try {
  console.log("\n-- the rule, before anything is driven --");
  {
    // `visitParties` always carries the hiring side on a 064 database, so a
    // list of just `manager` settles the moment it is written and tells
    // nobody. That is the case this predicate exists to exclude.
    ck("the hiring side alone is nobody to ask", !othersMustAgree(["manager"]));
    ck("a crew is somebody", othersMustAgree(["contractor", "manager"]));
    ck("and so is a tenant", othersMustAgree(["manager", "tenant"]));
    ck("nobody at all is nobody", !othersMustAgree([]) && !othersMustAgree(null));
    // KEEPS THE LENGTH SOMEBODY ALREADY CHOSE, which is the whole reason this
    // takes the old window rather than always answering an hour.
    ck("a window keeps its length when it moves",
      windowEnd("09:00", "11:00", "13:15") === "11:15", String(windowEnd("09:00", "11:00", "13:15")));
    ck("and is an hour when there is nothing to keep",
      windowEnd("09:00") === "10:00" && WINDOW_MINS === 60, String(windowEnd("09:00")));
    ck("clamped to the end of the day", windowEnd("23:30") === "23:59", String(windowEnd("23:30")));
    ck("and null with no start, rather than a window out of nowhere",
      windowEnd("") === null && windowEnd(null) === null);
  }

  console.log("\n-- the reported case: moving the date asks the crew --");
  {
    const { db, env } = seed();
    const [s, body] = await json(await patch(env, "job_live", { date: "2026-10-20", time: "11:30" }));
    ck("the edit lands", s === 200, String(s));
    // THE SYMPTOM IN THE SCREENSHOT: no live visit, so the crew's own card
    // read "Target date. No visit time has been agreed".
    const vs = live(db, "job_live");
    ck("and a window is proposed for it", vs.length === 1, JSON.stringify(vs.map((v) => v.status)));
    ck("on the new date", vs[0]?.date === "2026-10-20", String(vs[0]?.date));
    ck("carrying the time somebody typed", vs[0]?.start_time === "11:30", String(vs[0]?.start_time));
    ck("and an hour's window off it", vs[0]?.end_time === "12:30", String(vs[0]?.end_time));
    // THE CREW HAS TO ANSWER IT. Proposing is agreeing for whoever proposed,
    // so the hiring side's leg is stamped and the contractor's is not -- which
    // is what puts the accept/decline pair on their card.
    ck("the crew has not answered it", !vs[0]?.contractor_at, String(vs[0]?.contractor_at));
    ck("so it is not booked yet", vs[0]?.status === "proposed", String(vs[0]?.status));
    ck("and the hiring side agreed by asking", !!vs[0]?.manager_at, String(vs[0]?.manager_at));
    // SAID ON THE REPLY rather than left for the screen to guess, so a manager
    // can be told who was asked instead of assuming somebody was.
    ck("the reply says who was asked",
      Array.isArray(body?.rescheduled?.asked) && body.rescheduled.asked.includes("contractor"),
      JSON.stringify(body?.rescheduled));
    ck("and not the hiring side, who agreed by asking",
      !(body?.rescheduled?.asked || []).includes("manager"), JSON.stringify(body?.rescheduled));
    // The target date moved too: that is what the manager typed, and the
    // visit is the ask about it.
    ck("the job keeps the new target date", jobOf(db, "job_live").date === "2026-10-20",
      String(jobOf(db, "job_live").date));
  }

  console.log("\n-- and a time-only change is a reschedule too --");
  {
    const { db, env } = seed();
    await patch(env, "job_live", { date: "2026-10-07", time: "14:00" });
    const vs = live(db, "job_live");
    // Moving 11:30 to 2pm on the same day is moving the appointment. A check
    // on the date alone passes with this silently dropped.
    ck("moving the hour asks as well", vs.length === 1 && vs[0].start_time === "14:00",
      JSON.stringify(vs.map((v) => `${v.date} ${v.start_time}`)));
  }

  console.log("\n-- re-saving the same date asks nobody --");
  {
    const { db, env } = seed();
    const [, body] = await json(await patch(env, "job_live",
      { date: "2026-10-07", time: "11:30", title: "Press Apartments - leaking sink" }));
    // A save that resends the date it already had is not a reschedule, and
    // asking a crew to re-confirm a day they agreed to is the round trip the
    // chain is ordered to avoid. Only a fixture whose stored date EQUALS the
    // one sent can tell this from "always propose".
    ck("no window is proposed", live(db, "job_live").length === 0,
      JSON.stringify(live(db, "job_live")));
    ck("and the reply says nothing was asked", !body?.rescheduled,
      JSON.stringify(body?.rescheduled));
  }
  {
    const { db, env } = seed();
    await patch(env, "job_live", { title: "Leaking sink, unit 3B" });
    // An edit that does not touch the date at all. The commonest save there
    // is, and the one a blanket rule would turn into an ask.
    ck("editing the title alone asks nobody", live(db, "job_live").length === 0,
      JSON.stringify(live(db, "job_live")));
    ck("and still saves", jobOf(db, "job_live").title === "Leaking sink, unit 3B",
      jobOf(db, "job_live").title);
  }

  console.log("\n-- a job with nobody to ask keeps a plain target date --");
  {
    const { db, env } = seed();
    const [s, body] = await json(await patch(env, "job_bare", { date: "2026-10-20" }));
    ck("the edit lands", s === 200, String(s));
    // Proposing here would draw "Confirmed. Agreed by everybody who has to be
    // there" over a job nobody is booked for -- the screen-that-lies rule on
    // the one line a contractor reads to decide whether to get in the van.
    ck("no window is invented", live(db, "job_bare").length === 0,
      JSON.stringify(live(db, "job_bare")));
    ck("the date moves anyway", jobOf(db, "job_bare").date === "2026-10-20",
      String(jobOf(db, "job_bare").date));
    ck("and nothing claims anybody was asked", !body?.rescheduled, JSON.stringify(body?.rescheduled));
  }
  {
    const { db, env } = seed();
    await patch(env, "job_pend", { date: "2026-10-20" });
    // ACCEPTED, NOT MERELY ASSIGNED. A rule reading "any live work order"
    // passes every assertion above and fails here.
    ck("an unanswered work order is nobody to ask either",
      live(db, "job_pend").length === 0, JSON.stringify(live(db, "job_pend")));
  }

  console.log("\n-- a tenant who has to be in is somebody to ask --");
  {
    const { db, env } = seed();
    const [, body] = await json(await patch(env, "job_ten", { date: "2026-10-20" }));
    // Nobody is assigned, so a rule written as "has a crew" asks nobody here.
    // The predicate is the PARTIES, which is what this row proves.
    const vs = live(db, "job_ten");
    ck("a window is proposed with no crew on the job", vs.length === 1,
      JSON.stringify(vs.map((v) => v.status)));
    ck("and it waits on the tenant", vs[0]?.status === "proposed" && !vs[0]?.responded_at,
      `${vs[0]?.status} ${vs[0]?.responded_at}`);
    ck("who the reply names", (body?.rescheduled?.asked || []).includes("tenant"),
      JSON.stringify(body?.rescheduled));
  }

  console.log("\n-- through the real route, so its gates still apply --");
  {
    const { db, env } = seed();
    const [s, body] = await json(await patch(env, "job_req", { date: "2026-10-20" }));
    // An unapproved request is not a job yet. The propose route refuses it,
    // and this path must not be a way round that -- which is the whole reason
    // it calls the route rather than writing its own insert.
    ck("an unapproved request gets no window", live(db, "job_req").length === 0,
      JSON.stringify(live(db, "job_req")));
    // AND THE EDIT ITSELF STANDS. Refusing the save because the ask failed
    // would be a save that reports failure over a write that happened.
    ck("the edit still lands", s === 200 && jobOf(db, "job_req").date === "2026-10-20",
      `${s} ${jobOf(db, "job_req").date}`);
    ck("and the refusal is reported rather than swallowed",
      body?.rescheduled?.error === "not_approved", JSON.stringify(body?.rescheduled));
  }

  console.log("\n-- the window somebody agreed to keeps its length --");
  {
    const { db, env } = seed(`
      INSERT INTO visits(id,account_id,job_id,proposed_by,date,start_time,end_time,status,contractor_at,manager_at,created_at)
        VALUES ('v_old','acc_pm','job_live','u_mgr','2026-10-07','11:00','13:15','confirmed',
                '2026-10-02T09:00:00.000Z','2026-10-02T09:00:00.000Z','2026-10-02T09:00:00.000Z');
    `);
    await patch(env, "job_live", { date: "2026-10-20", time: "09:00" });
    const vs = live(db, "job_live");
    // A 2h15m slot moved to the morning is still 2h15m. An hour's default
    // here would quietly shorten every appointment anybody reschedules.
    ck("the new window is the same length", vs[0]?.end_time === "11:15", String(vs[0]?.end_time));
    // EXACTLY ONE LIVE VISIT. Two would leave the card drawing whichever
    // sorted first -- the old agreed morning or the new proposal.
    ck("and there is one live visit, not two", vs.length === 1,
      JSON.stringify(vs.map((v) => `${v.id}:${v.status}`)));
    ck("the old one is superseded",
      db.prepare(`SELECT status FROM visits WHERE id = 'v_old'`).get().status === "superseded",
      db.prepare(`SELECT status FROM visits WHERE id = 'v_old'`).get().status);
  }

  console.log("\n-- a failed propose does not take the appointment with it --");
  {
    // THE INSERT RUNS BEFORE THE SUPERSEDE, and the two are not a transaction.
    // In the old order a failed insert left the job with NO live visit at all
    // -- the appointment gone and a refusal on screen that reads as nothing
    // having happened, which is exactly what the reported card looked like.
    //
    // Driven with a trigger that refuses every INSERT on `visits` and leaves
    // UPDATE alone, because that is the one way to make the second statement
    // fail deterministically without a broken schema.
    const { db, env } = seed(`
      INSERT INTO visits(id,account_id,job_id,proposed_by,date,start_time,end_time,status,contractor_at,manager_at,created_at)
        VALUES ('v_old','acc_pm','job_live','u_mgr','2026-10-07','11:00','13:15','confirmed',
                '2026-10-02T09:00:00.000Z','2026-10-02T09:00:00.000Z','2026-10-02T09:00:00.000Z');
    `);
    db.exec(`CREATE TRIGGER no_new_visit BEFORE INSERT ON visits
               BEGIN SELECT RAISE(ABORT, 'refused'); END;`);
    const [s] = await json(await patch(env, "job_live", { date: "2026-10-20", time: "09:00" }));
    const vs = live(db, "job_live");
    ck("the appointment survives a refused propose", vs.length === 1 && vs[0].id === "v_old",
      JSON.stringify(vs.map((v) => `${v.id}:${v.status}`)));
    ck("still agreed, rather than quietly taken down", vs[0]?.status === "confirmed",
      String(vs[0]?.status));
    ck("and the edit itself is not lost", s === 200 && jobOf(db, "job_live").date === "2026-10-20",
      `${s} ${jobOf(db, "job_live").date}`);
  }

  console.log("\n-- a refused edit asks nobody either --");
  {
    const { db, env } = seed(`
      INSERT INTO users(id,name,email) VALUES ('u_pm2','Narrow Nell','nell@soundpm.test');
      INSERT INTO memberships(id,user_id,account_id,role) VALUES ('m_pm2','u_pm2','acc_pm','pm');
      INSERT INTO membership_jobs(membership_id,job_id) VALUES ('m_pm2','job_bare');
    `);
    // 053's job scope runs BEFORE anything is written, and the propose hangs
    // off the write -- so a seat narrowed away from this job must leave it
    // with no window as well as no edit. `not_found` rather than `forbidden`,
    // which is the refusal that stops a job list being walked one guess at a
    // time.
    const [s, body] = await json(await patch(env, "job_live", { date: "2026-10-20" }, "u_pm2"));
    ck("a narrowed project manager is refused", s === 404, String(s));
    ck("the date does not move", jobOf(db, "job_live").date === "2026-10-07",
      String(jobOf(db, "job_live").date));
    ck("and nothing was proposed", live(db, "job_live").length === 0,
      JSON.stringify(live(db, "job_live")));
    // THE SAME SEAT ON A JOB IT IS ON. A fix that refused everybody passes
    // every assertion above -- the diagonal coverage this project keeps
    // paying for.
    const [s2] = await json(await patch(env, "job_bare", { date: "2026-10-20" }, "u_pm2"));
    ck("but may still edit the job it is scoped to",
      s2 === 200 && jobOf(db, "job_bare").date === "2026-10-20",
      `${s2} ${jobOf(db, "job_bare").date} ${JSON.stringify(body)}`);
  }
} catch (e) {
  fail++; console.log("FAIL  the suite threw  -- " + String(e?.stack || e));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
