// ONE APPOINTMENT PER COMPANY ON A JOB (098).
//
// Asked as *"if a job has 5 different work orders with multiple vendors, we
// need to schedule each of them individually, not one schedule for all work
// orders and all vendors"*. A visit now carries the company it is for, each
// company's time is proposed, answered and confirmed on its own, and the
// tenant confirms each one. The fixture is the shape that tells the two rules
// apart: one job, two companies holding accepted work on it.
//
//   node --no-warnings scripts/appointments-test.mjs

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";
import { appointmentFor, jobAppointments, jobFullyBooked, latestPerCompany,
  pressingVisit } from "../shared/appointments.js";

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");
const SCHEMA = readFileSync(join(app, "worker", "schema.sql"), "utf8");

const seed = () => {
  const db = freshDb({ base: SCHEMA, migrations: [] });
  db.exec(`
    INSERT INTO accounts(id,name,kind,subdomain,plan) VALUES
      ('acc_pm','Sound Property Management','property_manager','soundpm','scale');
    INSERT INTO users(id,name,email) VALUES
      ('u_mgr','Chris Lane','chris@soundpm.test'),
      ('u_ten','John Smith','john@tenant.test'),
      ('u_pac','Juan Soto','juan@pacific.test'),
      ('u_cas','Ana Ruiz','ana@cascade.test');
    INSERT INTO companies(id,company,contact,email,state) VALUES
      ('cmp_pac','Pacific apartment maintenance','Juan Soto','juan@pacific.test','WA'),
      ('cmp_cas','Cascade Painting','Ana Ruiz','ana@cascade.test','WA');
    INSERT INTO engagements(id,account_id,company_id,status,categories) VALUES
      ('en_pac','acc_pm','cmp_pac','active','["plumbing"]'),
      ('en_cas','acc_pm','cmp_cas','active','["painting"]');
    INSERT INTO properties(id,account_id,name,address,city,state,zip) VALUES
      ('prop_1','acc_pm','Press Apartments','1620 Belmont','Seattle','WA','98122');
    INSERT INTO memberships(id,user_id,account_id,role,company_id) VALUES
      ('m_mgr','u_mgr','acc_pm','admin',NULL),
      ('m_ten','u_ten','acc_pm','tenant',NULL),
      ('m_pac','u_pac','acc_pm','contractor','cmp_pac'),
      ('m_cas','u_cas','acc_pm','contractor','cmp_cas');
    INSERT INTO membership_properties(membership_id,property_id) VALUES ('m_ten','prop_1');
    -- A tenant's report with two companies on it: the tenant has to be in.
    INSERT INTO jobs(id,account_id,property_id,title,trades,status,requested_by,approved_at,date,created_at)
      VALUES ('job_two','acc_pm','prop_1','Bathroom repair','["plumbing","painting"]','active','u_ten','2026-10-01',NULL,'2026-10-01');
    -- One company only, with a whole-job time from before anybody was hired.
    INSERT INTO jobs(id,account_id,property_id,title,trades,status,access,created_at)
      VALUES ('job_one','acc_pm','prop_1','Fix the gate','["plumbing"]','active','none','2026-10-01');
    INSERT INTO work_orders(id,wo_number,job_id,trade,company_id,engagement_id,status,value_cents) VALUES
      ('wo_p','WO-1','job_two','plumbing','cmp_pac','en_pac','accepted',40000),
      ('wo_c','WO-2','job_two','painting','cmp_cas','en_cas','accepted',30000),
      ('wo_g','WO-3','job_one','plumbing','cmp_pac','en_pac','accepted',20000);
    INSERT INTO visits(id,account_id,job_id,proposed_by,date,start_time,end_time,status,created_at)
      VALUES ('v_shared','acc_pm','job_one','u_mgr','2026-12-01','09:00','10:00','proposed','2026-10-02 08:00:00');
  `);
  return { db, env: { DB: makeD1(db) } };
};

