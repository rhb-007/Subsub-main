// HOW LONG EACH TRADE TAKES -- migration 079, shared/span.js, and the routes
// that read and write it, end to end through the real Worker.
//
// Asked for as "a start/end date estimate so that the calendar can be more of
// a Gantt chart with beginning and ending estimates for each job", and chosen
// as per-trade spans that roll up to the job rather than one span per job.
//
// What is pinned:
//
//   THE FINISH IS COMPUTED, IN WORKING DAYS. Weekends skipped unless the crew
//   works them, and so are the days the crew holding the trade marked off --
//   a holiday mid-job pushes the end, it does not shorten the work.
//
//   ONLY THE TRADES NAMED ARE TOUCHED, and a trade the job does not have is
//   refused -- an estimate for work nobody is doing is the invariant 079 counts.
//
//   A CONTRACTOR READS THEIR OWN TRADE'S ESTIMATE ONLY. When the electrician
//   is booked and for how long is the account's business, not the plumber's.
//
//   THE CREW SUGGESTS; THE HIRING SIDE DECIDES. With no estimate yet the
//   crew's becomes it; with one, theirs is a suggestion until accepted.
//
//   THE AUTO-SCHEDULER TREATS EVERY DAY OF A SPAN AS BUSY, and places a new
//   trade only where all of its days are free.
//
//   node --no-warnings scripts/job-span-test.mjs

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";
import { runCheck } from "./lib/check-sql.mjs";
import { spanDates, spanEnd, spanView, spanDaysFrom, jobSpan, validSpan, busyFromSpans, spanText }
  from "../shared/span.js";
import { slotFor } from "../shared/autopick.js";

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");
const SCHEMA = readFileSync(join(app, "worker", "schema.sql"), "utf8");
const MIG = readFileSync(join(app, "worker", "migrations", "079_job_spans.sql"), "utf8");

// Fixed dates, far enough ahead that "today" never reaches them. Thursday
// 2027-11-04 is the start used throughout: a span from a Thursday is the
// shortest one that has to cross a weekend.
const THU = "2027-11-04";
const MON = "2027-11-08";
const dow = (k) => new Date(`${k}T12:00:00Z`).getUTCDay();

console.log("\n-- the arithmetic --");
{
  ck("the fixture's Thursday is a Thursday", dow(THU) === 4 && dow(MON) === 1, `${dow(THU)} ${dow(MON)}`);
  const five = spanDates({ start: THU, days: 5 });
  ck("five working days from a Thursday skip the weekend", five.join(",") ===
    "2027-11-04,2027-11-05,2027-11-08,2027-11-09,2027-11-10", five.join(","));
  ck("so a five-day job from Thursday ends the next Wednesday", spanEnd({ start: THU, days: 5 }) === "2027-11-10");
  ck("a crew that works weekends ends on the Monday", spanEnd({ start: THU, days: 5, weekends: true }) === MON);
  ck("a day off in the middle pushes the end, it does not shorten the work",
    spanEnd({ start: THU, days: 5, off: [MON] }) === "2027-11-11", String(spanEnd({ start: THU, days: 5, off: [MON] })));
  const sat = spanView({ start: "2027-11-06", days: 1 });
  ck("a start typed on a Saturday begins work on the Monday", sat.first === MON && sat.end === MON, JSON.stringify(sat));
  ck("a whole number of days only", spanDaysFrom("3") === 3 && spanDaysFrom(2.5) === null
    && spanDaysFrom(0) === null && spanDaysFrom(366) === null && spanDaysFrom("") === null);
  ck("a bad start is refused by name", validSpan({ start: "2027-02-30", days: 2 }).error === "bad_span_start");
  ck("and bad days too", validSpan({ start: THU, days: 0 }).error === "bad_span_days");
  const roll = jobSpan({ plumbing: spanView({ start: THU, days: 2 }), painting: spanView({ start: MON, days: 3 }) });
  ck("the job's span runs from the earliest start to the latest finish",
    roll.start === THU && roll.end === "2027-11-10" && roll.calendarDays === 7, JSON.stringify(roll));
  ck("and nobody having said how long is not a one-day job", jobSpan({}) === null);
  ck("busy days are every working day of every span held",
    busyFromSpans([{ start_date: THU, work_days: 3 }]).join(",") === "2027-11-04,2027-11-05,2027-11-08");
  ck("the words carry the length and the range",
    spanText(spanView({ start: THU, days: 5 })) === "2027-11-04 – 2027-11-10 · 5 working days",
    spanText(spanView({ start: THU, days: 5 })));
  // A five-day slot that would run into a day already booked is not a slot.
  // From the Monday the first candidate is Tuesday; a three-day span from
  // Tuesday or Wednesday reaches the busy Thursday, so the first start whose
  // every day is free is the Friday -- running Fri, Mon, Tue.
  const slot = slotFor({ from: "2027-11-01", busy: ["2027-11-04"], length: 3 });
  ck("the auto-scheduler needs every day of the span free", slot === "2027-11-05", String(slot));
  ck("and a one-day job still takes the first free day", slotFor({ from: "2027-11-01", busy: ["2027-11-04"] }) === "2027-11-02");
}

