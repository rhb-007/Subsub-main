// AUTO-SCHEDULING A MOVE-IN OR MOVE-OUT, end to end through the real Worker.
//
// Asked for as: *"upon approval by them of the move-in, move-out job (these
// jobs only) it will auto schedule and assign the job to the most optimized
// qualified tradesman and the best possible time and then automate back and
// forth with tenant and tradesman until it's booked."*
//
// What is pinned here is the handful of decisions a later pass would undo:
//
//   IT GOES THROUGH THE REAL ASSIGN ROUTE. Assigning carries about a dozen
//   gates and an automatic path with its own copy of them would be a second
//   set of rules to keep in step. The fixture puts a PAUSED company at the
//   front of the ranking to prove the roster gate still bites.
//
//   OFF IS THE DEFAULT AND NULL IS OFF. Every account that exists keeps
//   assigning by hand until somebody ticks it.
//
//   THE RANKING IS EXPLAINABLE AND DETERMINISTIC. Soonest, then rating, then
//   fewer open jobs, then the name -- a tie broken at random is a feature
//   nobody can test and nobody can explain.
//
//   IT DOES NOT BOOK A CREW'S CALENDAR. Auto-schedule is the subcontractor's
//   to grant; this turns on the choosing and the asking.
//
//   AND THE BACK AND FORTH IS BOUNDED. "Until it's booked" cannot mean for
//   ever: two people who keep declining are telling us something a fourth date
//   will not fix.
//
//   node --no-warnings scripts/auto-turnaround-test.mjs

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";
import { AUTO_TRIES, TURNAROUND_KINDS, isTurnaroundKind, rankCandidates,
  slotFor, whyNotAuto, autoPickText } from "../shared/autopick.js";
import { nextToAnswer } from "../shared/visitparty.js";

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");
const SCHEMA = readFileSync(join(app, "worker", "schema.sql"), "utf8");
// Read out of the real CHECK.sql by column name, so the assertion cannot
// drift from the file an operator pastes.
const CHECK = readFileSync(join(app, "worker", "migrations", "CHECK.sql"), "utf8")
  .replace(/;\s*$/, "");
const inv = (db, name) => db.prepare(CHECK).get()[name];

// A 2026 Monday, so the weekday arithmetic is readable in the assertions.
const MON = "2026-10-05";

