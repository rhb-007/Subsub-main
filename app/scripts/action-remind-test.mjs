// "WAITING ON YOU" REMINDER EMAILS (080).
//
// Asked for as *"make sure everyone is getting notifications of all of these
// if there is an action item others are waiting on, there needs to be a
// sequence of emails that goes out until it's scheduled and cleared."*
//
// What this pins, against the real Worker and a stubbed mail provider:
//
//   EACH PARTY IS ASKED FOR ITS OWN MOVE. The crew to say when (and it reaches
//   the crew's OWN account, which is where Cascade's admin works), the crew to
//   confirm a time put to them, the tenant when it is their turn, the hiring
//   side when an approved request has nobody on it.
//
//   ONE DIGEST PER PERSON, ONLY THE LATEST STEP, AND NEVER TWICE.
//
//   THE HIRING SIDE HEARS ABOUT A CREW THAT HAS NOT MOVED, from day four.
//
//   IT STOPS BY ITSELF: a confirmed window, a job on hold and a booked job get
//   nothing.
//
//   node --no-warnings scripts/action-remind-test.mjs

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";
import { dueStep, parseWhen, REMIND_AFTER_HOURS } from "../shared/remind.js";

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");
const SCHEMA = readFileSync(join(app, "worker", "schema.sql"), "utf8");

// Mail goes to a stub. Anything else falls through to the real fetch.
const mails = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith("https://mail.test/")) {
    mails.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ id: `m${mails.length}` }), { status: 200 });
  }
  return realFetch(url, init);
};

const NOW = Date.parse("2026-10-15T15:00:00Z");
const ago = (h) => new Date(NOW - h * 3.6e6).toISOString().replace("T", " ").slice(0, 19);
const DAY = (n) => new Date(NOW + n * 864e5).toISOString().slice(0, 10);

