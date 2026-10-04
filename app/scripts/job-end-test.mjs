// THE THREE WAYS A JOB ENDS WITHOUT RECORDING THAT WORK WAS DONE.
//
// Asked for as: *"A job should be able to be cancelled or deferred if needed
// for some reason - maybe it's an inaccurate assessment of what the issue was
// etc. maybe we have something 'complete, no work done'"*.
//
// A job arrives through FOUR doors and left through ONE: *Mark job complete*.
// `DELETE /api/jobs/:id` does not exist, `withdraw` is the requester's own
// move and most jobs have no requester, and `decline` answers `not_a_request`
// on anything approved. So tidying anything up meant recording that work had
// happened -- on a product whose payment ledger hangs off exactly that.
//
// Migration 066, `job_endings`, `app/shared/jobstate.js`. What this pins:
//
//   CANCEL, HOLD AND NO-WORK ALL STAND EVERYBODY DOWN. Live work orders are
//   voided, the open window is superseded and open quote requests are
//   cancelled -- because a crew expecting Tuesday is a crew that turns up,
//   and that is as true of a hold as of a cancellation.
//
//   MONEY IS THE HARD BOUNDARY AND IT IS NOT OVERRIDABLE. Once a funding has
//   landed, cancelling is a refund question. A HOLD is deliberately exempt:
//   putting work off spends nothing.
//
//   NOTHING IS PAYABLE AGAINST AN ENDED JOB, through settle AND pay -- two
//   routes on purpose, so a gate on one is a door round it. `no_work` writes
//   `status = 'completed'`, which is exactly the state a release is normally
//   paid against, so without this it would be the MOST payable a job ever
//   gets.
//
//   A HOLD COMES OFF BY ITSELF when its date passes, which is what "defer
//   until March" says and is why this needs no sweep. A hold with no date is
//   indefinite and only a resume ends it.
//
//   THE THREE COMMIT DOORS REFUSE A HELD JOB AS WELL AS A CLOSED ONE. A held
//   job is deliberately not closed, so `jobClosure` says no to it and a route
//   reading only that would issue the work order.
//
//   AND THE INVARIANTS ARE RUN AGAINST REAL ROWS. Every invariant in CHECK.sql
//   reads zero on an empty database, so one that is subtly wrong passes for
//   ever -- the lesson 057 paid for. Each is seeded both ways here, out of the
//   real CHECK.sql and by column name, so the test cannot drift from the file
//   an operator pastes.
//
//   node --no-warnings scripts/job-end-test.mjs

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";
import { jobClosure, jobHold, jobIsLive, whyNotEnd, whyNotResume,
  ENDING_KINDS, CHOOSABLE_ENDINGS, ENDING_REFUSALS, isEndingKind } from "../shared/jobstate.js";

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");
const SCHEMA = readFileSync(join(app, "worker", "schema.sql"), "utf8");
const CHECK = readFileSync(join(app, "worker", "migrations", "CHECK.sql"), "utf8")
  .replace(/;\s*$/, "");
const inv = (db, name) => db.prepare(CHECK).get()[name];

