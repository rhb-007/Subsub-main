// AUTO-SCHEDULED MEANS A TIME, NOT ONLY A YES -- end to end through the real
// Worker.
//
// Reported from the crew's own card: a job issued to a company that has granted
// auto-schedule went out ACCEPTED, read "Auto-scheduled, booked to your
// calendar", and had no day on it anywhere -- "No date yet", with nothing to
// press. Accepting was automatic and choosing the day was nobody's job.
//
// What is pinned:
//
//   ISSUING TO AN AUTO-SCHEDULED CREW PUTS A WINDOW FORWARD. The job's own
//   date and time when still ahead and they are free, otherwise their next
//   free working day.
//
//   THE CREW'S GRANT IS THEIR AGREEMENT, so the window is not sent back to
//   them to confirm -- but a day they marked themselves out of still is, and a
//   grant withdrawn stops counting on the next window.
//
//   NOTHING ELSE MOVES. A crew that has not granted it gets an offer and no
//   window; a job that already has a live window keeps it.
//
//   node --no-warnings scripts/auto-book-test.mjs

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";
import { slotFor, AUTO_START, AUTO_END } from "../shared/autopick.js";

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");
const SCHEMA = readFileSync(join(app, "worker", "schema.sql"), "utf8");

const DAY = 86400000;
const today = new Date().toISOString().slice(0, 10);
const plus = (n) => new Date(Date.parse(today + "T12:00:00Z") + n * DAY).toISOString().slice(0, 10);
const AHEAD = plus(10);
const OUT = plus(12);
const VERIFIED = `{"insurance":{"status":"verified"},"bond":{"status":"verified"},"contract":{"status":"verified"},"w9":{"status":"verified"}}`;

const seed = () => {
  const db = freshDb({ base: SCHEMA, migrations: [] });
  db.exec(`
    INSERT INTO accounts(id,name,kind,subdomain,plan) VALUES
      ('acc_pm','Sound Property Management','property_manager','soundpm','scale');
    INSERT INTO users(id,name,email) VALUES
      ('u_mgr','Chris Lane','chris@soundpm.test'),
      ('u_ten','John Smith','john@t.test');
    INSERT INTO memberships(id,user_id,account_id,role,unit) VALUES
      ('m_mgr','u_mgr','acc_pm','admin',NULL),
      ('m_ten','u_ten','acc_pm','tenant','3B');
    INSERT INTO companies(id,company,contact,email,state,insurance,bond,contract,w9,unavailable_days) VALUES
      ('cmp_auto','Pacific apartment maintenance','Juan','juan@pac.test','WA',1,1,1,1,'["${OUT}"]'),
      ('cmp_ask','Ask First Glazing','Ann','ann@ask.test','WA',1,1,1,1,'[]');
    INSERT INTO engagements(id,account_id,company_id,status,categories,doc_review,auto_schedule) VALUES
      ('en_auto','acc_pm','cmp_auto','active','["windows_doors"]','${VERIFIED}',1),
      ('en_ask','acc_pm','cmp_ask','active','["windows_doors"]','${VERIFIED}',0);
    INSERT INTO jobs(id,account_id,title,trades,date,time,status,requested_by,approved_at,access) VALUES
      -- The reported shape: a tenant's report, approved, no date at all.
      ('j_nodate','acc_pm','Bedroom window frame is bent','["windows_doors"]',NULL,NULL,'active','u_ten','2026-10-01 09:00:00','tenant'),
      -- The account typed a date and a time, and the crew is free on it.
      ('j_dated','acc_pm','Sash cord','["windows_doors"]','${AHEAD}','13:30','active',NULL,NULL,NULL),
      -- Dated on a day the crew marked themselves out.
      ('j_out','acc_pm','Cracked pane','["windows_doors"]','${OUT}',NULL,'active',NULL,NULL,NULL),
      -- A crew that has NOT granted it.
      ('j_ask','acc_pm','Sticky door','["windows_doors"]',NULL,NULL,'active',NULL,NULL,NULL),
      -- Already has a window somebody proposed.
      ('j_timed','acc_pm','Loose hinge','["windows_doors"]',NULL,NULL,'active',NULL,NULL,NULL);
    INSERT INTO visits(id,account_id,job_id,proposed_by,date,start_time,end_time,status,manager_at)
      VALUES ('v_kept','acc_pm','j_timed','u_mgr','${AHEAD}','08:00','09:00','proposed','2026-10-01 09:00:00');
  `);
  return { db, env: { DB: makeD1(db), FILES: { put: async () => {}, get: async () => null } } };
};

const call = (env, path, body, who = "u_mgr") => worker.fetch(
  new Request(`https://api.subsub.work${path}`, {
    method: "POST", body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", "X-User-Id": who, "X-Account-Id": "acc_pm" },
  }), env);
const json = async (r) => [r.status, await r.json().catch(() => ({}))];
const assign = (env, jobId, companyId) => call(env, `/api/jobs/${jobId}/assign`,
  { trade: "windows_doors", companyId, payKind: "fixed", value: "75", responseWindow: "24h" });
const live = (db, jobId) => db.prepare(
  `SELECT * FROM visits WHERE job_id = ? AND status IN ('proposed','confirmed') ORDER BY created_at DESC, rowid DESC`).all(jobId);

