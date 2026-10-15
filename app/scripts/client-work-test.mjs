// A CLIENT'S WORK ORDER IS ANSWERED FROM OUR OWN ACCOUNT.
//
// Reported from Cascade Apartment Services: Sound Property Management gave
// them a tenant's job and it was nowhere on Cascade's dashboard or Jobs
// screen, and where it did appear the only move was "Go to Sound" -- which
// needs a seat on Sound that the person running Cascade may not have.
//
// /api/my-work/:woId/respond, /visits and /visits/:id/respond re-dispatch to
// the real routes as Cascade's contractor leg on Sound. What this pins:
//
//   Cascade's own admin, with NO seat on Sound, can accept the work, propose
//   a time and answer one -- and the real routes' rules still apply
//   (proposing is agreeing, the chain's turn, the job's date when settled).
//
//   Nobody else can: a company that does not hold the work order, a voided
//   work order, an ended engagement, a visit on another job, and an account
//   with no company at all are all refused, and refused as not_found.
//
//   The inner auth cannot be claimed from outside: headers naming the client
//   account get nothing.
//
//   node --no-warnings scripts/client-work-test.mjs

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");
const SCHEMA = readFileSync(join(app, "worker", "schema.sql"), "utf8");

const DAY = (() => { const d = new Date(); d.setUTCDate(d.getUTCDate() + 20); return d.toISOString().slice(0, 10); })();

const seed = () => {
  const db = freshDb({ base: SCHEMA, migrations: [] });
  db.exec(`
    INSERT INTO companies(id,company,contact,email,state) VALUES
      ('cmp_cas','Cascade Apartment Services','Ricard Brando','rbraun@cascade.test','WA'),
      ('cmp_oth','Other Co','Other Owner','owner@other.test','WA');
    INSERT INTO accounts(id,name,kind,subdomain,plan,company_id) VALUES
      ('acc_pm','Sound Property Management','property_manager','soundpm','scale',NULL),
      ('acc_cas','Cascade Apartment Services','subcontractor','cascade','basic','cmp_cas'),
      ('acc_oth','Other Co','subcontractor','otherco','basic','cmp_oth');
    INSERT INTO users(id,name,email) VALUES
      ('u_mgr','Chris Lane','chris@soundpm.test'),
      ('u_ten','John Smith','john@tenant.test'),
      ('u_ric','Ricard Brando','rbraun@cascade.test'),
      ('u_oth','Other Owner','owner@other.test');
    INSERT INTO engagements(id,account_id,company_id,status,categories) VALUES
      ('en_cas','acc_pm','cmp_cas','active','["painting"]'),
      ('en_oth','acc_pm','cmp_oth','ended','["painting"]');
    INSERT INTO properties(id,account_id,name,address,city,state,zip) VALUES
      ('prop_1','acc_pm','Press Apartments','1620 Belmont','Seattle','WA','98122');
    -- Ricard runs Cascade and has NO seat on Sound: the case reported.
    INSERT INTO memberships(id,user_id,account_id,role,company_id) VALUES
      ('m_mgr','u_mgr','acc_pm','admin',NULL),
      ('m_ten','u_ten','acc_pm','tenant',NULL),
      ('m_ric','u_ric','acc_cas','admin',NULL),
      ('m_oth','u_oth','acc_oth','admin',NULL);
    INSERT INTO membership_properties(membership_id,property_id) VALUES ('m_ten','prop_1');

    INSERT INTO jobs(id,account_id,property_id,title,trades,status,requested_by,approved_at,created_at)
      VALUES ('job_paint','acc_pm','prop_1','Paint is peeling off the ceiling','["painting"]','active','u_ten','2026-10-01','2026-10-01'),
             ('job_two','acc_pm','prop_1','Another job','["painting"]','active','u_ten','2026-10-01','2026-10-01'),
             ('job_void','acc_pm','prop_1','Voided job','["painting"]','active','u_ten','2026-10-01','2026-10-01'),
             ('job_oth','acc_pm','prop_1','Other company job','["painting"]','active','u_ten','2026-10-01','2026-10-01');
    INSERT INTO work_orders(id,wo_number,job_id,trade,company_id,engagement_id,status,value_cents,voided_at) VALUES
      ('wo_paint','WO-1','job_paint','painting','cmp_cas','en_cas','pending',40000,NULL),
      ('wo_two','WO-2','job_two','painting','cmp_cas','en_cas','accepted',40000,NULL),
      ('wo_void','WO-3','job_void','painting','cmp_cas','en_cas','accepted',40000,'2026-10-02'),
      ('wo_oth','WO-4','job_oth','painting','cmp_oth','en_oth','accepted',40000,NULL);
  `);
  return { db, env: { DB: makeD1(db) } };
};

const call = (env, path, body, who = "u_ric", acct = "acc_cas", method = "POST") => worker.fetch(
  new Request(`https://api.subsub.work${path}`, {
    method, body: method === "GET" ? undefined : JSON.stringify(body || {}),
    headers: { "Content-Type": "application/json", "X-User-Id": who, "X-Account-Id": acct },
  }), env);
const json = async (r) => [r.status, await r.json().catch(() => ({}))];