const seed = () => {
  const db = freshDb({ base: SCHEMA, migrations: [] });
  db.exec(`
    INSERT INTO companies(id,company,contact,email,state) VALUES
      ('cmp_cas','Cascade Apartment Services','Ricard Brando','office@cascade.test','WA');
    INSERT INTO accounts(id,name,kind,subdomain,plan,company_id) VALUES
      ('acc_pm','Sound Property Management','property_manager','soundpm','scale',NULL),
      ('acc_cas','Cascade Apartment Services','subcontractor','cascade','basic','cmp_cas');
    INSERT INTO users(id,name,email,notify) VALUES
      ('u_mgr','Chris Lane','chris@soundpm.test',NULL),
      ('u_ten','John Smith','john@tenant.test',NULL),
      ('u_ten2','Ann Quiet','ann@tenant.test','{"email":false}'),
      ('u_ric','Ricard Brando','rbraun@cascade.test',NULL);
    INSERT INTO engagements(id,account_id,company_id,status,categories) VALUES
      ('en_cas','acc_pm','cmp_cas','active','["painting","plumbing"]');
    INSERT INTO properties(id,account_id,name,address,city,state,zip) VALUES
      ('prop_1','acc_pm','Press Apartments','1620 Belmont','Seattle','WA','98122');
    INSERT INTO memberships(id,user_id,account_id,role,company_id) VALUES
      ('m_mgr','u_mgr','acc_pm','admin',NULL),
      ('m_ten','u_ten','acc_pm','tenant',NULL),
      ('m_ten2','u_ten2','acc_pm','tenant',NULL),
      ('m_ric','u_ric','acc_cas','admin',NULL);
    INSERT INTO membership_properties(membership_id,property_id) VALUES ('m_ten','prop_1'),('m_ten2','prop_1');

    INSERT INTO jobs(id,account_id,property_id,title,trades,status,requested_by,approved_at,created_at) VALUES
      ('job_paint','acc_pm','prop_1','Paint is peeling off the ceiling','["painting"]','active','u_ten','${ago(60)}','${ago(60)}'),
      ('job_old','acc_pm','prop_1','Old untimed job','["painting"]','active','u_ten','${ago(200)}','${ago(200)}'),
      ('job_conf','acc_pm','prop_1','Time put to the crew','["painting"]','active',NULL,NULL,'${ago(60)}'),
      ('job_ten','acc_pm','prop_1','Time for the tenant','["painting"]','active','u_ten','${ago(60)}','${ago(60)}'),
      ('job_quiet','acc_pm','prop_1','Quiet tenant','["painting"]','active','u_ten2','${ago(60)}','${ago(60)}'),
      ('job_booked','acc_pm','prop_1','Booked job','["painting"]','active','u_ten','${ago(60)}','${ago(60)}'),
      ('job_held','acc_pm','prop_1','Held job','["painting"]','active',NULL,NULL,'${ago(200)}'),
      ('job_assign','acc_pm','prop_1','Nobody on it','["plumbing"]','active','u_ten','${ago(72)}','${ago(80)}');
    INSERT INTO work_orders(id,wo_number,job_id,trade,company_id,engagement_id,status,value_cents,issued_at,responded_at) VALUES
      ('wo_paint','WO-1','job_paint','painting','cmp_cas','en_cas','accepted',40000,'${ago(55)}','${ago(50)}'),
      ('wo_old','WO-2','job_old','painting','cmp_cas','en_cas','accepted',40000,'${ago(130)}','${ago(120)}'),
      ('wo_conf','WO-3','job_conf','painting','cmp_cas','en_cas','accepted',40000,'${ago(60)}','${ago(58)}'),
      ('wo_ten','WO-4','job_ten','painting','cmp_cas','en_cas','accepted',40000,'${ago(60)}','${ago(58)}'),
      ('wo_quiet','WO-5','job_quiet','painting','cmp_cas','en_cas','accepted',40000,'${ago(60)}','${ago(58)}'),
      ('wo_booked','WO-6','job_booked','painting','cmp_cas','en_cas','accepted',40000,'${ago(60)}','${ago(58)}'),
      ('wo_held','WO-7','job_held','painting','cmp_cas','en_cas','accepted',40000,'${ago(200)}','${ago(190)}');
    -- Sound put a time to the crew 30 hours ago: the crew's turn.
    INSERT INTO visits(id,account_id,job_id,proposed_by,date,start_time,end_time,status,manager_at,created_at) VALUES
      ('v_conf','acc_pm','job_conf','u_mgr','${DAY(5)}','09:00','11:00','proposed','${ago(30)}','${ago(30)}');
    -- The crew proposed, Sound approved 30 hours ago: the tenant's turn.
    INSERT INTO visits(id,account_id,job_id,proposed_by,date,start_time,end_time,status,contractor_at,manager_at,created_at) VALUES
      ('v_ten','acc_pm','job_ten','u_ric','${DAY(5)}','13:00','14:00','proposed','${ago(40)}','${ago(30)}','${ago(40)}'),
      ('v_quiet','acc_pm','job_quiet','u_ric','${DAY(5)}','13:00','14:00','proposed','${ago(40)}','${ago(30)}','${ago(40)}'),
      ('v_booked','acc_pm','job_booked','u_ric','${DAY(5)}','09:00','10:00','confirmed','${ago(40)}','${ago(30)}','${ago(40)}');
    INSERT INTO job_endings(job_id,account_id,kind,note,until,at) VALUES ('job_held','acc_pm','deferred','Waiting on parts',NULL,'${ago(100)}');
  `);
  return { db, env: { DB: makeD1(db), RESEND_API_KEY: "k", MAIL_FROM: "SubSub <no-reply@subsub.work>",
    RESEND_API_BASE: "https://mail.test" } };
};

// The module's own arithmetic.
ck("one day in is step 1", dueStep(ago(25), NOW, []) === 1);
ck("fifty hours in is step 2, not a backlog of 1 and 2", dueStep(ago(50), NOW, []) === 2);
ck("a step already sent is not sent again", dueStep(ago(50), NOW, [2]) === null);
ck("nothing before a day", dueStep(ago(10), NOW, []) === null);
ck("after the sixth it stops", dueStep(ago(2000), NOW, [6]) === null && REMIND_AFTER_HOURS.length === 6);
ck("a SQLite timestamp parses as UTC", parseWhen("2026-10-15 15:00:00") === NOW);

