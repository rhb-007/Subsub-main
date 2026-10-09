// A SUBCONTRACTOR ACCOUNT'S OWN TEAM SETS ITS CREWS AND DAYS OFF, AND
// AUTO-SCHEDULING READS THEM -- end to end through the real Worker.
//
// Reported as "where do I adjust my availability, I can't find it". The
// contractor seat sets it under Job Settings; the business owner, signed in as
// the subcontractor account's own admin, had no screen at all. And underneath
// that: every auto-scheduling path in the Worker read companies.unavailable_days,
// a company-wide list no screen has written since availability moved onto
// crews. So a crew that had marked a day off was still booked on it.
//
// What is pinned:
//
//   PATCH /api/my-company TAKES crews ON ITS OWN, checks the shape on the way
//   in (it lands on the shared row every hiring account reads), and refuses a
//   body that is not a list by name.
//
//   A DAY IS OFF ONLY WHEN EVERY WORKING CREW HAS IT OFF. One crew on holiday
//   is not the company on holiday.
//
//   EVERY CREW PAUSED IS NOT TAKING WORK, which a list of dates cannot say.
//
//   ISSUING, A HAND-PICKED TIME AND THE TURNAROUND RANKING all read it.
//
//   node --no-warnings scripts/own-crews-test.mjs

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";
import { validCrews, offDays, isOffOn } from "../shared/crews.js";
import { rankCandidates } from "../shared/autopick.js";

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");
const SCHEMA = readFileSync(join(app, "worker", "schema.sql"), "utf8");

const DAY = 86400000;
const today = new Date().toISOString().slice(0, 10);
const plus = (n) => new Date(Date.parse(today + "T12:00:00Z") + n * DAY).toISOString().slice(0, 10);
const AHEAD = plus(10);
const BOTH_OFF = plus(12);
const ONE_OFF = plus(14);
const VERIFIED = `{"insurance":{"status":"verified"},"bond":{"status":"verified"},"contract":{"status":"verified"},"w9":{"status":"verified"}}`;

const CREWS = [
  { id: "a", name: "Crew A", available: true, unavailableDays: [BOTH_OFF, ONE_OFF], members: [{ name: "Juan", role: "Lead" }] },
  { id: "b", name: "Crew B", available: true, unavailableDays: [BOTH_OFF], members: [{ name: "Ana", role: "" }] },
];

const seed = () => {
  const db = freshDb({ base: SCHEMA, migrations: [] });
  db.exec(`
    INSERT INTO accounts(id,name,kind,subdomain,plan) VALUES
      ('acc_sub','Cascade Apartment Services','subcontractor','cascade','basic'),
      ('acc_pm','Sound Property Management','property_manager','soundpm','scale');
    INSERT INTO users(id,name,email) VALUES
      ('u_own','R Braun','rb@cascade.test'),
      ('u_mgr','Chris Lane','chris@soundpm.test');
    INSERT INTO memberships(id,user_id,account_id,role) VALUES
      ('m_own','u_own','acc_sub','admin'),
      ('m_mgr','u_mgr','acc_pm','admin');
    INSERT INTO companies(id,company,contact,email,state,insurance,bond,contract,w9,crews) VALUES
      ('cmp_crews','Crewed Glazing','Juan','juan@crew.test','WA',1,1,1,1,'${JSON.stringify(CREWS)}');
    INSERT INTO engagements(id,account_id,company_id,status,categories,doc_review,auto_schedule) VALUES
      ('en_crews','acc_pm','cmp_crews','active','["windows_doors"]','${VERIFIED}',1);
    INSERT INTO jobs(id,account_id,title,trades,date,time,status) VALUES
      ('j_both','acc_pm','Cracked pane','["windows_doors"]','${BOTH_OFF}','10:00','active'),
      ('j_one','acc_pm','Sash cord','["windows_doors"]','${ONE_OFF}','10:00','active'),
      ('j_hand','acc_pm','Sticky door','["windows_doors"]',NULL,NULL,'active');
  `);
  return { db, env: { DB: makeD1(db), FILES: { put: async () => {}, get: async () => null } } };
};

const call = (env, path, body, { who = "u_mgr", acct = "acc_pm", method = "POST" } = {}) => worker.fetch(
  new Request(`https://api.subsub.work${path}`, {
    method, body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "Content-Type": "application/json", "X-User-Id": who, "X-Account-Id": acct },
  }), env);