const day = (n) => {
  const d = new Date(); d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

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
      ('prop_1','acc_pm','Press Apartments','1620 Belmont','Seattle','WA','98122');
    INSERT INTO memberships(id,user_id,account_id,role) VALUES
      ('m_mgr','u_mgr','acc_pm','admin'),
      ('m_pm','u_pm','acc_pm','pm'),
      ('m_ten','u_ten','acc_pm','tenant');
    INSERT INTO membership_properties(membership_id,property_id) VALUES ('m_ten','prop_1');
    INSERT INTO companies(id,company,contact,email,state,insurance,bond,contract) VALUES
      ('cmp_1','Pacific apartment maintenance','Juan Soto','juan@pacific.test','WA',1,1,1);
    INSERT INTO engagements(id,account_id,company_id,status,categories,doc_review) VALUES
      ('en_1','acc_pm','cmp_1','active','["plumbing","roofing"]',
       '{"insurance":{"status":"verified"},"bond":{"status":"verified"},"contract":{"status":"verified"},"w9":{"status":"verified"}}');

    -- THE JOB UNDER TEST, with a live accepted work order and an agreed
    -- window on it. A job nobody is on cannot show that an ending stands
    -- anybody down, which is the whole of what the modal has to promise.
    INSERT INTO jobs(id,account_id,property_id,title,trades,status,date,time,
                     requested_by,approved_at,created_at)
      VALUES ('job_1','acc_pm','prop_1','Press Apartments - leaking sink',
              '["plumbing","roofing"]','active','${day(4)}','09:00',
              'u_ten','2026-10-01','2026-10-01');
    INSERT INTO work_orders(id,job_id,company_id,engagement_id,trade,wo_number,status)
      VALUES ('wo_1','job_1','cmp_1','en_1','plumbing','WO-100100','accepted'),
             ('wo_2','job_1','cmp_1','en_1','roofing','WO-100101','pending');
    INSERT INTO visits(id,account_id,job_id,date,start_time,end_time,status,proposed_by,created_at)
      VALUES ('v_1','acc_pm','job_1','${day(4)}','09:00','11:00','confirmed','u_mgr','2026-10-02');
    INSERT INTO quote_requests(id,account_id,job_id,trade,status,created_by,created_at)
      VALUES ('q_1','acc_pm','job_1','roofing','open','u_mgr','2026-10-02');

    -- A SECOND, PLAIN JOB. Nothing on it, so the suite can tell "the ending
    -- wrote nothing" apart from "there was nothing to write".
    INSERT INTO jobs(id,account_id,property_id,title,trades,status,created_at)
      VALUES ('job_2','acc_pm','prop_1','Repaint hallway','["painting"]','active','2026-10-01');

    -- Another account's, for the scoping check.
    INSERT INTO jobs(id,account_id,title,trades,status,created_at)
      VALUES ('job_theirs','acc_other','Their boiler','["hvac"]','active','2026-10-01');
  `);
  return { db, env: { DB: makeD1(db) } };
};

// `/pay` refuses with `billing_not_configured` before it reads the release at
// all, so the gate under test is unreachable without a key. Stubbed rather
// than real: the gate sits above `woMoney`, so nothing should reach Stripe --
// and `fetch` throwing is what makes a later reorder visible instead of
// quietly passing because a call went out.
const payEnv = (env) => ({ ...env, STRIPE_SECRET_KEY: "sk_test_jobend" });
const noStripe = () => {
  const real = globalThis.fetch;
  globalThis.fetch = async (u) => { throw new Error(`unexpected Stripe call: ${u}`); };
  return () => { globalThis.fetch = real; };
};

const call = (env, method, path, body, who = "u_mgr") => worker.fetch(
  new Request(`https://api.subsub.work${path}`, {
    method, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: { "Content-Type": "application/json", "X-User-Id": who, "X-Account-Id": "acc_pm" },
  }), env);
const post = (env, path, body, who) => call(env, "POST", path, body ?? {}, who);
const get = (env, path, who) => call(env, "GET", path, undefined, who);
const json = async (r) => [r.status, await r.json().catch(() => ({}))];
const jobOf = (db, id) => db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(id);
const endings = (db, id) => db.prepare(
  `SELECT * FROM job_endings WHERE job_id = ? ORDER BY at ASC, rowid ASC`).all(id);
const live = (db, id) => db.prepare(
  `SELECT COUNT(*) AS n FROM work_orders WHERE job_id = ? AND voided_at IS NULL`).get(id).n;
const fundMoney = (db, cents) => db.exec(`
  INSERT INTO wo_funding(id,work_order_id,account_id,amount_cents,status,funded_at)
    VALUES ('f_1','wo_1','acc_pm',${cents},'funded','2026-10-02');`);

