// THE TENANT DOES NOT ALWAYS HAVE TO BE IN, AND NOBODY COULD SAY SO.
//
// Asked for as: *"a tenant does not always need to be available and in the
// unit [for a] job. Sometimes you need to be there. Allow the property manager
// to adjust that when scheduling the job, because that's one process that does
// not need to happen."*
//
// THE RULE EXISTED AND HAD NO OVERRIDE. `POST /api/jobs/:id/visits` has read
// `seat?.role === "tenant"` since 019: a repair a TENANT reported waits on
// that tenant to confirm the window; anything else is confirmed the moment it
// is proposed. Good default -- derived entirely from who happened to raise the
// job, and nothing anywhere could change it. So a tenant reporting a leaking
// roof, which is fixed from outside, sat waiting on them to agree a morning
// they did not need to be home for, and the repair did not move until they
// did. The reverse too: a manager raising work inside an occupied flat got no
// confirmation step at all.
//
// Migration 060, `jobs.access`, `app/shared/access.js`. What this pins:
//
//   NULL CHANGES NOTHING. `accessFor` falls back to exactly the 019 rule, so
//   every job that already exists behaves as it always did -- which is what
//   makes this safe against a live database, and is only checkable on a
//   fixture with jobs on both sides of it.
//
//   THE OVERRIDE WORKS IN BOTH DIRECTIONS. Taking the tenant out of a repair
//   they reported, and putting them into one they did not.
//
//   A JOB NOBODY REPORTED HAS NOBODY TO ASK, whatever the column says --
//   otherwise a visit sits proposed for ever with no one able to answer it.
//
//   AND A TENANT DOES NOT GET TO ANSWER IT. They are the side being let in;
//   taking the word from their request would let them book themselves out of
//   their own confirmation step.
//
//   node --no-warnings scripts/job-access-test.mjs

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";
import { accessFor, needsTenantConfirm, ACCESS_KINDS, ACCESS_ACCOUNT_KINDS,
  mayChooseAccess, isAccess, accessChoices, canAskTenant } from "../shared/access.js";

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
      ('u_own','Dana Owner','dana@owner.test');
    INSERT INTO properties(id,account_id,name,address,city,state,zip) VALUES
      ('prop_1','acc_pm','Press Apartments','1620 Belmont','Seattle','WA','98122');
    INSERT INTO memberships(id,user_id,account_id,role) VALUES
      ('m_mgr','u_mgr','acc_pm','admin'),
      ('m_ten','u_ten','acc_pm','tenant'),
      ('m_own','u_own','acc_pm','owner');
    INSERT INTO membership_properties(membership_id,property_id) VALUES
      ('m_ten','prop_1'), ('m_own','prop_1');

    -- A TENANT'S OWN REPORT. 019's rule says this waits on them.
    INSERT INTO jobs(id,account_id,property_id,title,trades,status,requested_by,approved_at,created_at)
      VALUES ('job_ten','acc_pm','prop_1','Leaking sink','["plumbing"]','active','u_ten','2026-10-01','2026-10-01');
    -- THE SAME, but fixed from outside: the manager says the tenant need not
    -- be in. The only row either behaviour can be told apart on.
    INSERT INTO jobs(id,account_id,property_id,title,trades,status,requested_by,approved_at,access,created_at)
      VALUES ('job_roof','acc_pm','prop_1','Leaking roof','["roofing"]','active','u_ten','2026-10-01','none','2026-10-01');
    -- Raised by the manager inside an occupied flat: nobody reported it, so
    -- 019 books it outright -- and the manager wants the tenant asked.
    INSERT INTO jobs(id,account_id,property_id,title,trades,status,access,created_at)
      VALUES ('job_flat','acc_pm','prop_1','Rewire unit 12','["electrical"]','active','tenant','2026-10-01');
    -- Raised by the manager, nothing said.
    INSERT INTO jobs(id,account_id,property_id,title,trades,status,created_at)
      VALUES ('job_plain','acc_pm','prop_1','Repaint hallway','["painting"]','active','2026-10-01');
    -- An OWNER's request. An owner is not somebody who has to be in.
    INSERT INTO jobs(id,account_id,property_id,title,trades,status,requested_by,approved_at,created_at)
      VALUES ('job_own','acc_pm','prop_1','Boiler service','["hvac"]','active','u_own','2026-10-01','2026-10-01');
  `);
  return { db, env: { DB: makeD1(db) } };
};

const post = (env, path, body, who = "u_mgr") => worker.fetch(
  new Request(`https://api.subsub.work${path}`, {
    method: "POST", body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", "X-User-Id": who, "X-Account-Id": "acc_pm" },
  }), env);