// ---------------------------------------------------------------------------

const VERIFIED = `{"insurance":{"status":"verified"},"bond":{"status":"verified"},"contract":{"status":"verified"},"w9":{"status":"verified"}}`;
// One crew, off on the Monday -- so the company is off that day.
const PAC_CREWS = JSON.stringify([{ id: "c1", name: "Crew A", available: true,
  unavailableDays: [MON], members: [{ name: "Juan", role: "Lead" }] }]);

const seed = ({ migrate = true } = {}) => {
  const db = freshDb({ base: SCHEMA, migrations: [] });
  if (!migrate) db.exec(`DROP TABLE IF EXISTS job_trade_spans`);
  else db.exec(MIG); // a no-op over schema.sql, which is the point of running it
  db.exec(`
    INSERT INTO accounts(id,name,kind,subdomain,plan) VALUES
      ('acc_pm','Sound Property Management','property_manager','soundpm','scale');
    INSERT INTO users(id,name,email) VALUES
      ('u_mgr','Chris Lane','chris@soundpm.test'),
      ('u_pac','Juan Soto','juan@pac.test'),
      ('u_bay','Ann Bay','ann@bay.test');
    INSERT INTO companies(id,company,contact,email,state,insurance,bond,contract,w9,crews) VALUES
      ('cmp_pac','Pacific apartment maintenance','Juan','juan@pac.test','WA',1,1,1,1,'${PAC_CREWS}'),
      ('cmp_bay','Bay Painting','Ann','ann@bay.test','WA',1,1,1,1,'[]');
    INSERT INTO memberships(id,user_id,account_id,role,company_id) VALUES
      ('m_mgr','u_mgr','acc_pm','admin',NULL),
      ('m_pac','u_pac','acc_pm','contractor','cmp_pac'),
      ('m_bay','u_bay','acc_pm','contractor','cmp_bay');
    INSERT INTO engagements(id,account_id,company_id,status,categories,doc_review,auto_schedule) VALUES
      ('en_pac','acc_pm','cmp_pac','active','["plumbing"]','${VERIFIED}',1),
      ('en_bay','acc_pm','cmp_bay','active','["painting","gutters"]','${VERIFIED}',0);
    INSERT INTO jobs(id,account_id,title,trades,date,status) VALUES
      ('j1','acc_pm','Bathroom refit','["plumbing","painting"]','${THU}','active'),
      ('j2','acc_pm','Gutters and roof','["roofing","gutters"]','${THU}','active'),
      ('j3','acc_pm','Kitchen sink','["plumbing"]','2027-11-05','active');
    INSERT INTO work_orders(id,job_id,company_id,engagement_id,trade,wo_number,status,issued_at) VALUES
      ('wo_p','j1','cmp_pac','en_pac','plumbing','WO-1','accepted','2027-10-01'),
      ('wo_b','j1','cmp_bay','en_bay','painting','WO-2','accepted','2027-10-01');
  `);
  return { db, env: { DB: makeD1(db), FILES: { put: async () => {}, get: async () => null } } };
};

const call = (env, path, { method = "GET", body, who = "u_mgr" } = {}) => worker.fetch(
  new Request(`https://api.subsub.work${path}`, {
    method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    headers: { "Content-Type": "application/json", "X-User-Id": who, "X-Account-Id": "acc_pm" },
  }), env);
const json = async (r) => [r.status, await r.json().catch(() => ({}))];
const rowsOf = (db, job) => db.prepare(`SELECT * FROM job_trade_spans WHERE job_id = ? ORDER BY trade`).all(job);