{
  const { db, env } = seed();

  // The listing is what put it in front of them; it must carry the row.
  const [ls, list] = await json(await call(env, "/api/my-work", null, "u_ric", "acc_cas", "GET"));
  const row = (list.work || []).find((w) => w.woId === "wo_paint");
  ck("Cascade's own admin is shown Sound's job in /api/my-work", ls === 200 && !!row, JSON.stringify(list).slice(0, 200));
  ck("and it is marked as at another account", row && row.here === false);

  // Accepting, with no seat on Sound.
  const [as, ab] = await json(await call(env, "/api/my-work/wo_paint/respond", { status: "accepted" }));
  ck("accepting the work answers ok", as === 200 && ab.ok, `${as} ${JSON.stringify(ab)}`);
  const wo = db.prepare(`SELECT status FROM work_orders WHERE id = 'wo_paint'`).get();
  ck("and the work order is accepted on Sound", wo.status === "accepted", wo.status);
  const ev = db.prepare(`SELECT account_id, actor_id FROM events WHERE kind = 'wo.accepted' AND subject_id = 'wo_paint'`).get();
  ck("the event is on Sound and names the person who pressed it", ev?.account_id === "acc_pm" && ev?.actor_id === "u_ric", JSON.stringify(ev));
  ck("no seat on Sound was created for it",
    !db.prepare(`SELECT 1 FROM memberships WHERE user_id = 'u_ric' AND account_id = 'acc_pm'`).get());

  // Proposing a time: the contractor's leg, which is their agreement to it.
  const [ps, pb] = await json(await call(env, "/api/my-work/wo_paint/visits",
    { date: DAY, startTime: "09:00", endTime: "11:00", note: "Ring the office" }));
  ck("proposing a time answers 201", ps === 201, `${ps} ${JSON.stringify(pb)}`);
  const v = db.prepare(`SELECT * FROM visits WHERE job_id = 'job_paint' AND status = 'proposed'`).get();
  ck("the window is on Sound's job, proposed by Ricard", v?.account_id === "acc_pm" && v?.proposed_by === "u_ric", JSON.stringify(v));
  ck("and counted as the contractor's own agreement", !!v?.contractor_at);
  ck("the hiring side is still to answer", !v?.manager_at && pb.turn === "manager", JSON.stringify(pb.turn));

  // The hiring side approves, then it is the tenant's turn; Cascade cannot
  // confirm a window that is not theirs to confirm.
  await call(env, `/api/visits/${v.id}/respond`, { status: "confirmed" }, "u_mgr", "acc_pm");
  const [cs, cb] = await json(await call(env, `/api/my-work/wo_paint/visits/${v.id}/respond`, { status: "confirmed" }));
  ck("Cascade answering a window it has already agreed to is refused by the real rule", cs === 409, `${cs} ${JSON.stringify(cb)}`);

  // A manager-proposed window on the second job, which IS the crew's turn.
  const [, mb] = await json(await call(env, "/api/jobs/job_two/visits",
    { date: DAY, startTime: "13:00", endTime: "14:00" }, "u_mgr", "acc_pm"));
  const [rs, rb] = await json(await call(env, `/api/my-work/wo_two/visits/${mb.id}/respond`, { status: "confirmed" }));
  ck("Cascade confirms the time Sound put to them", rs === 200, `${rs} ${JSON.stringify(rb)}`);
  const v2 = db.prepare(`SELECT contractor_at FROM visits WHERE id = ?`).get(mb.id);
  ck("and the contractor leg is stamped", !!v2?.contractor_at);

  // A visit on another job is not a key, even through a work order we hold.
  const [xs] = await json(await call(env, `/api/my-work/wo_paint/visits/${mb.id}/respond`, { status: "declined" }));
  ck("a visit on a different job is refused as not_found", xs === 404, String(xs));

  // Voided, somebody else's, ended.
  const [vs] = await json(await call(env, "/api/my-work/wo_void/respond", { status: "accepted" }));
  ck("a voided work order is not_found", vs === 404, String(vs));
  const [os] = await json(await call(env, "/api/my-work/wo_oth/respond", { status: "declined" }));
  ck("a work order another company holds is not_found", os === 404, String(os));
  const [es] = await json(await call(env, "/api/my-work/wo_oth/visits",
    { date: DAY }, "u_oth", "acc_oth"));
  ck("an ended engagement cannot act on its old work order", es === 404, String(es));

  // A property manager has no company: nothing to act for.
  const [ns] = await json(await call(env, "/api/my-work/wo_paint/visits", { date: DAY }, "u_mgr", "acc_pm"));
  ck("an account with no company is refused", ns === 404, String(ns));

  // The inner auth cannot be claimed from outside: headers naming Sound get
  // Ricard nothing, because he has no seat there.
  const [hs] = await json(await call(env, "/api/work-orders/wo_paint/respond", { status: "declined" }, "u_ric", "acc_pm"));
  ck("calling Sound's route directly without a seat is still refused", hs === 403, String(hs));
  ck("and the work order was not touched by it",
    db.prepare(`SELECT status FROM work_orders WHERE id = 'wo_paint'`).get().status === "accepted");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