try {
  console.log("\n-- the rule, before any route --");
  {
    ck("the three a person chooses from", CHOOSABLE_ENDINGS.join() === "cancelled,deferred,no_work",
      CHOOSABLE_ENDINGS.join());
    // `resumed` is in the vocabulary and off the picker: it is how a hold
    // stops, not an ending somebody picks.
    ck("and resumed is a kind but not a choice",
      isEndingKind("resumed") && !CHOOSABLE_ENDINGS.includes("resumed"));
    ck("a word nothing recognises is not a kind", !isEndingKind("binned"));
    // Every refusal the rule can answer has words. A refusal somebody cannot
    // read is the dead-end this project keeps recording.
    const codes = ["job_not_found", "bad_kind", "not_approved", "already_cancelled",
      "already_completed", "already_no_work", "already_withdrawn", "already_declined",
      "already_deferred", "not_deferred", "reason_required", "money_funded"];
    ck("every refusal has words", codes.every((k) => !!ENDING_REFUSALS[k]),
      codes.filter((k) => !ENDING_REFUSALS[k]).join() || "all");
    // The two terminal ones demand a reason; a hold does not.
    ck("cancel and no-work need a reason",
      ENDING_KINDS.cancelled.needsNote && ENDING_KINDS.no_work.needsNote);
    ck("a hold does not", !ENDING_KINDS.deferred.needsNote);
  }

  console.log("\n-- a hold comes off by itself when its date passes --");
  {
    const held = { endingKind: "deferred", endingUntil: day(5) };
    const gone = { endingKind: "deferred", endingUntil: day(-1) };
    const open = { endingKind: "deferred", endingUntil: null };
    ck("a date ahead is a hold", jobHold(held, day(0)).held === true);
    // STRICTLY past: a hold until the 6th is still a hold ON the 6th, because
    // somebody who picked a date meant the work happens then, not before.
    ck("the day itself is still a hold",
      jobHold({ endingKind: "deferred", endingUntil: day(0) }, day(0)).held === true);
    ck("a date gone is not", jobHold(gone, day(0)).held === false);
    ck("and says it lapsed rather than silently reappearing",
      jobHold(gone, day(0)).lapsed === true);
    ck("no date at all holds indefinitely", jobHold(open, day(0)).held === true);
    // A HELD JOB IS NOT CLOSED. That is the whole difference: it keeps its
    // phase, it can be resumed, and the list must not file it under
    // completed -- so the two predicates have to disagree about it.
    ck("a held job is not closed", jobClosure(held).closed === false);
    ck("but it is not live either", jobIsLive(held, day(0)) === false);
    ck("and a lapsed one is live again", jobIsLive(gone, day(0)) === true);
  }

  console.log("\n-- cancelling stands everybody down --");
  {
    const { db, env } = seed();
    ck("it starts with two live work orders", live(db, "job_1") === 2, String(live(db, "job_1")));
    const [s, b] = await json(await post(env, "/api/jobs/job_1/end",
      { kind: "cancelled", note: "tenant had it fixed privately" }));
    ck("it is accepted", s === 200 && b.ok === true, `${s} ${JSON.stringify(b)}`);
    ck("the ending is recorded", endings(db, "job_1")[0]?.kind === "cancelled",
      JSON.stringify(endings(db, "job_1")));
    ck("with the reason", /fixed privately/.test(endings(db, "job_1")[0]?.note || ""),
      endings(db, "job_1")[0]?.note);
    ck("against the person who pressed it", endings(db, "job_1")[0]?.by_user_id === "u_mgr");
    // THE PART THAT COSTS A WASTED JOURNEY. Both of them -- the pending one
    // too, because an offer somebody is about to accept, voided silently, is
    // an afternoon they spent pricing work that was already off.
    ck("every live work order is voided", live(db, "job_1") === 0, String(live(db, "job_1")));
    ck("and the reply says how many", b.voided === 2, String(b.voided));
    ck("the agreed window is superseded",
      db.prepare(`SELECT status FROM visits WHERE id = 'v_1'`).get().status === "superseded");
    ck("the open quote request is cancelled",
      db.prepare(`SELECT status FROM quote_requests WHERE id = 'q_1'`).get().status === "cancelled");
    // A cancellation is NOT a completion. The status column is untouched, so
    // nothing downstream reads it as work that was done.
    ck("the status is not touched", jobOf(db, "job_1").status === "active",
      jobOf(db, "job_1").status);
    ck("and it reads as cancelled",
      jobClosure({ ...jobOf(db, "job_1"), ending_kind: "cancelled" }).reason === "cancelled");
  }

  console.log("\n-- closing it out with nothing done IS a completion --");
  {
    const { db, env } = seed();
    const [s] = await json(await post(env, "/api/jobs/job_1/end",
      { kind: "no_work", note: "looked at it, the seal was fine" }));
    ck("it is accepted", s === 200, String(s));
    // A fourth status word would mean a full rebuild of a table with a CHECK
    // on it, and every existing reader already answers correctly for
    // `completed`. The ROW is what says why.
    ck("the status becomes completed", jobOf(db, "job_1").status === "completed",
      jobOf(db, "job_1").status);
    ck("and it is dated", !!jobOf(db, "job_1").completed_at);
    // BUT IT MUST NOT READ AS WORK THAT WAS DONE.
    const row = { ...jobOf(db, "job_1"), ending_kind: "no_work", ending_note: "the seal was fine" };
    ck("it does not read as completed", jobClosure(row).reason === "no_work", jobClosure(row).reason);
    ck("and says so in words", /no work done/i.test(jobClosure(row).label), jobClosure(row).label);
    ck("it stands the work orders down too", live(db, "job_1") === 0, String(live(db, "job_1")));
  }

  console.log("\n-- a hold is reversible, and only a resume ends an open one --");
  {
    const { db, env } = seed();
    const [s, b] = await json(await post(env, "/api/jobs/job_1/end",
      { kind: "deferred", until: day(30), note: "owner's budget next quarter" }));
    ck("it is accepted", s === 200 && b.until === day(30), `${s} ${JSON.stringify(b)}`);
    ck("the date is stored", endings(db, "job_1")[0]?.until === day(30),
      endings(db, "job_1")[0]?.until);
    // A crew expecting Tuesday is a crew that turns up, which is as true of a
    // hold as of a cancellation.
    ck("it stands everybody down as well", live(db, "job_1") === 0, String(live(db, "job_1")));
    ck("but the status is untouched", jobOf(db, "job_1").status === "active");
    // RESUMING APPENDS rather than deleting: "we put this off in January and
    // picked it up in March" is two facts.
    const [s2] = await json(await post(env, "/api/jobs/job_1/resume", {}));
    ck("it can be taken off hold", s2 === 200, String(s2));
    ck("and the hold is still on the record", endings(db, "job_1").length === 2
      && endings(db, "job_1").map((e) => e.kind).join() === "deferred,resumed",
      endings(db, "job_1").map((e) => e.kind).join());
    // Not re-issued. Those were a price and a date for a day that has gone,
    // and re-issuing silently would commit a contractor to work they have not
    // been asked about again.
    ck("the work orders are NOT re-issued", live(db, "job_1") === 0, String(live(db, "job_1")));
    const [s3, b3] = await json(await post(env, "/api/jobs/job_1/resume", {}));
    ck("resuming twice is refused", s3 === 409 && b3.error === "not_deferred",
      `${s3} ${JSON.stringify(b3)}`);
  }
  {
    // A hold whose date has passed needs no resume: it is live again, and the
    // route says so rather than letting somebody take a hold off nothing.
    const { db, env } = seed();
    await post(env, "/api/jobs/job_1/end", { kind: "deferred", until: day(2) });
    db.exec(`UPDATE job_endings SET until = '${day(-1)}' WHERE job_id = 'job_1'`);
    const [s, b] = await json(await post(env, "/api/jobs/job_1/resume", {}));
    ck("a lapsed hold is already off", s === 409 && b.error === "not_deferred",
      `${s} ${JSON.stringify(b)}`);
  }

  console.log("\n-- money is the hard boundary, and a hold is exempt --");
  {
    const { db, env } = seed();
    fundMoney(db, 150000);
    const [s, b] = await json(await post(env, "/api/jobs/job_1/end",
      { kind: "cancelled", note: "not going ahead" }));
    ck("cancelling is refused", s === 409 && b.error === "money_funded", `${s} ${JSON.stringify(b)}`);
    ck("and says how much, so the screen can name it", b.fundedCents === 150000,
      String(b.fundedCents));
    ck("nothing was written", endings(db, "job_1").length === 0,
      JSON.stringify(endings(db, "job_1")));
    ck("and nobody was stood down", live(db, "job_1") === 2, String(live(db, "job_1")));
    const [s2] = await json(await post(env, "/api/jobs/job_1/end",
      { kind: "no_work", note: "nothing to do" }));
    ck("so is closing it out with nothing done", s2 === 409, String(s2));
    // PUTTING WORK OFF SPENDS NOTHING, and the funding is still there when it
    // comes back -- so a hold is deliberately allowed.
    const [s3] = await json(await post(env, "/api/jobs/job_1/end", { kind: "deferred" }));
    ck("but putting it on hold is allowed", s3 === 200, String(s3));
  }

  console.log("\n-- nothing is payable against an ended job --");
  for (const kind of ["cancelled", "no_work"]) {
    const { db, env } = seed();
    db.exec(`
      INSERT INTO wo_milestones(id,work_order_id,account_id,seq,label,amount_cents,status)
        VALUES ('ms_1','wo_1','acc_pm',1,'Done',50000,'verified');
      INSERT INTO wo_releases(id,work_order_id,account_id,milestone_id,company_id,gross_cents,fee_bps,fee_cents,net_cents,status)
        VALUES ('rel_1','wo_1','acc_pm','ms_1','cmp_1',50000,0,0,50000,'due');
      INSERT INTO lien_waivers(id,job_id,account_id,work_order_id,from_company_id,tier,kind,through_date,status,governing_state)
        VALUES ('lw_1','job_1','acc_pm','wo_1','cmp_1',1,'unconditional_progress','${day(9)}','signed','WA');
    `);
    await post(env, "/api/jobs/job_1/end", { kind, note: "x" });
    const [s, b] = await json(await post(env, "/api/releases/rel_1/settle",
      { method: "cheque", coverOverride: true, coverOverrideReason: "x",
        override: true, overrideReason: "x" }));
    ck(`settle is refused on a ${kind} job`,
      s === 409 && b.error === (kind === "cancelled" ? "job_cancelled" : "job_no_work"),
      `${s} ${JSON.stringify(b)}`);
    // NOT overridable. The two paperwork gates are; this is not, because no
    // reason makes work that was never done payable.
    ck("and the override does not get past it",
      db.prepare(`SELECT status FROM wo_releases WHERE id = 'rel_1'`).get().status === "due");
    const restore = noStripe();
    const [s2, b2] = await json(await post(payEnv(env), "/api/releases/rel_1/pay", {}));
    restore();
    // `pay` is a different route on purpose, so a gate on settle alone is a
    // door round it rather than a gate.
    ck(`pay is refused too on a ${kind} job`, s2 === 409
      && b2.error === (kind === "cancelled" ? "job_cancelled" : "job_no_work"),
      `${s2} ${JSON.stringify(b2)}`);
  }

  console.log("\n-- the three commit doors refuse a held job --");
  {
    const { db, env } = seed();
    db.exec(`UPDATE work_orders SET voided_at = '2026-10-02'`);
    await post(env, "/api/jobs/job_1/end", { kind: "deferred", until: day(20) });
    const [s, b] = await json(await post(env, "/api/jobs/job_1/assign",
      { trade: "plumbing", companyId: "cmp_1", value: "400" }));
    // A HELD JOB IS NOT CLOSED, so `jobClosure` answers no to it -- a route
    // reading only that would issue the work order. Named separately, because
    // "closed" is the wrong word for a reversible thing.
    ck("assign is refused", s === 409 && b.error === "job_deferred", `${s} ${JSON.stringify(b)}`);
    ck("and names the date, so the screen can say until when", b.until === day(20), String(b.until));
    ck("no work order was issued", live(db, "job_1") === 0, String(live(db, "job_1")));
    const [s2, b2] = await json(await post(env, "/api/jobs/job_1/quote-requests",
      { trade: "roofing", companyIds: ["cmp_1"] }));
    ck("asking for quotes is refused", s2 === 409 && b2.error === "job_deferred",
      `${s2} ${JSON.stringify(b2)}`);
    const [s3, b3] = await json(await post(env, "/api/jobs/job_1/overflow", { trade: "roofing" }));
    ck("overflow is refused", s3 === 409 && b3.error === "job_deferred",
      `${s3} ${JSON.stringify(b3)}`);
  }
  {
    // AND A LAPSED HOLD DOES NOT REFUSE, or the date would mean nothing: the
    // job is live again and the doors have to open by themselves.
    const { db, env } = seed();
    db.exec(`UPDATE work_orders SET voided_at = '2026-10-02'`);
    await post(env, "/api/jobs/job_1/end", { kind: "deferred", until: day(2) });
    db.exec(`UPDATE job_endings SET until = '${day(-1)}' WHERE job_id = 'job_1'`);
    const [s] = await json(await post(env, "/api/jobs/job_1/assign",
      { trade: "plumbing", companyId: "cmp_1", value: "400" }));
    ck("assign works again once the hold has lapsed", s === 201, String(s));
  }
  {
    // And a CANCELLED job is refused with the closed reason, not the hold one.
    const { env } = seed();
    await post(env, "/api/jobs/job_1/end", { kind: "cancelled", note: "x" });
    const [s, b] = await json(await post(env, "/api/jobs/job_1/assign",
      { trade: "plumbing", companyId: "cmp_1", value: "400" }));
    ck("a cancelled job is refused as closed",
      s === 409 && b.error === "job_closed" && b.reason === "cancelled",
      `${s} ${JSON.stringify(b)}`);
  }

  console.log("\n-- what it refuses, by name --");
  {
    const { env } = seed();
    const [s, b] = await json(await post(env, "/api/jobs/job_1/end", { kind: "cancelled" }));
    ck("a cancellation with no reason is refused", s === 400 && b.error === "reason_required",
      `${s} ${JSON.stringify(b)}`);
    const [s2] = await json(await post(env, "/api/jobs/job_1/end",
      { kind: "no_work" }));
    ck("so is closing it out with none", s2 === 400, String(s2));
    // A hold's date is usually its whole story, so no reason is wanted there.
    const [s3] = await json(await post(env, "/api/jobs/job_1/end", { kind: "deferred" }));
    ck("a hold needs none", s3 === 200, String(s3));
  }
  {
    const { env } = seed();
    const [s, b] = await json(await post(env, "/api/jobs/job_1/end", { kind: "binned", note: "x" }));
    ck("a word nothing recognises is refused", s === 400 && b.error === "bad_kind",
      `${s} ${JSON.stringify(b)}`);
    const [s2, b2] = await json(await post(env, "/api/jobs/job_1/end", { kind: "resumed" }));
    // Resuming is not an ending somebody picks, and offering it through this
    // door would let a resume be written against a job that was never held --
    // which is the invariant below.
    ck("and so is resumed, through this door", s2 === 400 && b2.error === "bad_kind",
      `${s2} ${JSON.stringify(b2)}`);
  }
  {
    const { env } = seed();
    await post(env, "/api/jobs/job_1/end", { kind: "cancelled", note: "x" });
    const [s, b] = await json(await post(env, "/api/jobs/job_1/end",
      { kind: "cancelled", note: "again" }));
    ck("ending it twice is refused by name", s === 409 && b.error === "already_cancelled",
      `${s} ${JSON.stringify(b)}`);
  }
  {
    // A request nobody approved is not a job yet: `decline` is its door, and
    // two doors onto one act is how the two come to disagree about what they
    // wrote.
    const { db, env } = seed();
    db.exec(`UPDATE jobs SET approved_at = NULL WHERE id = 'job_1'`);
    const [s, b] = await json(await post(env, "/api/jobs/job_1/end",
      { kind: "cancelled", note: "x" }));
    ck("an unapproved request is sent to decline instead",
      s === 409 && b.error === "not_approved", `${s} ${JSON.stringify(b)}`);
  }
  {
    const { env } = seed();
    const [s, b] = await json(await post(env, "/api/jobs/job_1/end",
      { kind: "deferred", until: "6 Oct" }));
    ck("a date that is not a date is refused", s === 400 && b.error === "bad_date",
      `${s} ${JSON.stringify(b)}`);
    const [s2, b2] = await json(await post(env, "/api/jobs/job_1/end",
      { kind: "deferred", until: day(-3) }));
    // A hold that is over before it starts reads on screen as nothing having
    // happened.
    ck("and so is one already gone", s2 === 400 && b2.error === "until_in_the_past",
      `${s2} ${JSON.stringify(b2)}`);
  }

  console.log("\n-- scoped both ways --");
  {
    const { db, env } = seed();
    const [s, b] = await json(await post(env, "/api/jobs/job_theirs/end",
      { kind: "cancelled", note: "mine now" }));
    ck("another account's job is not found", s === 404 && /not_found$/.test(String(b.error)),
      `${s} ${JSON.stringify(b)}`);
    ck("and nothing was written", endings(db, "job_theirs").length === 0);
  }
  {
    // 053's job scope. The pm is narrowed to job_2, so only the scope can
    // keep them off job_1 -- the account clause lets them through.
    const { db, env } = seed();
    db.exec(`INSERT INTO membership_jobs(membership_id,job_id) VALUES ('m_pm','job_2');`);
    const [s, b] = await json(await post(env, "/api/jobs/job_1/end",
      { kind: "cancelled", note: "not mine" }, "u_pm"));
    ck("a scoped project manager is refused", s === 404 && /not_found$/.test(String(b.error)),
      `${s} ${JSON.stringify(b)}`);
    ck("and the job is untouched", endings(db, "job_1").length === 0);
    const [s2] = await json(await post(env, "/api/jobs/job_2/end",
      { kind: "cancelled", note: "this one is mine" }, "u_pm"));
    ck("and may end the job they are scoped to", s2 === 200, String(s2));
  }
  {
    const { db, env } = seed();
    const [s] = await json(await post(env, "/api/jobs/job_1/end",
      { kind: "cancelled", note: "tenant edit" }, "u_ten"));
    ck("a tenant cannot end a job", s === 403 && endings(db, "job_1").length === 0, String(s));
  }

  console.log("\n-- what ending it would cost, asked before the modal opens --");
  {
    const { env } = seed();
    const [s, b] = await json(await get(env, "/api/jobs/job_1/end-check"));
    ck("the check answers", s === 200, `${s} ${JSON.stringify(b)}`);
    // NAMED, not counted. The whole reason the roster's own end-check runs
    // before the modal opens.
    ck("naming who is booked", (b.booked || []).sort().join() === "plumbing,roofing",
      JSON.stringify(b.booked));
    ck("and which of them accepted", (b.accepted || []).join() === "plumbing",
      JSON.stringify(b.accepted));
    ck("the agreed window", b.hasVisit === true, String(b.hasVisit));
    ck("the open quote request", b.openQuotes === 1, String(b.openQuotes));
    ck("and nothing funded yet", b.fundedCents === 0, String(b.fundedCents));
    // So the modal can grey an option with the reason beside it rather than
    // offering a press that answers 409.
    ck("every choosable kind gets a verdict",
      CHOOSABLE_ENDINGS.every((k) => k in (b.blocked || {})), JSON.stringify(b.blocked));
    ck("and none is blocked on a plain live job",
      CHOOSABLE_ENDINGS.every((k) => b.blocked[k] === null), JSON.stringify(b.blocked));
  }
  {
    const { db, env } = seed();
    fundMoney(db, 42000);
    const [, b] = await json(await get(env, "/api/jobs/job_1/end-check"));
    ck("funded money is reported", b.fundedCents === 42000, String(b.fundedCents));
    // THE SCREEN AND THE ROUTE READ ONE RULE, so neither can offer what the
    // other refuses.
    ck("and blocks exactly what the route blocks",
      b.blocked.cancelled === "money_funded" && b.blocked.no_work === "money_funded"
        && b.blocked.deferred === null, JSON.stringify(b.blocked));
  }

  console.log("\n-- the trail says what happened --");
  {
    const { db, env } = seed();
    await post(env, "/api/jobs/job_1/end",
      { kind: "deferred", until: day(14), note: "budget" });
    const row = db.prepare(
      `SELECT * FROM activity WHERE account_id = 'acc_pm' AND kind = 'job_deferred'`).get();
    ck("the feed records it", !!row, JSON.stringify(row || null));
    ck("naming the date and the reason",
      /until/.test(row?.text || "") && /budget/.test(row?.text || ""), row?.text);
    ck("and how many were stood down", /work order/.test(row?.text || ""), row?.text);
    const ev = db.prepare(
      `SELECT * FROM events WHERE kind = 'job.deferred'`).get();
    ck("and the machine log carries the figures", !!ev && /"voided":2/.test(ev.payload),
      ev?.payload);
  }

  console.log("\n-- and the invariants are run against real rows --");
  {
    // EVERY INVARIANT READS ZERO ON AN EMPTY DATABASE, so one that is subtly
    // wrong passes for ever. That is the lesson 057 paid for, and it is why
    // each of these is seeded both ways here rather than left to the drift
    // test. Read out of the real CHECK.sql by column name, so this cannot
    // drift from the file an operator pastes.
    const { db, env } = seed();
    ck("the did-I-run-it check counts five named columns",
      inv(db, "m066_job_endings") === 5, String(inv(db, "m066_job_endings")));

    await post(env, "/api/jobs/job_1/end", { kind: "cancelled", note: "x" });
    ck("a clean cancellation leaves every invariant at zero",
      ["m066_inv_bad_kind", "m066_inv_live_wo_on_ended", "m066_inv_paid_on_ended",
        "m066_inv_resume_without_hold"].every((k) => inv(db, k) === 0),
      JSON.stringify(Object.fromEntries(["m066_inv_bad_kind", "m066_inv_live_wo_on_ended",
        "m066_inv_paid_on_ended", "m066_inv_resume_without_hold"].map((k) => [k, inv(db, k)]))));

    // A kind nothing recognises reads as "not ended" to `jobEnding`, which is
    // the direction that draws a cancelled job as live work.
    db.exec(`UPDATE job_endings SET kind = 'binned' WHERE job_id = 'job_1'`);
    ck("a bad kind is counted", inv(db, "m066_inv_bad_kind") === 1,
      String(inv(db, "m066_inv_bad_kind")));
    db.exec(`UPDATE job_endings SET kind = 'cancelled' WHERE job_id = 'job_1'`);

    // THE ONE THAT COSTS A WASTED JOURNEY: a contractor with a price, a date
    // and no idea the work is off.
    db.exec(`UPDATE work_orders SET voided_at = NULL WHERE id = 'wo_1'`);
    ck("a live work order on an ended job is counted",
      inv(db, "m066_inv_live_wo_on_ended") === 1, String(inv(db, "m066_inv_live_wo_on_ended")));
    db.exec(`UPDATE work_orders SET voided_at = '2026-10-02' WHERE id = 'wo_1'`);

    // Money for work nobody did.
    db.exec(`
      INSERT INTO wo_milestones(id,work_order_id,account_id,seq,label,amount_cents,status)
        VALUES ('ms_9','wo_1','acc_pm',1,'Done',50000,'verified');
      INSERT INTO wo_releases(id,work_order_id,account_id,milestone_id,company_id,gross_cents,fee_bps,fee_cents,net_cents,status)
        VALUES ('rel_9','wo_1','acc_pm','ms_9','cmp_1',50000,0,0,50000,'paid');`);
    ck("a paid release on an ended job is counted",
      inv(db, "m066_inv_paid_on_ended") === 1, String(inv(db, "m066_inv_paid_on_ended")));
    db.exec(`UPDATE wo_releases SET status = 'due' WHERE id = 'rel_9'`);

    // A resume against something that was never held would make `jobEnding`
    // answer "live" for work somebody called off -- the gate opening, not a
    // tidiness complaint.
    db.exec(`INSERT INTO job_endings(id,job_id,account_id,kind,at)
             VALUES ('je_9','job_1','acc_pm','resumed','2099-01-01')`);
    ck("a resume with no hold behind it is counted",
      inv(db, "m066_inv_resume_without_hold") === 1,
      String(inv(db, "m066_inv_resume_without_hold")));
  }
  {
    // AND THE OTHER DIRECTION: a real hold, resumed, must read zero -- or the
    // invariant would fire on every ordinary deferral and be a bug report
    // nobody can action.
    const { db, env } = seed();
    db.exec(`UPDATE work_orders SET voided_at = '2026-10-02'`);
    await post(env, "/api/jobs/job_1/end", { kind: "deferred", until: day(9) });
    await post(env, "/api/jobs/job_1/resume", {});
    ck("a hold taken off reads zero", inv(db, "m066_inv_resume_without_hold") === 0,
      String(inv(db, "m066_inv_resume_without_hold")));
    // And a resumed job legitimately has live work orders again.
    await post(env, "/api/jobs/job_1/assign",
      { trade: "plumbing", companyId: "cmp_1", value: "400" });
    ck("and a resumed job may hold live work orders",
      inv(db, "m066_inv_live_wo_on_ended") === 0 && live(db, "job_1") > 0,
      `${inv(db, "m066_inv_live_wo_on_ended")} / ${live(db, "job_1")}`);
  }

  console.log("\n-- a database without 066 says which migration --");
  {
    const db = freshDb({ base: SCHEMA, migrations: [] });
    db.exec(`DROP TABLE job_endings;`);
    db.exec(`
      INSERT INTO accounts(id,name,kind,subdomain,plan) VALUES ('acc_pm','S','property_manager','s','scale');
      INSERT INTO users(id,name,email) VALUES ('u_mgr','C','c@t.test');
      INSERT INTO memberships(id,user_id,account_id,role) VALUES ('m','u_mgr','acc_pm','admin');
      INSERT INTO jobs(id,account_id,title,trades,status,created_at)
        VALUES ('job_1','acc_pm','X','["plumbing"]','active','2026-10-01');`);
    const env = { DB: makeD1(db) };
    const [s, b] = await json(await post(env, "/api/jobs/job_1/end",
      { kind: "cancelled", note: "x" }));
    ck("the ending names the migration", s === 503 && b.migration === "066_job_endings",
      `${s} ${JSON.stringify(b)}`);
    // AND THE JOBS LIST STILL LOADS. A missing table must not empty the whole
    // screen -- which is the regression this project has recorded twice.
    const [s2, b2] = await json(await get(env, "/api/jobs"));
    ck("and the jobs list is unaffected", s2 === 200 && Array.isArray(b2) && b2.length === 1,
      `${s2} ${Array.isArray(b2) ? b2.length : JSON.stringify(b2)}`);
  }
} catch (err) {
  fail++; console.log("FAIL  threw:", err?.stack || err);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