try {
  console.log("\n-- the hiring side sets an estimate --");
  {
    const { db, env } = seed();
    const [st, b] = await json(await call(env, "/api/jobs/j1/spans",
      { method: "PUT", body: { spans: { plumbing: { start: THU, days: 5 } } } }));
    ck("it saves", st === 200 && b.ok, JSON.stringify({ st, b }));
    ck("and the finish skips the day the crew holding it marked off",
      b.spans?.plumbing?.end === "2027-11-11", JSON.stringify(b.spans?.plumbing));
    ck("only the trade named was written", rowsOf(db, "j1").length === 1);

    const [s2, b2] = await json(await call(env, "/api/jobs/j1/spans",
      { method: "PUT", body: { spans: { roofing: { start: THU, days: 2 } } } }));
    ck("a trade the job does not have is refused by name", s2 === 400 && b2.error === "span_trade_not_on_job"
      && b2.trade === "roofing", JSON.stringify({ s2, b2 }));
    const [s3, b3] = await json(await call(env, "/api/jobs/j1/spans",
      { method: "PUT", body: { spans: { painting: { start: THU, days: 2 }, plumbing: { start: THU, days: 0 } } } }));
    ck("a bad figure refuses the whole save", s3 === 400 && b3.error === "bad_span_days" && b3.trade === "plumbing",
      JSON.stringify({ s3, b3 }));
    ck("and writes none of it, the good half included", rowsOf(db, "j1").length === 1
      && rowsOf(db, "j1")[0].work_days === 5, JSON.stringify(rowsOf(db, "j1")));
    const [s4] = await json(await call(env, "/api/jobs/j1/spans",
      { method: "PUT", body: { spans: { painting: { start: MON, days: 2 } } }, who: "u_bay" }));
    ck("a contractor cannot set the account's estimate", s4 === 403 || s4 === 404, String(s4));

    console.log("\n-- the job list carries them --");
    const [, jobs] = await json(await call(env, "/api/jobs"));
    const j1 = (jobs || []).find((x) => x.id === "j1");
    ck("the job carries its estimates", j1?.spans?.plumbing?.days === 5 && j1.spans.plumbing.end === "2027-11-11",
      JSON.stringify(j1?.spans));
    ck("and a trade with none has no key, rather than a made-up one-day span", !("painting" in (j1?.spans || {})));
    await call(env, "/api/jobs/j1/spans", { method: "PUT", body: { spans: { painting: { start: MON, days: 2 } } } });
    const [, asBay] = await json(await call(env, "/api/jobs", { who: "u_bay" }));
    const bj = (asBay || []).find((x) => x.id === "j1");
    ck("a contractor reads their own trade's estimate", bj?.spans?.painting?.days === 2, JSON.stringify(bj?.spans));
    ck("and not the other trades' on the same job", bj && !("plumbing" in (bj.spans || {})), JSON.stringify(bj?.spans));
    const [, mw] = await json(await call(env, "/api/my-work", { who: "u_pac" }));
    const mine = (mw?.work || []).find((w) => w.jobId === "j1");
    ck("the crew's own work list carries their span", mine?.span?.days === 5 && mine.span.end === "2027-11-11",
      JSON.stringify(mine?.span));
  }

  console.log("\n-- the crew says how long it really takes --");
  {
    const { db, env } = seed();
    const [s1, b1] = await json(await call(env, "/api/jobs/j1/spans/painting/propose",
      { method: "POST", body: { start: MON, days: 3 }, who: "u_bay" }));
    ck("with no estimate yet, theirs becomes it", s1 === 200 && b1.proposed === false
      && rowsOf(db, "j1").find((r) => r.trade === "painting")?.work_days === 3, JSON.stringify({ s1, b1 }));
    await call(env, "/api/jobs/j1/spans", { method: "PUT", body: { spans: { plumbing: { start: THU, days: 2 } } } });
    const [s2, b2] = await json(await call(env, "/api/jobs/j1/spans/plumbing/propose",
      { method: "POST", body: { start: THU, days: 4, note: "subfloor first" }, who: "u_pac" }));
    const row = rowsOf(db, "j1").find((r) => r.trade === "plumbing");
    ck("with one, theirs is a suggestion", s2 === 200 && b2.proposed === true && row.proposed_days === 4,
      JSON.stringify({ s2, b2, row }));
    ck("and the office's figures stand until it answers", row.work_days === 2);
    ck("the suggestion carries its own finish", b2.span?.proposal?.days === 4 && !!b2.span.proposal.end,
      JSON.stringify(b2.span?.proposal));
    const [s3] = await json(await call(env, "/api/jobs/j1/spans/plumbing/propose",
      { method: "POST", body: { start: THU, days: 4 }, who: "u_bay" }));
    ck("a company not holding that trade gets not found", s3 === 404, String(s3));

    const [s4, b4] = await json(await call(env, "/api/jobs/j1/spans/plumbing/answer",
      { method: "POST", body: { accept: true } }));
    const after = rowsOf(db, "j1").find((r) => r.trade === "plumbing");
    ck("using theirs takes their figures", s4 === 200 && after.work_days === 4 && after.proposed_days === null,
      JSON.stringify({ s4, after }));
    ck("and the reply carries the new finish", b4.spans?.plumbing?.days === 4);
    const [s5, b5] = await json(await call(env, "/api/jobs/j1/spans/plumbing/answer",
      { method: "POST", body: { accept: true } }));
    ck("an answered suggestion cannot be answered twice", s5 === 409 && b5.error === "nothing_proposed",
      JSON.stringify({ s5, b5 }));

    await call(env, "/api/jobs/j1/spans/plumbing/propose",
      { method: "POST", body: { start: MON, days: 9 }, who: "u_pac" });
    await call(env, "/api/jobs/j1/spans/plumbing/answer", { method: "POST", body: { accept: false } });
    const kept = rowsOf(db, "j1").find((r) => r.trade === "plumbing");
    ck("keeping ours keeps ours and clears theirs", kept.work_days === 4 && kept.start_date === THU
      && kept.proposed_days === null, JSON.stringify(kept));
    // Setting new figures answers an open suggestion too.
    await call(env, "/api/jobs/j1/spans/plumbing/propose",
      { method: "POST", body: { start: MON, days: 9 }, who: "u_pac" });
    await call(env, "/api/jobs/j1/spans", { method: "PUT", body: { spans: { plumbing: { start: THU, days: 6 } } } });
    ck("and new figures from the office clear a suggestion",
      rowsOf(db, "j1").find((r) => r.trade === "plumbing").proposed_days === null);
  }

  console.log("\n-- editing and creating a job --");
  {
    const { db, env } = seed();
    await call(env, "/api/jobs/j2/spans", { method: "PUT",
      body: { spans: { roofing: { start: THU, days: 2 }, gutters: { start: MON, days: 1 } } } });
    const [s1, b1] = await json(await call(env, "/api/jobs/j2", { method: "PATCH",
      body: { title: "Renamed", spans: { roofing: { start: THU, days: -1 } } } }));
    ck("a bad estimate on an edit is refused", s1 === 400 && b1.error === "bad_span_days", JSON.stringify({ s1, b1 }));
    ck("before anything is written", db.prepare(`SELECT title FROM jobs WHERE id='j2'`).get().title === "Gutters and roof");
    const [s2, b2] = await json(await call(env, "/api/jobs/j2", { method: "PATCH", body: { trades: ["roofing"] } }));
    ck("taking a trade off the job takes its estimate with it", s2 === 200
      && rowsOf(db, "j2").map((r) => r.trade).join() === "roofing", JSON.stringify(rowsOf(db, "j2")));
    ck("and the reply carries what is left", !!b2.spans?.roofing && !("gutters" in (b2.spans || {})),
      JSON.stringify(b2.spans));
    ck("so the invariant reads zero", runCheck(db).m079_inv_span_off_job === 0);
    const [s3, b3] = await json(await call(env, "/api/jobs/j2", { method: "PATCH",
      body: { spans: { roofing: null } } }));
    ck("a null removes an estimate", s3 === 200 && rowsOf(db, "j2").length === 0, JSON.stringify(b3));

    const [s4, b4] = await json(await call(env, "/api/jobs", { method: "POST", body: {
      title: "New deck", address: "1 Main St", trades: ["deck_fence", "painting"], date: THU,
      spans: { deck_fence: { start: THU, days: 3 }, painting: { start: "2027-11-09", days: 2 } } } }));
    ck("a new job saves its estimates", s4 === 201 && rowsOf(db, b4.id).length === 2, JSON.stringify({ s4, e: b4.error }));
    ck("and hands them back with the job", b4.job?.spans?.deck_fence?.end === "2027-11-08", JSON.stringify(b4.job?.spans));
    const before = db.prepare(`SELECT COUNT(*) AS n FROM jobs`).get().n;
    const [s5, b5] = await json(await call(env, "/api/jobs", { method: "POST", body: {
      title: "Bad", address: "1 Main St", trades: ["painting"], spans: { roofing: { start: THU, days: 1 } } } }));
    ck("an estimate for a trade not on the new job refuses the create", s5 === 400 && b5.error === "span_trade_not_on_job");
    ck("and creates nothing", db.prepare(`SELECT COUNT(*) AS n FROM jobs`).get().n === before);
  }

  console.log("\n-- the auto-scheduler reads every day of a span --");
  {
    const { db, env } = seed();
    // Pacific is on j1's plumbing from Thursday for five working days, and
    // marked off on the Monday: on site Thu, Fri, Tue, Wed, Thu.
    await call(env, "/api/jobs/j1/spans", { method: "PUT", body: { spans: { plumbing: { start: THU, days: 5 } } } });
    // j3 wants two days of plumbing from the Friday -- a day they are already
    // on j1. They have granted auto-schedule, so issuing books a window.
    await call(env, "/api/jobs/j3/spans", { method: "PUT", body: { spans: { plumbing: { start: "2027-11-05", days: 2 } } } });
    const [st, b] = await json(await call(env, "/api/jobs/j3/assign", { method: "POST",
      body: { trade: "plumbing", companyId: "cmp_pac", payKind: "fixed", value: "300", responseWindow: "24h" } }));
    const v = db.prepare(`SELECT date FROM visits WHERE job_id='j3' AND status IN ('proposed','confirmed')`).all();
    const busy = ["2027-11-04", "2027-11-05", "2027-11-09", "2027-11-10", "2027-11-11"];
    ck("issuing goes out", st === 201, JSON.stringify({ st, e: b.error }));
    ck("and the window is put forward", v.length === 1, JSON.stringify(v));
    ck("not on a day they are already on site for another job", v[0] && !busy.includes(v[0].date), String(v[0]?.date));
    ck("nor on the day they are off", v[0]?.date !== MON, String(v[0]?.date));
    ck("but on the first day both of its days are free", v[0]?.date === "2027-11-12", String(v[0]?.date));
  }

  console.log("\n-- what CHECK.sql says --");
  {
    const { db } = seed();
    ck("079 reads as run", runCheck(db).m079_job_trade_spans >= 1);
    db.exec(`INSERT INTO job_trade_spans(job_id,trade,start_date,work_days) VALUES ('j1','roofing','${THU}',2)`);
    ck("an estimate for a trade the job does not have is counted", runCheck(db).m079_inv_span_off_job === 1);
    db.exec(`DELETE FROM job_trade_spans WHERE trade='roofing'`);
    db.exec(`INSERT INTO job_trade_spans(job_id,trade,start_date,work_days) VALUES ('j1','plumbing','${THU}',2)`);
    ck("and one for a trade it does have is not", runCheck(db).m079_inv_span_off_job === 0);
  }

  console.log("\n-- a database without 079 --");
  {
    const { env } = seed({ migrate: false });
    const [st, b] = await json(await call(env, "/api/jobs/j1/spans",
      { method: "PUT", body: { spans: { plumbing: { start: THU, days: 2 } } } }));
    ck("saving an estimate names the file", st === 503 && b.migration === "079_job_spans", JSON.stringify({ st, b }));
    const [s2, jobs] = await json(await call(env, "/api/jobs"));
    ck("and the job list still loads, with no estimates", s2 === 200
      && JSON.stringify((jobs || []).find((x) => x.id === "j1")?.spans) === "{}", String(s2));
    const [s3, b3] = await json(await call(env, "/api/jobs/j2", { method: "PATCH",
      body: { title: "Still saves", spans: { roofing: { start: THU, days: 1 } } } }));
    ck("an edit carrying one still saves the job, and says what it could not", s3 === 200
      && b3.spansSaved?.migration === "079_job_spans", JSON.stringify(b3));
  }
} catch (e) {
  fail++;
  console.log("FAIL  the suite threw  -- " + (e?.stack || e));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