const seed = ({ auto = 1, docs = true } = {}) => {
  const db = freshDb({ base: SCHEMA, migrations: [] });
  db.exec(`
    INSERT INTO accounts(id,name,kind,subdomain,plan,auto_turnaround) VALUES
      ('acc_pm','Sound Property Management','property_manager','soundpm','scale',${auto});
    INSERT INTO users(id,name,email) VALUES
      ('u_mgr','Chris Lane','chris@soundpm.test'),
      ('u_t3b','Ada Three','ada@t.test');
    INSERT INTO companies(id,company,contact,email,state,insurance,bond,contract,w9) VALUES
      ('cmp_fast','Fast Turnarounds','Fay','fay@fast.test','WA',1,1,1,1),
      ('cmp_good','Good Crew','Gus','gus@good.test','WA',1,1,1,1),
      ('cmp_nodoc','No Papers','Nia','nia@nodoc.test','WA',0,0,0,0),
      ('cmp_paused','AAA Paused Co','Pat','pat@paused.test','WA',1,1,1,1);
    -- Documents verified, which is what the assign route gates on.
    INSERT INTO engagements(id,account_id,company_id,status,categories,rating,doc_review) VALUES
      ('en_fast','acc_pm','cmp_fast','active','["cleaning"]',4,
        '{"insurance":{"status":"verified"},"bond":{"status":"verified"},"contract":{"status":"verified"},"w9":{"status":"verified"}}'),
      ('en_good','acc_pm','cmp_good','active','["cleaning"]',5,
        '{"insurance":{"status":"verified"},"bond":{"status":"verified"},"contract":{"status":"verified"},"w9":{"status":"verified"}}'),
      -- Same trade, same free day, BETTER rating -- and no documents. The only
      -- fixture that can tell "skipped for documents" from "lost the ranking".
      ('en_nodoc','acc_pm','cmp_nodoc','active','["cleaning"]',5,'{}'),
      -- PAUSED, with everything else perfect. If the automatic path had its
      -- own roster rule rather than going through the assign route, this is
      -- the row that would get the work.
      ('en_paused','acc_pm','cmp_paused','paused','["cleaning"]',5,
        '{"insurance":{"status":"verified"},"bond":{"status":"verified"},"contract":{"status":"verified"},"w9":{"status":"verified"}}');
    INSERT INTO properties(id,account_id,name,address,city,state,zip) VALUES
      ('prop_1','acc_pm','Press Apartments','1620 Belmont','Seattle','WA','98122');
    -- THE TENANT SEAT IS INSERTED FIRST, DELIBERATELY. The automation acts as
    -- a TEAM seat, and taking whichever row came back first would speak for
    -- the account as a guest -- scoped to named buildings, somebody else's
    -- client. With the admin inserted first the two rules give the same
    -- answer and the fixture covers for the guard, which is what the first
    -- version of this seed did: mutating the team-seat filter to "take the
    -- first row" changed no outcome.
    -- (No backticks in here. This is a template literal, and one in a comment
    -- closes it -- the fifteenth time this repository has paid for that.)
    INSERT INTO memberships(id,user_id,account_id,role,unit) VALUES
      ('m_t3b','u_t3b','acc_pm','tenant','3B'),
      ('m_mgr','u_mgr','acc_pm','admin',NULL);
    INSERT INTO membership_properties(membership_id,property_id) VALUES ('m_t3b','prop_1');
    INSERT INTO inspections(id,account_id,property_id,unit,kind,status,finished_at)
      VALUES ('ins_out','acc_pm','prop_1','3B','move_out','finished','2026-10-01 12:00:00');
    INSERT INTO inspection_rooms(id,inspection_id,name,status,note,position) VALUES
      ('r1','ins_out','Walls and floors','fail','Scuffed throughout, needs a clean',0);
  `);
  if (!docs) db.prepare(`UPDATE engagements SET doc_review = '{}' WHERE id = 'en_fast'`).run();
  return { db, env: { DB: makeD1(db), FILES: { put: async () => {}, get: async () => null } } };
};

const call = (env, path, body, who = "u_mgr", method = "POST") => worker.fetch(
  new Request(`https://api.subsub.work${path}`, {
    method, body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "Content-Type": "application/json", "X-User-Id": who, "X-Account-Id": "acc_pm" },
  }), env);
const json = async (r) => [r.status, await r.json().catch(() => ({}))];
const raise = (env, extra = {}) => call(env, "/api/inspections/ins_out/job",
  { trades: ["cleaning"], date: MON, ...extra });
const wosOf = (db, jobId) => db.prepare(
  `SELECT * FROM work_orders WHERE job_id = ?`).all(jobId);
const visitsOf = (db, jobId) => db.prepare(
  `SELECT * FROM visits WHERE job_id = ? ORDER BY created_at, rowid`).all(jobId);

