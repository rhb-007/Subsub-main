// THE PROPOSED TIME NEVER REACHED THE CONTRACTOR.
//
// Reported with two screenshots side by side. Sound Property Management's own
// Jobs screen: *"Proposed Oct 4, 2026 - 11 AM-1:15 PM - waiting on John Smith
// to confirm."* Pacific apartment maintenance's portal, same job, same
// minute: **No date**.
//
// 019 built `visits` as a manager-to-tenant conversation -- the manager
// proposes a window, the tenant confirms it because somebody has to be in --
// and `/api/my-work` never joined it. So the one party who physically turns
// up was the only party not told when, and was being asked to accept or
// decline work on that basis.
//
// What this pins:
//
//   THE APPOINTMENT IS ON THE WORK ORDER ROW. Both halves -- the row being
//   carried, and the right row being carried, since a job can have a trail of
//   superseded proposals behind it.
//
//   A SUPERSEDED OR DECLINED VISIT IS NOT AN APPOINTMENT. Driving to a time
//   the tenant refused is worse than having no time at all.
//
//   A CONFIRMED VISIT OUTRANKS THE JOB'S OWN DATE. The job column is what
//   somebody typed when it was raised; the visit is what the tenant agreed
//   to, and it is the later fact. Only a fixture where the two DISAGREE can
//   tell which one is being read.
//
//   AND THE VISITS LIST IS SCOPED BY THE WORK ORDER. `scopeClause` narrows by
//   buildings and a contractor has none, so that route handed a contractor
//   seat every appointment on the account -- including jobs they hold no work
//   order on. The same leak /api/jobs already closed, one table along.
//
//   node --no-warnings scripts/work-when-test.mjs

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";
import { workWhen, scheduledOn, isLiveVisit, WHEN_KINDS } from "../shared/schedule.js";

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
      ('acc_gc','Outerhome','general_contractor','outerhome','scale');
    INSERT INTO companies(id,company,contact,email) VALUES
      ('cmp_pac','Pacific apartment maintenance','Juan Soto','juan@pacificam.test'),
      ('cmp_other','Bay Roofing Inc','Mia Cross','mia@bay.test');
    INSERT INTO users(id,name,email) VALUES
      ('u_juan','Juan Soto','juan@pacificam.test'),
      ('u_mgr','Chris Lane','chris@soundpm.test');
    INSERT INTO memberships(id,user_id,account_id,role,company_id) VALUES
      ('m_juan','u_juan','acc_pm','contractor','cmp_pac'),
      ('m_mgr','u_mgr','acc_pm','admin',NULL);
    INSERT INTO engagements(id,account_id,company_id,status,categories) VALUES
      ('en_pac','acc_pm','cmp_pac','active','["electrical"]'),
      ('en_other','acc_pm','cmp_other','active','["roofing"]');

    -- The reported job: no date of its own, one proposed visit.
    INSERT INTO jobs(id,account_id,title,address,trades,status,created_at) VALUES
      ('job_brk','acc_pm','Sparking breaker','4915 North Highland ST, Ruston','["electrical"]','active','2026-10-02 10:00:00');
    INSERT INTO work_orders(id,wo_number,job_id,trade,company_id,engagement_id,status,value_cents)
      VALUES ('wo_brk','WO-209115','job_brk','electrical','cmp_pac','en_pac','accepted',10000);
    -- A superseded earlier proposal, so "the newest live one" is a real
    -- question rather than "the only one".
    INSERT INTO visits(id,account_id,job_id,proposed_by,date,start_time,end_time,status,created_at)
      VALUES ('vis_old','acc_pm','job_brk','u_mgr','2026-10-02','08:00','09:00','superseded','2026-10-01 09:00:00');
    INSERT INTO visits(id,account_id,job_id,proposed_by,date,start_time,end_time,note,status,created_at)
      VALUES ('vis_live','acc_pm','job_brk','u_mgr','2026-10-04','11:00','13:15','Gate code 4417','proposed','2026-10-02 10:30:00');

    -- A job that DOES carry its own date, with a confirmed visit on a
    -- DIFFERENT day. The only fixture either rule can be told apart on.
    INSERT INTO jobs(id,account_id,title,date,time,trades,status,created_at) VALUES
      ('job_sink','acc_pm','Leaking sink','2026-10-01','07:00','["plumbing"]','active','2026-09-30 10:00:00');
    INSERT INTO work_orders(id,wo_number,job_id,trade,company_id,engagement_id,status,value_cents)
      VALUES ('wo_sink','WO-745746','job_sink','plumbing','cmp_pac','en_pac','accepted',10000);
    INSERT INTO visits(id,account_id,job_id,proposed_by,date,start_time,end_time,status,created_at)
      VALUES ('vis_sink','acc_pm','job_sink','u_mgr','2026-10-09','14:00','16:00','confirmed','2026-10-02 09:00:00');

    -- A job on the SAME account that Pacific holds no work order on, with a
    -- visit of its own. The only row that can show whether the visits list is
    -- scoped -- without it, a leak and a clean list look identical.
    INSERT INTO jobs(id,account_id,title,trades,status,created_at) VALUES
      ('job_theirs','acc_pm','Roof at the other building','["roofing"]','active','2026-10-02 10:00:00');
    INSERT INTO work_orders(id,wo_number,job_id,trade,company_id,engagement_id,status,value_cents)
      VALUES ('wo_theirs','WO-999','job_theirs','roofing','cmp_other','en_other','accepted',50000);
    INSERT INTO visits(id,account_id,job_id,proposed_by,date,start_time,status,created_at)
      VALUES ('vis_theirs','acc_pm','job_theirs','u_mgr','2026-10-07','09:00','confirmed','2026-10-02 09:30:00');

    -- A visit the tenant REFUSED. Not an appointment, and the difference is
    -- somebody driving to a time that was turned down.
    INSERT INTO jobs(id,account_id,title,trades,status,created_at) VALUES
      ('job_dec','acc_pm','Hallway light','["electrical"]','active','2026-10-02 10:00:00');
    INSERT INTO work_orders(id,wo_number,job_id,trade,company_id,engagement_id,status,value_cents)
      VALUES ('wo_dec','WO-111','job_dec','electrical','cmp_pac','en_pac','accepted',10000);
    INSERT INTO visits(id,account_id,job_id,proposed_by,date,start_time,status,created_at)
      VALUES ('vis_dec','acc_pm','job_dec','u_mgr','2026-10-05','10:00','declined','2026-10-02 09:00:00');
  `);
  return { db, env: { DB: makeD1(db) } };
};

const get = (env, path, who, acct) => worker.fetch(
  new Request(`https://api.subsub.work${path}`, {
    headers: { "X-User-Id": who, "X-Account-Id": acct },
  }), env);
