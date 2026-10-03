// EDITING A JOB THAT ALREADY EXISTS.
//
// Asked for as: *"when you click on a job card it should open to edit, so the
// entire job can be edited and saved"*.
//
// `PATCH /api/jobs/:id` took four fields -- notes, measurement docs, the
// property and 060's access answer -- so everything somebody typed on the
// create form was typed once and frozen: a job name with a street spelt
// wrong, a square footage, a trade nobody needed, the materials line. The only
// way to correct any of it was to close the job out and raise another one,
// which loses the work orders, the visit and the history. The fourteenth
// no-way-in in CLAUDE.md, and the one on the object this product is about.
//
// What this pins:
//
//   ONLY THE KEYS SENT ARE WRITTEN. A form that edits part of a record must
//   not replace the whole of it -- the shape that once deleted a W-9 through
//   `SubForm`. Checked on the columns this form does not know about: the
//   photos, the report detail, the severity, the access answer and the notes.
//
//   A TRADE SOMEBODY IS ALREADY BOOKED FOR CANNOT BE TAKEN OFF. The work
//   order would point at a slot the job no longer has -- invisible on every
//   screen, and a contractor who still turns up. Refused BY NAME, so the form
//   can say which, rather than quietly kept.
//
//   AND A VOIDED ONE IS NOT A BOOKING. Re-assigning voids the old row, and a
//   trade nobody holds any more has to be droppable or a mis-assignment is
//   permanent.
//
//   AN EMPTY TITLE IS REFUSED, because the column is NOT NULL and a job with
//   no name is a row nobody finds again.
//
//   THE MATERIALS LINE IS COMPOSED BY THE SERVER, never taken from the
//   request: what a contractor reads on a work order should be something the
//   shared supplier list produced.
//
//   THE JOB FLOATS. 025 added `updated_at` so a job being worked on rises up
//   the list, and a route that changes the job and not the column leaves the
//   edit somewhere nobody scrolls to.
//
//   IT IS SCOPED BOTH WAYS. Another account's job id writes nothing and
//   answers not_found, and 053's job scope is checked BEFORE anything is
//   written -- checking afterwards would 404 a write that had happened.
//
//   node --no-warnings scripts/job-edit-test.mjs

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");
const SCHEMA = readFileSync(join(app, "worker", "schema.sql"), "utf8");

const seed = () => {
  const db = freshDb({ base: SCHEMA, migrations: [] });
  db.exec(`
    INSERT INTO accounts(id,name,kind,subdomain,plan) VALUES
      ('acc_pm','Sound Property Management','property_manager','soundpm','scale'),
      ('acc_other','Cascade Management','property_manager','cascade','basic');
    INSERT INTO users(id,name,email) VALUES
      ('u_mgr','Chris Lane','chris@soundpm.test'),
      ('u_pm','Dev Patel','dev@soundpm.test'),
      ('u_ten','John Smith','john@tenant.test');
    INSERT INTO properties(id,account_id,name,address,city,state,zip) VALUES
      ('prop_1','acc_pm','Press Apartments','1620 Belmont','Seattle','WA','98122'),
      ('prop_x','acc_other','Elliott Court','90 Elliott','Seattle','WA','98121');
    INSERT INTO memberships(id,user_id,account_id,role) VALUES
      ('m_mgr','u_mgr','acc_pm','admin'),
      ('m_pm','u_pm','acc_pm','pm'),
      ('m_ten','u_ten','acc_pm','tenant');
    INSERT INTO companies(id,company,contact,email,state) VALUES
      ('cmp_1','Pacific apartment maintenance','Juan Soto','juan@pacific.test','WA');
    INSERT INTO engagements(id,account_id,company_id,status) VALUES
      ('en_1','acc_pm','cmp_1','active');

    -- THE JOB UNDER TEST. Every column the form does not know about is filled
    -- in, because "only the keys sent are written" is only checkable against
    -- a row that has something to lose.
    INSERT INTO jobs(id,account_id,property_id,title,client,address,area,zip,
                     sqft,stories,date,time,trades,scope,
                     material_source,material_supplier,material_branch,materials_paid_by,
                     notes,photos,report_detail,severity,access,requested_by,approved_at,
                     status,created_at)
      VALUES ('job_1','acc_pm','prop_1','Press Apartments - leaking sink','Acme',
              '1620 Belmont','Seattle','98122',900,3,'2026-10-06','11:00',
              '["plumbing","roofing"]','Sink in unit 12',
              'ABC Supply - Ballard','abc','Ballard','Sound Property Management',
              'spoke to the tenant','["ph_1.jpg"]','{"problem":"leak","unit":"12"}',
              'urgent','tenant','u_ten','2026-10-01','active','2026-10-01');

    -- A LIVE WORK ORDER ON ONE OF THE TWO TRADES. The only row the
    -- cannot-drop-a-booked-trade rule can be told apart on.
    INSERT INTO work_orders(id,job_id,company_id,engagement_id,trade,wo_number,status)
      VALUES ('wo_1','job_1','cmp_1','en_1','plumbing','WO-100100','accepted');

    -- Another account's job, for the scoping check. A job id that exists
    -- nowhere would be refused by the WHERE clause whatever the scoping said,
    -- which is the two-guards-covering-for-each-other shape.
    INSERT INTO jobs(id,account_id,property_id,title,trades,status,created_at)
      VALUES ('job_theirs','acc_other','prop_x','Their boiler','["hvac"]','active','2026-10-01');
  `);
  return { db, env: { DB: makeD1(db) } };
};