try {
  console.log("\n-- the rules, before anything is driven --");
  {
    ck("a move-in and a move-out are turnarounds",
      TURNAROUND_KINDS.join() === "move_in,move_out"
      && isTurnaroundKind("move_in") && isTurnaroundKind("move_out"));
    // "THESE JOBS ONLY", in those words. A repair is somebody's home with
    // somebody in it and the date follows how bad the leak is.
    ck("and an ordinary repair is not", !isTurnaroundKind("repair") && !isTurnaroundKind(null));

    ck("off is the first answer", whyNotAuto({ on: false, kind: "move_out", trades: ["cleaning"] })
      === "not_switched_on");
    ck("and a job that is not a turnaround is refused by name",
      whyNotAuto({ on: true, kind: "repair", trades: ["cleaning"] }) === "not_a_turnaround");
    ck("a job somebody already assigned is left alone",
      whyNotAuto({ on: true, kind: "move_out", trades: ["cleaning"], assigned: 1 })
        === "already_assigned");
    ck("and one with everything is taken",
      whyNotAuto({ on: true, kind: "move_out", trades: ["cleaning"] }) === null);

    // THE SLOT. Working days only, never today, never a day they are out.
    ck("the next slot is the following working day",
      slotFor({ from: MON }) === "2026-10-06", String(slotFor({ from: MON })));
    ck("never today, because somebody has to be told and get there",
      slotFor({ from: MON }) !== MON);
    // Friday + 1 is Saturday: the next working day is Monday.
    ck("a weekend is stepped over",
      slotFor({ from: "2026-10-09" }) === "2026-10-12", String(slotFor({ from: "2026-10-09" })));
    ck("a day they already have one of ours on is skipped",
      slotFor({ from: MON, busy: ["2026-10-06"] }) === "2026-10-07",
      String(slotFor({ from: MON, busy: ["2026-10-06"] })));
    ck("and a day they have marked themselves out",
      slotFor({ from: MON, unavailable: ["2026-10-06", "2026-10-07"] }) === "2026-10-08");
    ck("`skip` walks to the one after", slotFor({ from: MON, skip: 1 }) === "2026-10-07");
    ck("and a company out for ever gets no slot rather than a wrong one",
      slotFor({ from: MON, days: [] }) === null);

    // THE RANKING, and each tier on its own fixture: a check that only drives
    // the first criterion passes whatever the rest do.
    const base = { categories: ["cleaning"], engagedAs: null, blockers: [] };
    const soon = rankCandidates([
      { ...base, companyId: "a", company: "Later", rating: 5, busy: ["2026-10-06"] },
      { ...base, companyId: "b", company: "Sooner", rating: 1 },
    ], { trade: "cleaning", from: MON });
    ck("soonest wins, even over a better rating",
      soon.picked.companyId === "b", soon.picked?.company);
    const rated = rankCandidates([
      { ...base, companyId: "a", company: "Three", rating: 3 },
      { ...base, companyId: "b", company: "Five", rating: 5 },
    ], { trade: "cleaning", from: MON });
    ck("then the better rating on the same day", rated.picked.companyId === "b");
    const busyish = rankCandidates([
      { ...base, companyId: "a", company: "Loaded", rating: 5, openJobs: 9 },
      { ...base, companyId: "b", company: "Free", rating: 5, openJobs: 1 },
    ], { trade: "cleaning", from: MON });
    ck("then fewer open jobs, which spreads the work",
      busyish.picked.companyId === "b", busyish.picked?.company);
    const tied = rankCandidates([
      { ...base, companyId: "a", company: "Zeta", rating: 5 },
      { ...base, companyId: "b", company: "Alpha", rating: 5 },
    ], { trade: "cleaning", from: MON });
    // A TIE BROKEN AT RANDOM is a feature nobody can test and nobody can
    // explain to the person whose turnaround it was.
    ck("and the name last, so the same roster always answers the same",
      tied.picked.company === "Alpha", tied.picked?.company);

    const out = rankCandidates([
      { ...base, companyId: "a", company: "Wrong trade", categories: ["roofing"] },
      { ...base, companyId: "b", company: "No papers", blockers: ["insurance"] },
      { ...base, companyId: "c", company: "Fine" },
    ], { trade: "cleaning", from: MON });
    ck("a company not engaged for the trade is skipped by name",
      out.skipped.find((x) => x.companyId === "a")?.why === "not_this_trade");
    ck("and one with documents outstanding",
      out.skipped.find((x) => x.companyId === "b")?.why === "documents");
    ck("leaving the one that can take it", out.picked.companyId === "c");
    // THE MANAGER HANDED A DECISION OVER. The least it owes them is what it
    // chose and why.
    ck("and it says what it chose and why",
      /Fine for cleaning/.test(autoPickText(out.picked, { trade: "cleaning", skipped: out.skipped }))
      && /soonest free day/.test(autoPickText(out.picked, { trade: "cleaning", skipped: out.skipped })),
      autoPickText(out.picked, { trade: "cleaning", skipped: out.skipped }));
  }

  console.log("\n-- off by default --");
  {
    const { db, env } = seed({ auto: "NULL" });
    const [s, b] = await json(await raise(env));
    ck("the job is raised", s === 201, String(s));
    // NULL AND 0 ARE BOTH OFF, which is what makes this safe against a live
    // database with no backfill.
    ck("and nothing was assigned", wosOf(db, b.jobId).length === 0,
      JSON.stringify(wosOf(db, b.jobId)));
    ck("nor any time put forward", visitsOf(db, b.jobId).length === 0);
    ck("and it says why rather than nothing", b.auto?.skipped === "not_switched_on",
      JSON.stringify(b.auto));
  }

  console.log("\n-- switched on, it picks and books --");
  {
    const { db, env } = seed();
    const [s, b] = await json(await raise(env));
    ck("the job is raised", s === 201, String(s));
    const wos = wosOf(db, b.jobId);
    ck("somebody was put on it", wos.length === 1, JSON.stringify(wos));
    // THE RANKING, THROUGH THE WHOLE STACK. Good Crew is rated 5 and Fast is
    // rated 4, neither is busy, so the better rating wins on the same day.
    ck("and it is the best-rated of the ones who could take it",
      wos[0]?.company_id === "cmp_good", String(wos[0]?.company_id));
    // THE ROSTER GATE STILL BITES, which is the whole reason this goes through
    // the real assign route: Paused Co is rated 5 with perfect documents.
    // IT WOULD WIN ON EVERY OTHER AXIS: top rating, nothing on, and a name
    // that sorts first. The only thing keeping it out is that it is paused.
    ck("never the paused one, however good they look",
      wos[0]?.company_id !== "cmp_paused", String(wos[0]?.company_id));
    // Nor the one with nothing on file, who is rated 5 as well.
    ck("nor the one with documents outstanding",
      wos[0]?.company_id !== "cmp_nodoc", String(wos[0]?.company_id));

    // NO WINDOW YET, AND THIS IS THE PART THAT NEARLY SHIPPED WRONG. A work
    // order sits PENDING until the crew accepts it, and `visitParties` counts
    // a contractor only once they have -- so a window put forward now would
    // settle on the hiring side alone: booked, with the crew never asked,
    // which is the exact state 061 and 064 exist to stop.
    ck("no time goes out before they have taken the job",
      visitsOf(db, b.jobId).length === 0,
      JSON.stringify(visitsOf(db, b.jobId).map((v) => `${v.date}:${v.status}`)));
    // NOT BOOKED OUTRIGHT. Auto-schedule is the crew's to grant and this
    // account has not been given it, so the work order is an OFFER.
    ck("the work order is an offer, not a booking",
      wos[0]?.status === "pending" && !wos[0]?.auto_scheduled,
      `${wos[0]?.status} auto=${wos[0]?.auto_scheduled}`);
    ck("and the reply says a time follows", b.auto?.proposed === false, JSON.stringify(b.auto));

    // TAKING THE JOB IS WHAT STARTS THE CLOCK.
    db.prepare(`INSERT INTO users(id,name,email) VALUES ('u_g','Gus','gus@good.test')`).run();
    db.prepare(`INSERT INTO memberships(id,user_id,account_id,role,company_id)
                VALUES ('m_g','u_g','acc_pm','contractor','cmp_good')`).run();
    const [as] = await json(await call(env, `/api/work-orders/${wos[0].id}/respond`,
      { status: "accepted" }, "u_g"));
    ck("the crew accepts", as === 200, String(as));
    const vs = visitsOf(db, b.jobId);
    ck("and the window goes out by itself", vs.length === 1,
      JSON.stringify(vs.map((v) => v.date)));
    ck("on a working day after the target date", vs[0]?.date === "2026-10-06", String(vs[0]?.date));
    // AND IT IS NOT SETTLED: the crew is a party now, so they are asked.
    ck("waiting on the crew rather than booked for them",
      vs[0]?.status === "proposed", String(vs[0]?.status));
    // 067. AND THE HIRING SIDE HAS ALREADY AGREED, because they switched this
    // on -- the automation proposing on their behalf IS their agreement, which
    // is 064's own rule applied to the side that delegated the choice.
    //
    // This runs inside the CONTRACTOR'S accept, and `asSelf` relayed their
    // headers -- so the propose route read `auth.role === "contractor"` and
    // recorded the window as the crew's own agreement instead. Every
    // auto-scheduled job then stopped dead waiting for a manager to tick a
    // time a machine had chosen for them, which is the opposite of *"this
    // should be fully automated"*.
    ck("the hiring side's leg is stamped", !!vs[0]?.manager_at, String(vs[0]?.manager_at));
    // AND NOT THE CREW'S. They are the party being ASKED here -- stamping
    // theirs would settle the window without anybody having answered, which is
    // the booked-with-the-crew-never-asked failure 065 exists to prevent.
    ck("and the crew's is not", !vs[0]?.contractor_at, String(vs[0]?.contractor_at));
    // THE WHOLE POINT OF THE PAIR: with the hiring side already in, the chain
    // is down to the one party who has to answer.
    ck("so the turn is the crew's", nextToAnswer(
      { respondedAt: vs[0]?.responded_at, contractorAt: vs[0]?.contractor_at,
        managerAt: vs[0]?.manager_at },
      ["contractor", "manager"]) === "contractor",
      `${vs[0]?.contractor_at} / ${vs[0]?.manager_at}`);
    // AND IT IS NOT ATTRIBUTED TO THE CONTRACTOR, which is what `proposed_by`
    // said before -- a window the crew never put forward, on their record.
    // AND BY A TEAM SEAT, not whichever row came back first -- a guest seat
    // speaking for the account is the widening `staffStandsIn` already
    // refuses, from a new direction.
    ck("the window is proposed by the account, not the crew",
      vs[0]?.proposed_by !== "u_g", String(vs[0]?.proposed_by));
    ck("and by a team seat rather than a tenant's",
      vs[0]?.proposed_by === "u_mgr", String(vs[0]?.proposed_by));
    // The invariant that keeps it true, run against a real row rather than an
    // empty database.
    ck("and CHECK.sql counts no unstamped hiring side",
      inv(db, "m067_inv_manager_unstamped") === 0,
      String(inv(db, "m067_inv_manager_unstamped")));
    ck("and the reply says what it did", b.auto?.ok === true && b.auto?.company === "Good Crew",
      JSON.stringify(b.auto));
    const act = db.prepare(`SELECT * FROM activity WHERE kind = 'auto_turnaround'`).get();
    ck("the trail records the choice and the reason",
      !!act && /Good Crew/.test(act.text) && /soonest free day/.test(act.text), String(act?.text));
  }

  console.log("\n-- and a crew that granted it is booked outright --");
  {
    const { db, env } = seed();
    db.prepare(`UPDATE engagements SET auto_schedule = 1 WHERE id = 'en_good'`).run();
    const [, b] = await json(await raise(env));
    const wos = wosOf(db, b.jobId);
    // Their own grant makes the work order accepted on issue, so they ARE a
    // party already and the window goes out in the same breath.
    ck("so the window goes out at once", visitsOf(db, b.jobId).length === 1,
      JSON.stringify(visitsOf(db, b.jobId).map((v) => v.date)));
    // THE ONE THING THE HIRING SIDE CANNOT HAND ITSELF, granted by the crew:
    // then the work really is theirs the moment it is assigned.
    ck("their own grant is what books it",
      wos[0]?.status === "accepted" && !!wos[0]?.auto_scheduled,
      `${wos[0]?.status} auto=${wos[0]?.auto_scheduled}`);
  }

  console.log("\n-- nobody who can take it --");
  {
    const { db, env } = seed();
    db.prepare(`UPDATE engagements SET categories = '["roofing"]'`).run();
    const [s, b] = await json(await raise(env));
    ck("the job is still raised", s === 201, String(s));
    ck("and nothing is assigned", wosOf(db, b.jobId).length === 0);
    // SAID, NOT SILENT. A manager who switched this on and heard nothing would
    // assume it worked.
    ck("it says nobody could take it", b.auto?.skipped === "no_candidate",
      JSON.stringify(b.auto));
    const act = db.prepare(`SELECT * FROM activity WHERE kind = 'auto_turnaround'`).get();
    ck("and the trail says so too", /Nobody on the roster/.test(act?.text || ""), String(act?.text));
  }

  console.log("\n-- the back and forth, which is bounded --");
  {
    const { db, env } = seed();
    const [, b] = await json(await raise(env));
    db.prepare(`INSERT INTO users(id,name,email) VALUES ('u_sub','Gus','gus@good.test')`).run();
    db.prepare(`INSERT INTO memberships(id,user_id,account_id,role,company_id)
                VALUES ('m_sub','u_sub','acc_pm','contractor','cmp_good')`).run();
    await call(env, `/api/work-orders/${wosOf(db, b.jobId)[0].id}/respond`,
      { status: "accepted" }, "u_sub");
    const first = visitsOf(db, b.jobId)[0];
    ck("one window to begin with", !!first, JSON.stringify(first?.date));

    // The crew says no. The next working day goes forward by itself.
    const [ds] = await json(await call(env, `/api/visits/${first.id}/respond`,
      { status: "declined", note: "On another job" }, "u_sub"));
    ck("the decline lands", ds === 200, String(ds));
    const after = visitsOf(db, b.jobId);
    ck("and the next day went forward by itself", after.length === 2,
      JSON.stringify(after.map((v) => `${v.date}:${v.status}`)));
    ck("which is after the one they refused",
      after[1]?.date > first.date, `${after[1]?.date} vs ${first.date}`);

    // AND IT STOPS. "Until it's booked" cannot mean for ever: two people who
    // keep saying no are telling us something a fourth date will not fix.
    for (let i = 0; i < AUTO_TRIES + 2; i += 1) {
      const live = visitsOf(db, b.jobId).filter((v) => v.status === "proposed").pop();
      if (!live) break;
      await call(env, `/api/visits/${live.id}/respond`, { status: "declined" }, "u_sub");
    }
    const all = visitsOf(db, b.jobId);
    ck("it gives up rather than proposing for ever", all.length <= AUTO_TRIES,
      `${all.length} windows, budget ${AUTO_TRIES}`);
    const gave = db.prepare(
      `SELECT * FROM activity WHERE kind = 'auto_turnaround' AND text LIKE '%by hand%'`).get();
    ck("and tells the manager to pick one by hand", !!gave, String(gave?.text));
  }

  console.log("\n-- and a database without 065 is told which migration --");
  {
    // THE SWITCH IS THE ONLY WAY INTO ANY OF THE ABOVE, and on a database
    // behind the code it threw: the route answered 500 and the panel said
    // *"That didn't save. Try again"*, which is false -- the column is not
    // coming back on the next press, and the one person who could fix it was
    // the one person told nothing. A control that refuses for ever with no
    // reason beside it is indistinguishable from a broken one.
    //
    // Only a database actually missing the column can see this, so the table
    // is rebuilt without it rather than the error being faked.
    const { db, env } = seed();
    // Drop the one column 065 adds and nothing else: a rebuild that kept only
    // the columns this block cares about would take the session lookup's with
    // it, and the route would answer 403 long before it reached the write.
    db.exec(`ALTER TABLE accounts DROP COLUMN auto_turnaround`);
    const [s, b] = await json(await call(env, "/api/account",
      { autoTurnaround: true }, "u_mgr", "PATCH"));
    ck("switching it on is refused rather than crashing", s === 503, String(s));
    ck("and the refusal names the migration to run",
      b.error === "migration_needed" && b.migration === "065_auto_turnaround",
      JSON.stringify(b));
  }
} catch (err) {
  fail += 1;
  console.log("FAIL  threw:", err?.stack || err);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