const json = async (r) => [r.status, await r.json().catch(() => ({}))];
const live = (db, jobId) => db.prepare(
  `SELECT * FROM visits WHERE job_id = ? AND status IN ('proposed','confirmed') ORDER BY created_at DESC, rowid DESC`).all(jobId);
const assign = (env, jobId) => call(env, `/api/jobs/${jobId}/assign`,
  { trade: "windows_doors", companyId: "cmp_crews", payKind: "fixed", value: "75", responseWindow: "24h" });

try {
  console.log("\n-- the rules --");
  {
    ck("not a list is refused by name", validCrews({ a: 1 }) === null && validCrews("x") === null);
    const v = validCrews([
      { id: "a", name: " Crew A ", unavailableDays: ["2026-10-07", "nope", "2026-10-06", "2026-10-07"],
        members: [{ name: "Juan" }, { name: "  " }] },
      { id: "a", name: "Crew B", available: false, members: [{ name: "Ana", role: "Lead" }] },
      { name: "Nobody on it", members: [{ name: "" }] },
      { name: "", members: [{ name: "Ghost" }] },
    ]);
    ck("a crew with nobody on it, or no name, is dropped", v.length === 2, JSON.stringify(v.map((c) => c.name)));
    ck("names are trimmed and blank members dropped",
      v[0].name === "Crew A" && v[0].members.length === 1 && v[0].members[0].role === "", JSON.stringify(v[0]));
    ck("days off are real dates, once each, in order",
      JSON.stringify(v[0].unavailableDays) === '["2026-10-06","2026-10-07"]', JSON.stringify(v[0].unavailableDays));
    ck("a duplicated id is made unique", v[0].id !== v[1].id, `${v[0].id} / ${v[1].id}`);
    ck("a paused crew stays paused", v[1].available === false && v[0].available === true);
    ck("every crew carries the whole shape",
      v.every((c) => Array.isArray(c.members) && Array.isArray(c.unavailableDays)));

    const o = offDays({ crews: CREWS });
    ck("a day is off when every working crew has it off", o.days.includes(BOTH_OFF), JSON.stringify(o.days));
    ck("and NOT when one crew can still go", !o.days.includes(ONE_OFF), JSON.stringify(o.days));
    ck("a paused crew does not hold a day open",
      offDays({ crews: [CREWS[0], { ...CREWS[1], available: false, unavailableDays: [] }] }).days.includes(ONE_OFF));
    ck("every crew paused is not taking work at all",
      offDays({ crews: CREWS.map((c) => ({ ...c, available: false })) }).allPaused === true
      && isOffOn({ crews: CREWS.map((c) => ({ ...c, available: false })) }, AHEAD));
    // Most contractors never fill My Crews in. "No crews" must not read as
    // "never free", or auto-scheduling stops for all of them.
    ck("no crews is not never free", isOffOn({ crews: [] }, AHEAD) === false);
    ck("and the old company-wide list still counts",
      isOffOn({ unavailableDays: [AHEAD], crews: CREWS }, AHEAD) === true);

    const r = rankCandidates([
      { companyId: "p", company: "AAA Paused", categories: ["cleaning"], rating: 5, blockers: [],
        busy: [], unavailable: [], paused: true },
      { companyId: "f", company: "Free", categories: ["cleaning"], rating: 3, blockers: [],
        busy: [], unavailable: [] },
    ], { trade: "cleaning", from: "2026-10-05" });
    ck("the ranking passes over a company with every crew paused",
      r.picked?.companyId === "f" && r.skipped?.some((x) => x.companyId === "p" && x.why === "paused"),
      JSON.stringify({ pick: r.picked?.companyId, skipped: r.skipped }));
  }

  console.log("\n-- the account's own admin saves crews --");
  {
    const { db, env } = seed();
    const own = { who: "u_own", acct: "acc_sub" };
    const [s0, g0] = await json(await call(env, "/api/my-company", undefined, { ...own, method: "GET" }));
    ck("their company reads back with a crews list", s0 === 200 && Array.isArray(g0.crews), `${s0} ${JSON.stringify(g0.crews)}`);

    const [s1, b1] = await json(await call(env, "/api/my-company", { crews: [
      { id: "x", name: "Day crew", unavailableDays: [AHEAD, "garbage"], members: [{ name: "Rob", role: "Owner" }, { name: "" }] },
    ] }, { ...own, method: "PATCH" }));
    ck("crews alone is a complete request", s1 === 200, `${s1} ${JSON.stringify(b1)}`);
    ck("and the reply is what was stored, cleaned",
      b1.crews?.length === 1 && b1.crews[0].members.length === 1
      && JSON.stringify(b1.crews[0].unavailableDays) === JSON.stringify([AHEAD]), JSON.stringify(b1.crews));
    const row = db.prepare(`SELECT c.crews FROM companies c JOIN accounts a ON a.company_id = c.id WHERE a.id = 'acc_sub'`).get();
    // THE COLUMN, not the route's answer: the read path normalises too, so
    // checking the reply would report a clean shape over a stored one that is not.
    const stored = JSON.parse(row?.crews || "null");
    ck("the stored column is the cleaned shape",
      stored?.[0]?.name === "Day crew" && stored[0].members.length === 1 && !stored[0].unavailableDays.includes("garbage"),
      String(row?.crews));

    const [s2, b2] = await json(await call(env, "/api/my-company", { crews: "Crew A" }, { ...own, method: "PATCH" }));
    ck("a crews value that is not a list is refused by name", s2 === 400 && b2.error === "invalid_crews", `${s2} ${b2.error}`);
    const after = db.prepare(`SELECT c.crews FROM companies c JOIN accounts a ON a.company_id = c.id WHERE a.id = 'acc_sub'`).get();
    ck("and nothing is written", after?.crews === row?.crews, String(after?.crews));

    // NOT the hiring account's row. A property manager is not hireable, so the
    // same route answers not_hireable rather than writing somewhere.
    const [s3, b3] = await json(await call(env, "/api/my-company", { crews: [] }, { method: "PATCH" }));
    ck("a property manager has no company of its own to write", s3 === 409 && b3.error === "not_hireable", `${s3} ${b3.error}`);
  }

  console.log("\n-- issuing to an auto-scheduled crew reads the crews --");
  {
    const { db, env } = seed();
    const [s1] = await json(await assign(env, "j_both"));
    const v1 = live(db, "j_both");
    ck("a job dated on a day EVERY crew has off moves",
      s1 === 201 && v1.length === 1 && v1[0].date !== BOTH_OFF, JSON.stringify({ s1, d: v1.map((x) => x.date) }));

    const [s2] = await json(await assign(env, "j_one"));
    const v2 = live(db, "j_one");
    ck("one crew off and the other free keeps the job's own day",
      s2 === 201 && v2[0]?.date === ONE_OFF, JSON.stringify({ s2, d: v2.map((x) => x.date) }));
    ck("and the grant agrees to it for them", !!v2[0]?.contractor_at, String(v2[0]?.contractor_at));

    // A HAND-PICKED DAY EVERY CREW HAS OFF: the grant was never for that day.
    await assign(env, "j_hand");
    const [s3] = await json(await call(env, "/api/jobs/j_hand/visits", { date: BOTH_OFF, startTime: "10:00", endTime: "11:00" }));
    const v3 = live(db, "j_hand")[0];
    ck("a hand-picked day every crew has off is still put to them",
      s3 === 201 && v3?.date === BOTH_OFF && !v3?.contractor_at, JSON.stringify({ s3, d: v3?.date, c: v3?.contractor_at }));
    const [s4] = await json(await call(env, "/api/jobs/j_hand/visits", { date: ONE_OFF, startTime: "10:00", endTime: "11:00" }));
    const v4 = live(db, "j_hand")[0];
    ck("and one a crew is free on is agreed by the grant",
      s4 === 201 && v4?.date === ONE_OFF && !!v4?.contractor_at, JSON.stringify({ s4, d: v4?.date, c: v4?.contractor_at }));
  }

  console.log("\n-- every crew paused --");
  {
    const { db, env } = seed();
    db.prepare(`UPDATE companies SET crews = ? WHERE id = 'cmp_crews'`)
      .run(JSON.stringify(CREWS.map((c) => ({ ...c, available: false }))));
    const [s, b] = await json(await assign(env, "j_one"));
    ck("the work order still goes", s === 201, String(s));
    ck("but no window is put forward", live(db, "j_one").length === 0,
      JSON.stringify(live(db, "j_one").map((x) => x.date)));
    ck("and the reply says why", b.autoBooked?.proposed === false && b.autoBooked?.reason === "paused",
      JSON.stringify(b.autoBooked));
  }

  console.log("\n-- the turnaround ranking reads the crews --");
  {
    const MON = "2026-10-05", TUE = "2026-10-06";
    const crewsOff = (day) => JSON.stringify([
      { id: "a", name: "A", available: true, unavailableDays: [day], members: [{ name: "x" }] },
      { id: "b", name: "B", available: true, unavailableDays: [day], members: [{ name: "y" }] },
    ]);
    const paused = JSON.stringify([{ id: "a", name: "A", available: false, unavailableDays: [], members: [{ name: "x" }] }]);
    const turn = async (goodCrews, fastCrews) => {
      const db = freshDb({ base: SCHEMA, migrations: [] });
      db.exec(`
        INSERT INTO accounts(id,name,kind,subdomain,plan,auto_turnaround) VALUES
          ('acc_pm','Sound Property Management','property_manager','soundpm','scale',1);
        INSERT INTO users(id,name,email) VALUES ('u_mgr','Chris Lane','chris@soundpm.test');
        INSERT INTO memberships(id,user_id,account_id,role) VALUES ('m_mgr','u_mgr','acc_pm','admin');
        INSERT INTO companies(id,company,contact,email,state,insurance,bond,contract,w9,crews) VALUES
          ('cmp_good','Good Crew','Gus','gus@good.test','WA',1,1,1,1,'${goodCrews}'),
          ('cmp_fast','Fast Turnarounds','Fay','fay@fast.test','WA',1,1,1,1,'${fastCrews}');
        INSERT INTO engagements(id,account_id,company_id,status,categories,rating,doc_review) VALUES
          ('en_good','acc_pm','cmp_good','active','["cleaning"]',5,'${VERIFIED}'),
          ('en_fast','acc_pm','cmp_fast','active','["cleaning"]',4,'${VERIFIED}');
        INSERT INTO properties(id,account_id,name,address,city,state,zip) VALUES
          ('prop_1','acc_pm','Press Apartments','1620 Belmont','Seattle','WA','98122');
        INSERT INTO inspections(id,account_id,property_id,unit,kind,status,finished_at)
          VALUES ('ins_out','acc_pm','prop_1','3B','move_out','finished','2026-10-01 12:00:00');
        INSERT INTO inspection_rooms(id,inspection_id,name,status,note,position) VALUES
          ('r1','ins_out','Walls and floors','fail','Scuffed throughout, needs a clean',0);
      `);
      const env = { DB: makeD1(db), FILES: { put: async () => {}, get: async () => null } };
      const [s, b] = await json(await call(env, "/api/inspections/ins_out/job", { trades: ["cleaning"], date: MON }));
      const wo = db.prepare(`SELECT company_id FROM work_orders WHERE job_id = ?`).get(b.jobId);
      return { s, b, wo };
    };
    // Good Crew is rated higher and wins on the same day. Both its crews are
    // off on Tuesday, so the soonest free day is Fast's.
    const r1 = await turn(crewsOff(TUE), "[]");
    ck("the better-rated company whose crews are all off on the soonest day loses it",
      r1.s === 201 && r1.wo?.company_id === "cmp_fast", JSON.stringify({ s: r1.s, wo: r1.wo, auto: r1.b.auto }));
    // And the control: with Tuesday free, the rating decides as it always did.
    const r0 = await turn("[]", "[]");
    ck("with no crew off, the better rating still wins", r0.wo?.company_id === "cmp_good", JSON.stringify(r0.wo));
    const r2 = await turn(paused, paused);
    ck("with every crew paused everywhere, nobody is put on it", r2.s === 201 && r2.b.auto?.skipped === "no_candidate",
      JSON.stringify({ s: r2.s, auto: r2.b.auto }));
    ck("and it says they were paused", (r2.b.auto?.passedOver || []).length === 2
      && r2.b.auto.passedOver.every((x) => x.why === "paused"), JSON.stringify(r2.b.auto?.passedOver));
  }

  console.log("\n-- the screen --");
  {
    const src = readFileSync(join(app, "src", "App.tsx"), "utf8");
    ck("the account's own team has one nav entry for its work",
      /!can\("portal"\) && ownWork && \[\["jobs", "My Jobs"\]\]/.test(src));
    ck("its crews save through its own company, never patchSub",
      /onSetCrews=\{\(crews\) => \(mySub \? patchSub\(mySub\.id, \{ crews \}\) : saveOwnCrews\(crews\)\)\}/.test(src));
    ck("and saveOwnCrews goes to my-company", /const saveOwnCrews[\s\S]{0,400}api\.saveMyCompany\(\{ crews \}\)/.test(src));
  }
} catch (err) {
  fail++;
  console.error("FAIL  the suite threw:", err);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