const patch = (env, path, body, who = "u_mgr") => worker.fetch(
  new Request(`https://api.subsub.work${path}`, {
    method: "PATCH", body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", "X-User-Id": who, "X-Account-Id": "acc_pm" },
  }), env);
const json = async (r) => [r.status, await r.json().catch(() => ({}))];
const jobOf = (db, id) => db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(id);

try {
  console.log("\n-- the whole job can be edited --");
  {
    const { db, env } = seed();
    const [s, b] = await json(await patch(env, "/api/jobs/job_1", {
      title: "Press Apartments - leaking sink and basin",
      client: "Acme Holdings", address: "1622 Belmont", area: "Seattle", zip: "98122",
      sqft: "1200", stories: "4", date: "2026-10-09", time: "13:00",
      trades: ["plumbing", "roofing", "painting"], scope: "Sink and basin in unit 12",
    }));
    ck("it saves", s === 200 && b.ok === true, `${s} ${JSON.stringify(b)}`);
    const j = jobOf(db, "job_1");
    ck("the name is changed", j.title === "Press Apartments - leaking sink and basin", j.title);
    ck("the address is changed", j.address === "1622 Belmont", j.address);
    ck("the client is changed", j.client === "Acme Holdings", j.client);
    // Typed as text on the form and stored as an integer.
    ck("square footage is a number", j.sqft === 1200, String(j.sqft));
    ck("stories is a number", j.stories === 4, String(j.stories));
    ck("the date is changed", j.date === "2026-10-09", String(j.date));
    ck("the time is changed", j.time === "13:00", String(j.time));
    ck("a trade is added", JSON.parse(j.trades).includes("painting"), j.trades);
    ck("the scope is changed", j.scope === "Sink and basin in unit 12", j.scope);
  }

  console.log("\n-- and nothing the form does not know about is touched --");
  {
    const { db, env } = seed();
    await patch(env, "/api/jobs/job_1", { title: "Renamed", trades: ["plumbing"] });
    const j = jobOf(db, "job_1");
    // A form that edits part of a record must not replace the whole of it.
    // These are the columns a W-9 was once deleted through, one object over.
    ck("the photos survive", j.photos === '["ph_1.jpg"]', String(j.photos));
    ck("the report detail survives", /"unit":"12"/.test(j.report_detail || ""), String(j.report_detail));
    ck("the severity survives", j.severity === "urgent", String(j.severity));
    ck("the access answer survives", j.access === "tenant", String(j.access));
    ck("the notes survive", j.notes === "spoke to the tenant", String(j.notes));
    ck("who asked survives", j.requested_by === "u_ten", String(j.requested_by));
    ck("the materials line survives", j.material_source === "ABC Supply - Ballard", String(j.material_source));
  }

  console.log("\n-- a trade somebody is booked for cannot be taken off --");
  {
    const { db, env } = seed();
    const [s, b] = await json(await patch(env, "/api/jobs/job_1", { trades: ["roofing"] }));
    ck("it is refused", s === 409 && b.error === "trade_has_work_order", `${s} ${JSON.stringify(b)}`);
    // Named, so the form can say WHICH -- a refusal somebody cannot act on is
    // the same dead end as no refusal at all.
    ck("and names the trade", Array.isArray(b.trades) && b.trades.includes("plumbing"),
      JSON.stringify(b.trades));
    // Refused rather than quietly kept: a save that reports success and
    // writes nothing is how somebody re-types the same correction three times.
    ck("and nothing else was written either",
      JSON.parse(jobOf(db, "job_1").trades).join() === "plumbing,roofing",
      jobOf(db, "job_1").trades);
  }
  {
    // THE OTHER DIRECTION: the trade nobody holds IS droppable, or this rule
    // would read as "trades are frozen once anybody is on the job".
    const { db, env } = seed();
    const [s] = await json(await patch(env, "/api/jobs/job_1", { trades: ["plumbing"] }));
    ck("the unbooked trade comes off", s === 200
      && JSON.parse(jobOf(db, "job_1").trades).join() === "plumbing",
      jobOf(db, "job_1").trades);
  }
  {
    // AND A VOIDED WORK ORDER IS NOT A BOOKING. Re-assigning voids the old
    // row, so counting one would make a mis-assignment permanent.
    const { db, env } = seed();
    db.exec(`UPDATE work_orders SET voided_at = '2026-10-03' WHERE id = 'wo_1'`);
    const [s] = await json(await patch(env, "/api/jobs/job_1", { trades: ["roofing"] }));
    ck("a voided work order does not hold a trade", s === 200
      && JSON.parse(jobOf(db, "job_1").trades).join() === "roofing",
      `${s} ${jobOf(db, "job_1").trades}`);
  }

  console.log("\n-- what it refuses, by name --");
  {
    const { db, env } = seed();
    const [s, b] = await json(await patch(env, "/api/jobs/job_1", { title: "   " }));
    ck("an empty name is refused", s === 400 && b.error === "title_required", `${s} ${JSON.stringify(b)}`);
    ck("and the name is untouched", jobOf(db, "job_1").title.startsWith("Press"), jobOf(db, "job_1").title);
  }
  {
    const { env } = seed();
    const [s, b] = await json(await patch(env, "/api/jobs/job_1", { trades: [] }));
    ck("no trades at all is refused", s === 400 && b.error === "trades_required", `${s} ${JSON.stringify(b)}`);
  }
  {
    const { env } = seed();
    const [s, b] = await json(await patch(env, "/api/jobs/job_1", { date: "6 Oct" }));
    ck("a date that is not a date is refused", s === 400 && b.error === "bad_date", `${s} ${JSON.stringify(b)}`);
  }
  {
    const { env } = seed();
    const [s, b] = await json(await patch(env, "/api/jobs/job_1", { time: "25:00" }));
    ck("a time that is not a time is refused", s === 400 && b.error === "bad_time", `${s} ${JSON.stringify(b)}`);
  }
  {
    // A trade id nothing recognises is dropped rather than stored: the column
    // is read by every screen as a list of slots, and one nothing can draw is
    // a slot nobody can fill.
    const { db, env } = seed();
    await patch(env, "/api/jobs/job_1", { trades: ["plumbing", "roofing", "not_a_trade"] });
    ck("an unknown trade is dropped",
      !JSON.parse(jobOf(db, "job_1").trades).includes("not_a_trade"), jobOf(db, "job_1").trades);
  }

  console.log("\n-- the materials line is composed here, never sent --");
  {
    const { db, env } = seed();
    await patch(env, "/api/jobs/job_1", {
      materialSupplier: "abc", materialBranch: "Georgetown",
      // What a contractor reads on a work order must be something the shared
      // supplier list produced, not whatever a client sent.
      materialSource: "FREE TEXT NOBODY TYPED",
    });
    const j = jobOf(db, "job_1");
    ck("the sent line is ignored", !/FREE TEXT/.test(j.material_source || ""), String(j.material_source));
    ck("and the branch is in the composed one", /Georgetown/.test(j.material_source || ""),
      String(j.material_source));
    ck("the supplier id is stored", j.material_supplier === "abc", String(j.material_supplier));
  }
  {
    // A supplier id the shared list does not know is not a supplier.
    const { db, env } = seed();
    await patch(env, "/api/jobs/job_1", { materialSupplier: "not_a_supplier", materialSource: "" });
    ck("an unknown supplier stores none", jobOf(db, "job_1").material_supplier === null,
      String(jobOf(db, "job_1").material_supplier));
  }

  console.log("\n-- the job floats, because somebody just worked on it --");
  {
    const { db, env } = seed();
    ck("it had no activity stamp", jobOf(db, "job_1").updated_at === null,
      String(jobOf(db, "job_1").updated_at));
    await patch(env, "/api/jobs/job_1", { title: "Renamed again" });
    ck("and now it has one", !!jobOf(db, "job_1").updated_at,
      String(jobOf(db, "job_1").updated_at));
  }
  {
    // Nothing sent is not an edit, so it must not float the job either.
    const { db, env } = seed();
    const [s] = await json(await patch(env, "/api/jobs/job_1", {}));
    ck("an empty body changes nothing", s === 200 && jobOf(db, "job_1").updated_at === null,
      `${s} ${jobOf(db, "job_1").updated_at}`);
  }

  console.log("\n-- scoped both ways --");
  {
    const { db, env } = seed();
    const [s, b] = await json(await patch(env, "/api/jobs/job_theirs", { title: "Mine now" }));
    ck("another account's job is not found", s === 404 && b.error === "job_not_found",
      `${s} ${JSON.stringify(b)}`);
    ck("and is untouched", jobOf(db, "job_theirs").title === "Their boiler",
      jobOf(db, "job_theirs").title);
  }
  {
    // 053's job scope. The pm is narrowed to a job that is NOT this one, so
    // only the scope can keep them out -- the account clause lets them
    // through, which is the two-guards-covering-for-each-other shape.
    const { db, env } = seed();
    db.exec(`
      INSERT INTO jobs(id,account_id,title,trades,status,created_at)
        VALUES ('job_2','acc_pm','Another job','["hvac"]','active','2026-10-01');
      INSERT INTO membership_jobs(membership_id,job_id) VALUES ('m_pm','job_2');
    `);
    const [s, b] = await json(await patch(env, "/api/jobs/job_1", { title: "Not mine" }, "u_pm"));
    // NOT FOUND, NEVER FORBIDDEN, which is 053's own rule: a 403 on a real
    // job beside a 404 on an invented one lets a narrowed manager walk the
    // account's whole job list one guess at a time. The refusal comes from
    // the middleware that resolves a job for every route that takes one --
    // which is where that scope belongs, so the route's own `maySeeJob` is
    // defence in depth and this assertion does not distinguish the two.
    ck("a scoped project manager is refused", s === 404
      && /not_found$/.test(String(b.error)), `${s} ${JSON.stringify(b)}`);
    // BEFORE anything is written. Checking afterwards would 404 a write that
    // had already happened, which is the worst of the three answers.
    ck("and the job is untouched", jobOf(db, "job_1").title.startsWith("Press"),
      jobOf(db, "job_1").title);
    const [s2] = await json(await patch(env, "/api/jobs/job_2", { title: "This one is mine" }, "u_pm"));
    ck("and may edit the job they are scoped to", s2 === 200
      && jobOf(db, "job_2").title === "This one is mine", `${s2} ${jobOf(db, "job_2").title}`);
  }
  {
    // A tenant is on this account and is not somebody who edits jobs.
    const { db, env } = seed();
    const [s] = await json(await patch(env, "/api/jobs/job_1", { title: "Tenant edit" }, "u_ten"));
    ck("a tenant cannot edit a job", s === 403 && jobOf(db, "job_1").title.startsWith("Press"),
      `${s} ${jobOf(db, "job_1").title}`);
  }

  console.log("\n-- and the trail says it happened --");
  {
    const { db, env } = seed();
    await patch(env, "/api/jobs/job_1", { title: "Renamed for the record" });
    const row = db.prepare(`SELECT * FROM activity WHERE account_id = 'acc_pm' AND kind = 'job_edited'`).get();
    ck("an edit is recorded", !!row, JSON.stringify(row || null));
    ck("against the person who made it", row?.user_id === "u_mgr", String(row?.user_id));
  }
} catch (err) {
  fail++; console.log("FAIL  threw:", err?.stack || err);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