const day = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const D1 = day(20), D2 = day(25), D3 = day(18);
const call = (env, path, body, who = "u_mgr", method = "POST") => worker.fetch(
  new Request(`https://api.subsub.work${path}`, {
    method, ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
    headers: { "Content-Type": "application/json", "X-User-Id": who, "X-Account-Id": "acc_pm" },
  }), env);
const json = async (p) => { const r = await p; return [r.status, await r.json().catch(() => ({}))]; };
const row = (db, id) => db.prepare(`SELECT * FROM visits WHERE id = ?`).get(id);
const propose = (env, jobId, body, who = "u_mgr") => json(call(env, `/api/jobs/${jobId}/visits`,
  { startTime: "09:00", endTime: "11:00", ...body }, who));
const respond = (env, id, status, who) => json(call(env, `/api/visits/${id}/respond`, { status }, who));

try {
  const { db, env } = seed();

  console.log("\n-- a job with two companies needs to know whose time it is --");
  {
    const [s, b] = await propose(env, "job_two", { date: D1 });
    ck("proposing with no company named is refused", s === 409 && b.error === "company_required", `${s} ${JSON.stringify(b)}`);
    ck("and names the companies to choose from",
      JSON.stringify((b.companies || []).sort()) === JSON.stringify(["cmp_cas", "cmp_pac"]), JSON.stringify(b.companies));
    const [s2, b2] = await propose(env, "job_two", { date: D1, companyId: "cmp_nope" });
    ck("a company not on the job is refused", s2 === 400 && b2.error === "bad_company", `${s2} ${b2.error}`);
  }

  console.log("\n-- each company's time is its own --");
  let vp, vc;
  {
    const [s, b] = await propose(env, "job_two", { date: D1, companyId: "cmp_pac" });
    vp = b.id;
    ck("Pacific's time is proposed", s === 201 && b.companyId === "cmp_pac", `${s} ${b.companyId}`);
    ck("Pacific has to agree to it, then the tenant", b.turn === "contractor"
      && b.parties.join() === "contractor,manager,tenant", JSON.stringify(b.parties));
    const [s2, b2] = await propose(env, "job_two", { date: D2, companyId: "cmp_cas" });
    vc = b2.id;
    ck("Cascade's time is proposed too", s2 === 201 && b2.companyId === "cmp_cas", `${s2}`);
    ck("and Pacific's time still stands", row(db, vp).status === "proposed", row(db, vp).status);

    const [s3, b3] = await respond(env, vp, "confirmed", "u_cas");
    ck("Cascade cannot answer Pacific's time", s3 === 403, `${s3} ${JSON.stringify(b3)}`);
    const [s4] = await respond(env, vp, "confirmed", "u_pac");
    ck("Pacific answers its own", s4 === 200, String(s4));
    const [s5, b5] = await respond(env, vp, "confirmed", "u_ten");
    ck("and the tenant confirming books Pacific", s5 === 200 && b5.status === "confirmed", `${s5} ${b5.status}`);
    ck("Cascade's time is still waiting on Cascade", row(db, vc).status === "proposed"
      && !row(db, vc).contractor_at, row(db, vc).status);
    ck("the job's date is Pacific's booked day", db.prepare(`SELECT date FROM jobs WHERE id='job_two'`).get().date === D1,
      db.prepare(`SELECT date FROM jobs WHERE id='job_two'`).get().date);

    // A crew proposes its own, without naming anybody.
    const [s6, b6] = await propose(env, "job_two", { date: D3 }, "u_cas");
    ck("a crew's own proposal is for its own appointment", s6 === 201 && b6.companyId === "cmp_cas", `${s6} ${b6.companyId}`);
    ck("replacing Cascade's earlier time", row(db, vc).status === "superseded", row(db, vc).status);
    ck("and leaving Pacific's booking alone", row(db, vp).status === "confirmed", row(db, vp).status);
    // A crew counter goes back to the hiring side, then the tenant.
    await respond(env, b6.id, "confirmed", "u_mgr");
    const [, b7] = await respond(env, b6.id, "confirmed", "u_ten");
    ck("the hiring side and the tenant book Cascade's too", b7.status === "confirmed", b7.status);
    ck("and the job's date moves to the earliest booked day", db.prepare(`SELECT date FROM jobs WHERE id='job_two'`).get().date === D3,
      db.prepare(`SELECT date FROM jobs WHERE id='job_two'`).get().date);
  }

  console.log("\n-- who sees which --");
  {
    const [s, list] = await json(call(env, "/api/visits", null, "u_ten", "GET"));
    const two = (list || []).filter((v) => v.jobId === "job_two");
    ck("the tenant sees both appointments", s === 200 && two.length === 2, JSON.stringify(two.map((v) => v.companyId)));
    ck("each named by its company", two.map((v) => v.companyName).sort().join() === "Cascade Painting,Pacific apartment maintenance",
      JSON.stringify(two.map((v) => v.companyName)));
    const [, mine] = await json(call(env, "/api/visits", null, "u_pac", "GET"));
    const pacTwo = (mine || []).filter((v) => v.jobId === "job_two");
    ck("a crew sees only its own appointment on the job", pacTwo.length === 1 && pacTwo[0].companyId === "cmp_pac",
      JSON.stringify(pacTwo.map((v) => v.companyId)));
  }

  console.log("\n-- one company: its time is its own, and the whole-job time comes down --");
  {
    const [s, b] = await propose(env, "job_one", { date: D1 });
    ck("with one company on the job, no name is needed", s === 201 && b.companyId === "cmp_pac", `${s} ${b.companyId}`);
    ck("and the old whole-job time is replaced", row(db, "v_shared").status === "superseded", row(db, "v_shared").status);
  }

  console.log("\n-- moving the job's date asks each company --");
  {
    const r = await call(env, "/api/jobs/job_two", { date: day(30), time: "10:00" }, "u_mgr", "PATCH");
    const [s, b] = await json(r);
    const live = db.prepare(`SELECT company_id FROM visits WHERE job_id='job_two' AND status IN ('proposed','confirmed')
      AND date = ?`).all(day(30)).map((x) => x.company_id).sort();
    ck("one new time per company", s === 200 && live.join() === "cmp_cas,cmp_pac", `${s} ${JSON.stringify(live)} ${JSON.stringify(b.rescheduled)}`);
  }

  console.log("\n-- the shared rules --");
  {
    const vs = [
      { id: "a", jobId: "j", companyId: null, status: "confirmed", date: "2026-11-01", createdAt: "1" },
      { id: "b", jobId: "j", companyId: "c1", status: "proposed", date: "2026-11-05", createdAt: "2" },
      { id: "c", jobId: "j", companyId: "c1", status: "superseded", date: "2026-11-03", createdAt: "3" },
    ];
    ck("a company's own time wins", appointmentFor(vs, "j", "c1")?.id === "b");
    ck("a company with none falls back to the whole-job time", appointmentFor(vs, "j", "c2")?.id === "a");
    const appts = jobAppointments(vs, "j", ["c1", "c2"]);
    ck("one appointment per company", appts.map((x) => x.visit?.id).join() === "b,a");
    ck("not booked while one company is still proposed", jobFullyBooked(appts) === false);
    ck("booked once every one is confirmed",
      jobFullyBooked([{ visit: { status: "confirmed" } }, { visit: { status: "confirmed" } }]) === true);
    const per = latestPerCompany(vs);
    ck("the newest per company, superseded left out", per.j.map((v) => v.id).sort().join() === "a,b");
    ck("the one that most needs somebody stands for the job", pressingVisit(per.j)?.id === "b");
  }
} catch (e) { ck("threw: " + (e?.stack || e), false); } finally {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