try {
  const { db, env } = seed();

  console.log("\n-- the reported job: auto-scheduled, no date anywhere --");
  {
    const [st, body] = await json(await assign(env, "j_nodate", "cmp_auto"));
    ck("the work order goes out accepted, as the grant says", st === 201 && body.status === "accepted",
      JSON.stringify({ st, s: body.status, e: body.error }));
    const v = live(db, "j_nodate");
    const want = slotFor({ from: today, busy: [], unavailable: [OUT] });
    ck("and a window is put forward on the spot", v.length === 1, JSON.stringify(v.map((x) => x.date)));
    ck("on their next free working day", v[0]?.date === want, `${v[0]?.date} vs ${want}`);
    ck("in the standing morning slot", v[0]?.start_time === AUTO_START && v[0]?.end_time === AUTO_END,
      `${v[0]?.start_time}-${v[0]?.end_time}`);
    ck("the reply says so", body.autoBooked?.proposed === true && body.autoBooked?.date === want,
      JSON.stringify(body.autoBooked));
    // THE CREW'S GRANT IS THEIR YES. Asking them to confirm a time on a free
    // day is the round trip they switched off.
    ck("the crew is not asked to confirm it", !!v[0]?.contractor_at, String(v[0]?.contractor_at));
    ck("the hiring side agreed by proposing", !!v[0]?.manager_at);
    // The tenant has to be in, so it is still theirs to confirm -- it is not
    // booked behind their back.
    ck("and it waits on the tenant, who has to be in", v[0]?.status === "proposed", v[0]?.status);
  }

  console.log("\n-- a job with its own date and time, on a free day --");
  {
    const [st, body] = await json(await assign(env, "j_dated", "cmp_auto"));
    const v = live(db, "j_dated");
    ck("it uses the job's own day", st === 201 && v[0]?.date === AHEAD, `${v[0]?.date} vs ${AHEAD}`);
    ck("and the job's own time", v[0]?.start_time === "13:30" && v[0]?.end_time === "14:30",
      `${v[0]?.start_time}-${v[0]?.end_time}`);
    // Nobody but the crew and the hiring side, and both have agreed.
    ck("and with no tenant to ask it is booked", v[0]?.status === "confirmed", v[0]?.status);
    const job = db.prepare(`SELECT date FROM jobs WHERE id = 'j_dated'`).get();
    ck("which puts it on the job", job.date === AHEAD, String(job.date));
    void body;
  }

  console.log("\n-- dated on a day they marked themselves out --");
  {
    await assign(env, "j_out", "cmp_auto");
    const v = live(db, "j_out");
    ck("it moves off the day they are out", v.length === 1 && v[0].date !== OUT && v[0].date > OUT,
      JSON.stringify(v.map((x) => x.date)));
  }

  console.log("\n-- a crew that has not granted it --");
  {
    const [st, body] = await json(await assign(env, "j_ask", "cmp_ask"));
    ck("gets an offer, pending", st === 201 && body.status === "pending", body.status);
    ck("and no window is invented for them", live(db, "j_ask").length === 0);
    ck("the reply says nothing was booked", body.autoBooked === null, JSON.stringify(body.autoBooked));
  }

  console.log("\n-- a job that already has a window --");
  {
    await assign(env, "j_timed", "cmp_auto");
    const v = live(db, "j_timed");
    ck("the window somebody proposed is kept", v.length === 1 && v[0].id === "v_kept",
      JSON.stringify(v.map((x) => x.id)));
  }

  console.log("\n-- what the grant does and does not agree to --");
  {
    // A manager proposing by hand on a day the crew marked out: the grant was
    // never for that day, so they are asked.
    const [st1] = await json(await call(env, "/api/jobs/j_dated/visits",
      { date: OUT, startTime: "10:00", endTime: "11:00" }));
    const v1 = live(db, "j_dated")[0];
    ck("a hand-picked day they are out is still put to them", st1 === 201 && v1.date === OUT && !v1.contractor_at,
      JSON.stringify({ st1, d: v1?.date, c: v1?.contractor_at }));
    // And withdrawing the grant counts from the very next window.
    db.prepare(`UPDATE engagements SET auto_schedule = 0 WHERE id = 'en_auto'`).run();
    const [st2] = await json(await call(env, "/api/jobs/j_dated/visits",
      { date: AHEAD, startTime: "10:00", endTime: "11:00" }));
    const v2 = live(db, "j_dated")[0];
    ck("and a grant withdrawn stops counting", st2 === 201 && !v2.contractor_at && v2.status === "proposed",
      JSON.stringify({ st2, c: v2?.contractor_at, s: v2?.status }));
  }

  console.log("\n-- the screen --");
  {
    const src = readFileSync(join(app, "src", "App.tsx"), "utf8");
    ck("the card offers a way to set a time when there is none",
      /needsTime && !mustAnswer && onProposeVisit[\s\S]{0,400}Propose a time/.test(src));
    ck("and only says booked when there is a booking",
      /when\.kind === "confirmed"\s*\?\s*"Auto-scheduled — booked to your calendar"/.test(src));
  }
} catch (err) {
  fail++;
  console.error("FAIL  the suite threw:", err);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