// Through the cron route, as the nightly trigger's manual twin is, with the
// clock pinned so "two days on" is a fact rather than a wait.
const realNow = Date.now;
const run = async (env, at = NOW) => {
  Date.now = () => at;
  try {
    const r = await worker.fetch(new Request("https://api.subsub.work/api/cron/action-reminders",
      { headers: { Authorization: "Bearer cron" } }), { ...env, CRON_SECRET: "cron" });
    return await r.json();
  } finally { Date.now = realNow; }
};

{
  const { db, env } = seed();
  {
    mails.length = 0;
    const r = await run(env);
    const to = (addr) => mails.filter((m) => [].concat(m.to).includes(addr));
    const ric = to("rbraun@cascade.test");
    const chris = to("chris@soundpm.test");
    const john = to("john@tenant.test");
    ck("the sweep sent something", r.sent > 0, JSON.stringify(r));
    ck("Cascade's admin gets one digest", ric.length === 1, String(ric.length));
    const rt = ric[0]?.text || "";
    ck("it asks them to propose a time for Sound's paint job",
      /Propose a time for "Paint is peeling off the ceiling" for Sound Property Management/.test(rt), rt.slice(0, 600));
    ck("and for the older one", /Old untimed job/.test(rt));
    ck("and to confirm the time Sound put to them", /Confirm .* for "Time put to the crew"/.test(rt));
    ck("and nothing that is not theirs to do", !/Booked job|Held job|Time for the tenant|Nobody on it/.test(rt), rt);
    ck("its link is Cascade's own account", /cascade\.subsub\.work/.test(rt) || /app\.subsub\.work/.test(rt), rt.match(/https?:\/\/\S+/)?.[0]);
    ck("the subject counts them", /^3 things are waiting on you$/.test(ric[0]?.subject || ""), ric[0]?.subject);

    ck("the tenant is asked to confirm when it is their turn", john.length === 1
      && /Confirm .* works for "Time for the tenant"/.test(john[0]?.text || ""), john[0]?.text?.slice(0, 300));
    ck("a tenant who switched email off is not emailed", to("ann@tenant.test").length === 0);

    const ct = chris[0]?.text || "";
    ck("Sound is told an approved request has nobody on it", /"Nobody on it" is approved and nobody is on it yet/.test(ct), ct.slice(0, 500));
    ck("and that Cascade has not proposed a time on the four-day-old job",
      /Cascade Apartment Services has not proposed a time for "Old untimed job"/.test(ct), ct.slice(0, 500));
    ck("but not about the two-day-old one yet", !/proposed a time for "Paint is peeling/.test(ct));

    const steps = db.prepare(`SELECT item_key, party, step FROM action_reminders WHERE job_id = 'job_paint' AND party = 'contractor'`).all();
    ck("only the latest step is recorded for the paint job", steps.length === 1 && steps[0].step === 2, JSON.stringify(steps));
    ck("and marked emailed", db.prepare(`SELECT emailed FROM action_reminders WHERE job_id = 'job_paint'`).get()?.emailed === 1);

    mails.length = 0;
    const again = await run(env);
    ck("running it again the same night sends nothing", again.sent === 0 && mails.length === 0, JSON.stringify(again));

    // Two days on: the paint job reaches step 3, and the crew answers the
    // other one, which takes it out.
    db.exec(`INSERT INTO visits(id,account_id,job_id,proposed_by,date,start_time,end_time,status,contractor_at,manager_at,responded_at,created_at)
      VALUES ('v_old','acc_pm','job_old','u_ric','${DAY(6)}','09:00','10:00','confirmed','${ago(1)}','${ago(1)}','${ago(1)}','${ago(1)}');`);
    mails.length = 0;
    await run(env, NOW + 48 * 3.6e6);
    const ric2 = mails.filter((m) => [].concat(m.to).includes("rbraun@cascade.test"));
    ck("two days on Cascade is reminded again", ric2.length === 1, String(ric2.length));
    ck("about the paint job still", /Paint is peeling/.test(ric2[0]?.text || ""));
    ck("but not about the job that is now booked", !/Old untimed job/.test(ric2[0]?.text || ""), ric2[0]?.text);

    // A database without 080.
    db.exec(`DROP TABLE action_reminders`);
    const skip = await run(env);
    ck("without 080 the sweep skips cleanly", /080/.test(skip.skipped || ""), JSON.stringify(skip));
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