const json = async (r) => [r.status, await r.json().catch(() => ({}))];

try {
  // -------------------------------------------------------------------------
  console.log("\n-- the appointment reaches the contractor --");
  const { env } = seed();
  const [s, b] = await json(await get(env, "/api/my-work", "u_juan", "acc_pm"));
  ck("the portal's list answers", s === 200, `${s} ${JSON.stringify(b).slice(0, 200)}`);
  const work = b.work || [];
  const brk = work.find((w) => w.jobId === "job_brk");
  ck("the reported job is on it", !!brk, JSON.stringify(work.map((w) => w.jobId)));
  // THE WHOLE REPORT. The screenshot read "No date" over exactly this row.
  ck("and it carries the proposed visit", !!brk?.visit, JSON.stringify(brk?.visit));
  ck("with the date somebody proposed", brk?.visit?.date === "2026-10-04", String(brk?.visit?.date));
  ck("and the window", brk?.visit?.startTime === "11:00" && brk?.visit?.endTime === "13:15",
    `${brk?.visit?.startTime}-${brk?.visit?.endTime}`);
  ck("said to be proposed rather than agreed", brk?.visit?.status === "proposed", String(brk?.visit?.status));
  // Whoever proposed it may have said something the contractor needs -- a gate
  // code, a dog, which entrance.
  ck("and the proposer's note rides with it", brk?.visit?.note === "Gate code 4417", String(brk?.visit?.note));

  {
    // THE NEWEST LIVE ONE, not the first row the table felt like handing back.
    // A job collects superseded proposals, and serving one is a date nobody
    // agreed to drawn as the appointment.
    ck("a superseded earlier proposal is not the one served",
      brk?.visit?.id === "vis_live", String(brk?.visit?.id));
  }

  {
    // A REFUSED TIME IS NOT AN APPOINTMENT.
    const dec = work.find((w) => w.jobId === "job_dec");
    ck("a declined visit is not carried at all", dec && dec.visit === null,
      JSON.stringify(dec?.visit));
  }

  // -------------------------------------------------------------------------
  console.log("\n-- which of the two dates a row means --");
  {
    const sink = work.find((w) => w.jobId === "job_sink");
    // The discriminating fixture: the job says the 1st, the confirmed visit
    // says the 9th. Reading the job column passes every assertion above.
    ck("the job carries its own date", sink?.date === "2026-10-01", String(sink?.date));
    ck("and a confirmed visit on a different day", sink?.visit?.date === "2026-10-09",
      String(sink?.visit?.date));
    const w = workWhen(sink);
    ck("the confirmed visit is what the row MEANS", w.kind === "confirmed" && w.date === "2026-10-09",
      JSON.stringify(w));
    ck("and that is the day it goes on a calendar", scheduledOn(sink) === "2026-10-09",
      String(scheduledOn(sink)));
  }
  {
    const w = workWhen(work.find((x) => x.jobId === "job_brk"));
    ck("a proposed visit is named as proposed", w.kind === "proposed" && w.date === "2026-10-04",
      JSON.stringify(w));
    // It still earns a place on the strip. A contractor needs to know somebody
    // has ASKED for Saturday as much as that Saturday is agreed.
    ck("and still lands on a day", scheduledOn(work.find((x) => x.jobId === "job_brk")) === "2026-10-04");
  }
  {
    // No visit at all falls back to the job's own date, which is where this
    // product started and is still the honest answer for work with nobody to
    // let anybody in.
    const w = workWhen({ date: "2026-11-02", time: "08:00", visit: null });
    ck("no visit falls back to the job's date", w.kind === "target" && w.date === "2026-11-02",
      JSON.stringify(w));
    const none = workWhen({ date: null, time: null, visit: null });
    ck("and nothing anywhere says so rather than drawing a blank",
      none.kind === "none" && none.date === null, JSON.stringify(none));
    ck("every kind has words to go with it",
      Object.values(WHEN_KINDS).every((k) => k.lead && k.note && k.tone));
  }
  {
    // A visit that has been and gone, or was replaced, is not a live one.
    ck("only proposed and confirmed are live",
      isLiveVisit({ status: "proposed" }) && isLiveVisit({ status: "confirmed" })
      && !isLiveVisit({ status: "declined" }) && !isLiveVisit({ status: "superseded" })
      && !isLiveVisit({ status: "missed" }) && !isLiveVisit({ status: "happened" })
      && !isLiveVisit(null));
  }

  // -------------------------------------------------------------------------
  console.log("\n-- and the visits list is narrowed to their own work --");
  {
    const [vs, vb] = await json(await get(env, "/api/visits", "u_juan", "acc_pm"));
    ck("a contractor seat may read it", vs === 200, `${vs} ${JSON.stringify(vb).slice(0, 120)}`);
    const ids = (Array.isArray(vb) ? vb : []).map((v) => v.id).sort();
    // Scoped by the WORK ORDER, which is the thing that says this job was
    // given to them -- not by buildings, which a contractor has none of.
    ck("they get their own jobs' appointments",
      ids.includes("vis_live") && ids.includes("vis_sink"), JSON.stringify(ids));
    // THE LEAK. Without the scope this is every appointment on the account:
    // when a manager is due at every other building, for companies this one
    // has nothing to do with.
    ck("and not a job they hold no work order on",
      !ids.includes("vis_theirs"), JSON.stringify(ids));
    // A superseded one is nobody's appointment, and the route already said so.
    ck("nor a superseded proposal", !ids.includes("vis_old"), JSON.stringify(ids));
  }
  {
    // The other branch, in the same place: narrowing everybody would be a
    // manager who can no longer see their own building's appointments.
    const [, vb] = await json(await get(env, "/api/visits", "u_mgr", "acc_pm"));
    const ids = (Array.isArray(vb) ? vb : []).map((v) => v.id);
    ck("an admin still sees the whole account",
      ids.includes("vis_live") && ids.includes("vis_theirs"), JSON.stringify(ids));
  }

  // -------------------------------------------------------------------------
  console.log("\n-- the screens read the one rule --");
  {
    const src = readFileSync(join(app, "src", "App.tsx"), "utf8");
    ck("the card reads workWhen rather than the job column",
      /const when = workWhen\(job\)/.test(src));
    // The thing that was there, and must not come back: the raw job date as
    // the only answer on a contractor's card.
    ck("and no longer falls back to the bare job date there",
      !/<span><Calendar size=\{12\} \/> \{formatWhen\(job\.date, job\.time\) \|\| job\.date \|\| "No date"\}<\/span>/.test(src));
    ck("the schedule panel is mounted on the portal", /<MySchedule rows=/.test(src));
    // Two states reading the same pixels is the chip bug this project already
    // paid for: correct markup, nothing on screen.
    ck("and the three tones have rules of their own",
      /\.jr-whennote\.jrw-ok\{/.test(src) && /\.jr-whennote\.jrw-wait\{/.test(src)
      && /\.mysw-ok\{/.test(src) && /\.mysw-wait\{/.test(src));
    ck("the accepted chip names the company",
      /Accepted\{subName\(subs, a\.subId\)/.test(src));
  }
} catch (err) {
  fail++;
  console.log("FAIL  the suite threw  --", err?.message || String(err));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