const patch = (env, path, body, who = "u_mgr") => worker.fetch(
  new Request(`https://api.subsub.work${path}`, {
    method: "PATCH", body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", "X-User-Id": who, "X-Account-Id": "acc_pm" },
  }), env);
const json = async (r) => [r.status, await r.json().catch(() => ({}))];
const visitOf = (db, jobId) => db.prepare(
  `SELECT * FROM visits WHERE job_id = ? AND status != 'superseded' ORDER BY created_at DESC`).get(jobId);
const jobOf = (db, id) => db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(id);
const propose = (env, jobId) => post(env, `/api/jobs/${jobId}/visits`,
  { date: "2026-10-09", startTime: "09:00", endTime: "11:00" });

try {
  console.log("\n-- nothing answered keeps the rule that was already running --");
  {
    const { db, env } = seed();
    const [s] = await json(await propose(env, "job_ten"));
    ck("a tenant's own report is proposed", s === 201, String(s));
    // 019's behaviour, untouched. This is what makes the migration safe.
    ck("and waits on them to confirm", visitOf(db, "job_ten").status === "proposed",
      visitOf(db, "job_ten").status);
    ck("so the job gets no date yet", jobOf(db, "job_ten").date === null,
      String(jobOf(db, "job_ten").date));
  }
  {
    const { db, env } = seed();
    await propose(env, "job_plain");
    // The other half of 019's rule, equally untouched.
    ck("a job nobody reported is booked outright",
      visitOf(db, "job_plain").status === "confirmed", visitOf(db, "job_plain").status);
    ck("and the date lands on the job", jobOf(db, "job_plain").date === "2026-10-09",
      String(jobOf(db, "job_plain").date));
  }
  {
    const { db, env } = seed();
    await propose(env, "job_own");
    // AN OWNER IS NOT A TENANT. `requested_by` alone cannot answer this, which
    // is why the rule reads the seat role and not the column.
    ck("an owner's request does not wait on the owner",
      visitOf(db, "job_own").status === "confirmed", visitOf(db, "job_own").status);
  }

  console.log("\n-- and the override works in both directions --");
  {
    const { db, env } = seed();
    await propose(env, "job_roof");
    // THE WHOLE REQUEST. A tenant reported it; it is fixed from outside; they
    // do not have to be home, so the repair does not wait on them.
    ck("a tenant's report marked no-access is booked outright",
      visitOf(db, "job_roof").status === "confirmed", visitOf(db, "job_roof").status);
    ck("with the date on the job", jobOf(db, "job_roof").date === "2026-10-09",
      String(jobOf(db, "job_roof").date));
  }
  {
    // THE REVERSE DIRECTION, and asserting only the first passes with the
    // override read as "skip the tenant, always". A repair the tenant DID
    // report, left at the default, still waits on them -- so the override is
    // the thing doing the work above and not a blanket change.
    const { db, env } = seed();
    await propose(env, "job_ten");
    ck("a tenant's report left alone still waits on them",
      visitOf(db, "job_ten").status === "proposed", visitOf(db, "job_ten").status);
  }
  {
    // AND A JOB NOBODY REPORTED HAS NOBODY TO ASK, whatever the column says.
    // job_flat is marked "tenant" and has no requester, so a visit must not
    // sit proposed for ever with no one able to answer it -- the
    // waiting-on-somebody-who-cannot-reply failure. The override decides
    // whether to ask; whether there IS anybody to ask is still a fact.
    const { db, env } = seed();
    await propose(env, "job_flat");
    ck("so it is booked rather than left waiting on nobody",
      visitOf(db, "job_flat").status === "confirmed", visitOf(db, "job_flat").status);
    // AND THE SCREEN DOES NOT OFFER IT THERE. A control the server quietly
    // ignores is the screen-that-lies rule pointed at a radio button, so the
    // picker drops that answer when there is nobody behind it.
    ck("and the screen would not have offered that answer",
      !accessChoices({ id: "job_flat" }).some((k) => k.id === "tenant")
      && accessChoices({ requestedBy: "u_ten" }).some((k) => k.id === "tenant"));
  }

  console.log("\n-- setting it --");
  {
    const { db, env } = seed();
    const [s] = await json(await patch(env, "/api/jobs/job_ten", { access: "none" }));
    ck("a manager may change it after the job exists", s === 200, String(s));
    ck("and it is written", jobOf(db, "job_ten").access === "none", String(jobOf(db, "job_ten").access));
    await propose(env, "job_ten");
    ck("which changes what proposing a time does",
      visitOf(db, "job_ten").status === "confirmed", visitOf(db, "job_ten").status);
  }
  {
    const { env } = seed();
    const [s, b] = await json(await patch(env, "/api/jobs/job_ten", { access: "sometimes" }));
    ck("an unrecognised word is refused rather than stored",
      s === 400 && b.error === "bad_access", `${s} ${JSON.stringify(b)}`);
  }
  {
    const { db, env } = seed();
    const [s] = await json(await post(env, "/api/jobs",
      { title: "Gutter clean", trades: ["gutters"], propertyId: "prop_1", access: "none" }));
    ck("and it can be answered when the job is created", s === 201, String(s));
    const made = db.prepare(`SELECT * FROM jobs WHERE title = 'Gutter clean'`).get();
    ck("stored on the new job", made?.access === "none", String(made?.access));
  }
  {
    // A TENANT DOES NOT GET TO ANSWER IT. They are the side being let in, and
    // taking the word from their request would let them book themselves out
    // of their own confirmation step.
    const { db, env } = seed();
    const [s] = await json(await post(env, "/api/jobs",
      { title: "Tap washer", trades: ["plumbing"], propertyId: "prop_1", access: "none",
        reportDetail: { problem: "plumbing" } }, "u_ten"));
    const made = db.prepare(`SELECT * FROM jobs WHERE title = 'Tap washer'`).get();
    ck("a tenant's own report cannot carry it", s === 201 && made?.access === null,
      `${s} ${String(made?.access)}`);
  }

  console.log("\n-- the rule module --");
  {
    ck("an explicit answer always wins over the fallback",
      accessFor({ access: "none" }, { tenantReported: true }) === "none"
      && accessFor({ access: "tenant" }, { tenantReported: false }) === "tenant");
    ck("and NULL is the 019 rule",
      accessFor({ access: null }, { tenantReported: true }) === "tenant"
      && accessFor({}, { tenantReported: false }) === "none");
    // A word nothing recognises must not quietly become an answer.
    ck("an unrecognised word falls back rather than passing through",
      accessFor({ access: "maybe" }, { tenantReported: true }) === "tenant"
      && !isAccess("maybe"));
    ck("only the tenant answer costs a round trip",
      needsTenantConfirm("tenant") && !needsTenantConfirm("manager") && !needsTenantConfirm("none"));
    // Every kind has words for both audiences: what a manager decides and what
    // somebody arriving needs to know are different sentences.
    ck("every kind has words for the manager and for the contractor",
      // 068. `note` IS A FUNCTION NOW, because the word for whoever holds the
      // work follows the engagement -- a handyman is not "the contractor".
      // Called rather than merely truthy: a function that returns an empty
      // string is as useless as a missing one, and `k.note &&` would pass
      // over it.
      Object.values(ACCESS_KINDS).every((k) =>
        k.label && k.short && k.forContractor
        && typeof k.note === "function" && !!k.note() && !!k.note("handyman")));
    // AND THE WORD REACHES THE SENTENCE, on every kind. All three notes name
    // whoever holds the work, so there is no kind this can be skipped on --
    // and asserting it on one would be the diagonal coverage this project
    // keeps paying for.
    ck("every note says handyman when it is passed one",
      Object.values(ACCESS_KINDS).every((k) =>
        /\bhandyman\b/i.test(k.note("handyman")) && !/the contractor/i.test(k.note("handyman"))),
      Object.values(ACCESS_KINDS).map((k) => k.note("handyman")).join(" | "));
    // AND THE DEFAULT IS THE OLD SENTENCE, which is what the two call sites
    // with no job behind them get. Both branches in the same place.
    ck("and keeps the contractor when it is not",
      Object.values(ACCESS_KINDS).every((k) =>
        /the contractor/i.test(k.note()) && !/handyman/i.test(k.note())),
      Object.values(ACCESS_KINDS).map((k) => k.note()).join(" | "));
    // The same three-way split `HANDYMAN_ACCOUNT_KINDS` carries, for the same
    // reason: a list that cannot be imported is pinned equal instead.
    const worker = readFileSync(join(app, "worker", "index.js"), "utf8");
    const inWorker = worker.match(/const ACCOUNT_KINDS_WITH_PROPERTIES = \[([^\]]*)\]/)?.[1] || "";
    const kinds = [...inWorker.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]).sort();
    ck("and the account-kind list agrees with the Worker's",
      JSON.stringify(kinds) === JSON.stringify([...ACCESS_ACCOUNT_KINDS].sort()),
      `${JSON.stringify(kinds)} vs ${JSON.stringify(ACCESS_ACCOUNT_KINDS)}`);
    ck("a general contractor is not asked",
      !mayChooseAccess("general_contractor") && mayChooseAccess("property_manager"));
    // Both spellings, because the browser holds `requestedBy` and the Worker
    // passes a raw row with `requested_by` -- normalising at each call site is
    // a conversion to forget, and a missed one here reads as "nobody to ask",
    // which silently drops the confirmation step.
    ck("there is somebody to ask under either spelling",
      canAskTenant({ requestedBy: "u" }) && canAskTenant({ requested_by: "u" })
      && !canAskTenant({}) && !canAskTenant(null));
  }

  console.log("\n-- the screens --");
  {
    const src = readFileSync(join(app, "src", "App.tsx"), "utf8");
    ck("the job form asks it", /Who lets them in\?/.test(src));
    // Nothing preselected: a preselection mistaken for a choice is the lesson
    // the trade suggestions already paid for, and here the blank is the truth.
    ck("with nothing preselected", /access: "",/.test(src));
    ck("and only where the server would take it", /canSetAccess=\{mayChooseAccess\(kindOf\(account\)\)\}/.test(src));
    // What was actually asked for: adjust it when SCHEDULING.
    ck("the visit block says what pressing send will do",
      /ACCESS_KINDS\[job\.accessEffective\]/.test(src));
    ck("and lets it be changed there", /onClick=\{\(\) => onSetAccess\?\.\(job\.id, k\.id\)\}/.test(src));
    // A refused save that drew the new answer anyway is the shape this project
    // has now recorded four times.
    ck("the change is awaited before the row is patched",
      /await api\.patchJob\(jobId, \{ access \}\);\s*\n\s*setJobs/.test(src));
    ck("the contractor is told who opens the door", /ACCESS_KINDS\[job\.access\]\.forContractor/.test(src));
  }

  console.log("\n-- recorded where an operator looks --");
  {
    const chk = readFileSync(join(app, "worker", "migrations", "CHECK.sql"), "utf8");
    ck("CHECK.sql asks whether 060 ran", /m060_job_access/.test(chk));
    ck("and counts a value the product does not produce", /m060_inv_unknown_access/.test(chk));
    const sql = readFileSync(join(app, "worker", "migrations", "060_job_access.sql"), "utf8")
      .split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    ck("and 060 is one ALTER TABLE, which is one paste",
      (sql.match(/ALTER TABLE/gi) || []).length === 1,
      String((sql.match(/ALTER TABLE/gi) || []).length));
  }
} catch (err) {
  fail++;
  console.log("FAIL  the suite threw  --", err?.message || String(err));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
