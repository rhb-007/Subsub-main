// A project manager scoped to named jobs.
//
// Seat scoping already existed and did nothing for a general contractor.
// `membership_properties` narrows a property manager to named buildings, and
// a general contractor has `properties: false` -- no buildings at all. So the
// one account kind whose pm seat is actually called a PROJECT manager had
// nothing to be scoped by, and a firm with six of them gave every one the
// whole book. The unit of work there is the job.
//
// What this covers:
//
//   NO ROWS MEANS NO RESTRICTION, which is what makes it safe to ship against
//   a live database: every pm seat that exists today has no rows and is
//   untouched. Asymmetric on purpose, copied from propertyScope.
//
//   THE LIST NARROWS AND SO DOES EVERY ID. Filtering the list is not
//   enforcement -- the id is in the URL. A scoped seat must not act on a job
//   outside its list through a job route, a work-order route or a service
//   call, which is why the guard is the middleware every one of them passes
//   rather than a check pasted into twenty handlers.
//
//   AND IT ANSWERS THE SAME AS NOT FOUND, so the refusal cannot be walked to
//   learn what else the account is running.
//
//   A CREATOR KEEPS WHAT THEY MADE. Without that, a scoped pm creates a job
//   and it vanishes on the next render.
//
//   OWNERS AND TENANTS ARE NOT TOUCHED. Their jobs follow their buildings; a
//   second, empty list would narrow them to nothing.
//
//   node --no-warnings scripts/job-scope-test.mjs

import { readFileSync } from "node:fs";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");
const J = await import("../shared/jobscope.js");
const SCHEMA = readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8");
const M053 = readFileSync(new URL("../worker/migrations/053_membership_jobs.sql", import.meta.url), "utf8");
const APP = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const CHECK = readFileSync(new URL("../worker/migrations/CHECK.sql", import.meta.url), "utf8");

const GC = "acc_gc";

const seed = () => {
  const db = freshDb({ base: SCHEMA, migrations: [M053] });
  db.exec(`
    INSERT INTO companies(id,company,contact,email,phone,city,state,zip,license,insurance,bond,contract,w9) VALUES
      ('cmp_gc','Outerhome LLC','Dana','dana@o.test','2065550001','Seattle','WA','98101','O*1',1,1,1,1),
      ('cmp_sub','Bay Roofing','Rae','rae@bay.test','2065550002','Tacoma','WA','98402','B*2',1,1,1,1);
    INSERT INTO accounts(id,name,subdomain,kind,plan,company_id) VALUES
      ('${GC}','Outerhome','outerhome','general_contractor','scale','cmp_gc'),
      ('acc_rival','Rival Builders','rival','general_contractor','basic',NULL);
    INSERT INTO engagements(id,account_id,company_id,status,categories,doc_review) VALUES
      ('en1','${GC}','cmp_sub','active','["roofing"]',
       '{"insurance":{"status":"verified"},"bond":{"status":"verified"},"contract":{"status":"verified"},"w9":{"status":"verified"}}');
    -- Three jobs. The pm below is put on the first two only.
    INSERT INTO jobs(id,account_id,title,date,trades,status) VALUES
      ('j_mine1','${GC}','Cedar reroof','2026-11-02','["roofing"]','active'),
      ('j_mine2','${GC}','Alder gutters','2026-11-09','["roofing"]','active'),
      ('j_theirs','${GC}','Birch siding','2026-11-16','["roofing"]','active'),
      -- A REAL job on ANOTHER account. Without one the "a job id that is not
      -- this account's is dropped" assertion was answered by the foreign key
      -- rejecting an id that exists nowhere, which tests SQLite rather than
      -- the INSERT...SELECT -- the two guards covering for each other, which
      -- this repo has paid for before.
      ('j_rival','acc_rival','Rival job','2026-11-20','["roofing"]','active');
    INSERT INTO users(id,name,email) VALUES
      ('u_admin','Dana Ruiz','dana@o.test'),
      ('u_pm','Pat Lee','pat@o.test'),
      ('u_pm_wide','Jo Kim','jo@o.test');
    INSERT INTO memberships(id,user_id,account_id,role) VALUES
      ('m_admin','u_admin','${GC}','admin'),
      ('m_pm','u_pm','${GC}','pm'),
      ('m_wide','u_pm_wide','${GC}','pm');
    INSERT INTO membership_jobs(membership_id,job_id) VALUES
      ('m_pm','j_mine1'), ('m_pm','j_mine2');
  `);
  return db;
};

const ENV = (db) => ({ DB: makeD1(db) });
const ADMIN = { u: "u_admin" }, PM = { u: "u_pm" }, WIDE = { u: "u_pm_wide" };
const call = async (env, path, { method = "GET", seat = PM, body } = {}) => {
  const res = await worker.fetch(new Request(`https://api.subsub.work${path}`, {
    method,
    headers: { "X-User-Id": seat.u, "X-Account-Id": GC, "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }), env);
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
const jobIds = async (env, seat) => {
  const r = await call(env, "/api/jobs", { seat });
  const rows = r.body.jobs || r.body || [];
  return (Array.isArray(rows) ? rows : []).map((j) => j.id).sort();
};

// ---------------------------------------------------------------------------
console.log("-- the rule, and the asymmetry it copies --");
{
  ck("a pm with rows is narrowed to them",
    JSON.stringify(J.jobScopeFrom("pm", ["a", "b"])) === JSON.stringify(["a", "b"]));
  // NO ROWS MEANS NO RESTRICTION. null, never [] -- an empty array means
  // "narrowed to nothing", which is a different answer and the wrong one.
  ck("a pm with no rows is unrestricted, and that is null rather than empty",
    J.jobScopeFrom("pm", []) === null && J.jobScopeFrom("pm", undefined) === null);
  ck("an admin is never job-scoped", J.jobScopeFrom("admin", ["a"]) === null);
  // Their jobs already follow their buildings; a second, empty list would
  // narrow them to nothing.
  ck("and neither is an owner or a tenant",
    J.jobScopeFrom("owner", ["a"]) === null && J.jobScopeFrom("tenant", ["a"]) === null);
  ck("maySeeJob lets an unrestricted seat through and holds a narrowed one",
    J.maySeeJob(null, "x") && J.maySeeJob(["a"], "a") && !J.maySeeJob(["a"], "b"));
}

console.log("\n-- the list --");
{
  const db = seed(); const env = ENV(db);
  ck("a narrowed project manager sees only their jobs",
    JSON.stringify(await jobIds(env, PM)) === JSON.stringify(["j_mine1", "j_mine2"]),
    JSON.stringify(await jobIds(env, PM)));
  // The control, and the whole of what makes this safe to ship: a pm nobody
  // narrowed sees everything, exactly as before.
  ck("a project manager nobody narrowed still sees every job",
    JSON.stringify(await jobIds(env, WIDE)) === JSON.stringify(["j_mine1", "j_mine2", "j_theirs"]));
  ck("and so does an admin",
    JSON.stringify(await jobIds(env, ADMIN)) === JSON.stringify(["j_mine1", "j_mine2", "j_theirs"]));
}

console.log("\n-- and every id, because filtering a list is not enforcement --");
{
  const db = seed(); const env = ENV(db);
  // The id is in the URL. Guessing or remembering one is all it would take.
  const mine = await call(env, "/api/jobs/j_mine1", { method: "PATCH", body: { title: "Renamed" } });
  ck("a job on their list is theirs to act on",
    mine.status < 300, `${mine.status} ${JSON.stringify(mine.body)}`);

  for (const [path, method, body] of [
    ["/api/jobs/j_theirs", "PATCH", { title: "Renamed by the wrong pm" }],
    ["/api/jobs/j_theirs/approve", "POST", {}],
    ["/api/jobs/j_theirs/decline", "POST", { note: "no" }],
    ["/api/jobs/j_theirs/complete", "POST", {}],
    ["/api/jobs/j_theirs/reopen", "POST", {}],
    ["/api/jobs/j_theirs/assign", "POST", { trade: "roofing", companyId: "cmp_sub", value: 1000 }],
  ]) {
    const r = await call(env, path, { method, body });
    ck(`  refused: ${method} ${path}`, r.status === 403 || r.status === 404,
      `${r.status} ${JSON.stringify(r.body)}`);
  }
  ck("and the job they tried to rename is untouched",
    db.prepare(`SELECT title AS t FROM jobs WHERE id='j_theirs'`).get().t === "Birch siding");
}

console.log("\n-- a work order is reached through its job, so it is guarded there --");
{
  const db = seed(); const env = ENV(db);
  // Issued by the admin on the job this pm is NOT on.
  await call(env, "/api/jobs/j_theirs/assign", { seat: ADMIN,
    method: "POST", body: { trade: "roofing", companyId: "cmp_sub", value: 500000, responseWindow: 48 } });
  const wo = db.prepare(`SELECT id FROM work_orders WHERE job_id='j_theirs'`).get();
  ck("the fixture really issued one", !!wo?.id);

  const r = await call(env, `/api/work-orders/${wo.id}/crew`, { method: "POST", body: { crewName: "A" } });
  ck("a narrowed pm cannot touch a work order on somebody else's job",
    r.status === 403 || r.status === 404, `${r.status} ${JSON.stringify(r.body)}`);

  // The control: on their own job the same route works, so the refusal above
  // is about the scope rather than the route refusing everybody.
  await call(env, "/api/jobs/j_mine1/assign", { seat: ADMIN,
    method: "POST", body: { trade: "roofing", companyId: "cmp_sub", value: 500000, responseWindow: 48 } });
  const woMine = db.prepare(`SELECT id FROM work_orders WHERE job_id='j_mine1'`).get();
  const ok = await call(env, `/api/work-orders/${woMine.id}/crew`, { method: "POST", body: { crewName: "A" } });
  ck("and can on their own", ok.status < 300, `${ok.status} ${JSON.stringify(ok.body)}`);
}

console.log("\n-- the refusal says nothing about what else the account is running --");
{
  const db = seed(); const env = ENV(db);
  const real = await call(env, "/api/jobs/j_theirs", { method: "PATCH", body: { title: "x" } });
  const fake = await call(env, "/api/jobs/j_does_not_exist", { method: "PATCH", body: { title: "x" } });
  ck("a job that exists but is not theirs, and one that does not exist, answer the same",
    real.status === fake.status && JSON.stringify(real.body) === JSON.stringify(fake.body),
    `${real.status} ${JSON.stringify(real.body)} vs ${fake.status} ${JSON.stringify(fake.body)}`);
}

console.log("\n-- a creator keeps what they made --");
{
  const db = seed(); const env = ENV(db);
  const r = await call(env, "/api/jobs", { method: "POST",
    body: { title: "New job of mine", date: "2026-12-01", trades: ["roofing"], address: "1 Pike St" } });
  ck("a narrowed pm can still create a job", r.status < 300, `${r.status} ${JSON.stringify(r.body)}`);
  const made = r.body.id || r.body.job?.id;
  // Without this the screen works, the job exists, and the person who made it
  // cannot find it or act on it.
  ck("and it is added to their list rather than vanishing",
    !!db.prepare(`SELECT 1 AS y FROM membership_jobs WHERE membership_id='m_pm' AND job_id=?`).get(made),
    String(made));
  ck("so it is on their list on the next read",
    (await jobIds(env, PM)).includes(made));
  // A pm nobody narrowed has no list, and giving them one here would narrow
  // them to the single job they just made.
  const r2 = await call(env, "/api/jobs", { seat: WIDE, method: "POST",
    body: { title: "Wide job", date: "2026-12-02", trades: ["roofing"], address: "2 Pike St" } });
  ck("an unnarrowed pm is not given a list by creating one",
    r2.status < 300
      && db.prepare(`SELECT COUNT(*) n FROM membership_jobs WHERE membership_id='m_wide'`).get().n === 0);
  ck("and still sees everything", (await jobIds(env, WIDE)).length === 5);
}

console.log("\n-- assigning the jobs, which is the only way any of this is reachable --");
{
  const db = seed(); const env = ENV(db);
  const r = await call(env, "/api/account-users/u_pm_wide", { seat: ADMIN,
    method: "PATCH", body: { jobIds: ["j_theirs"] } });
  ck("an admin can narrow a project manager", r.status < 300, JSON.stringify(r.body));
  ck("the list is stored",
    db.prepare(`SELECT job_id AS j FROM membership_jobs WHERE membership_id='m_wide'`).get().j === "j_theirs");
  ck("and takes effect", JSON.stringify(await jobIds(env, WIDE)) === JSON.stringify(["j_theirs"]));

  // A job id in the body is a claim; the INSERT...SELECT is the only thing
  // that makes it true.
  await call(env, "/api/account-users/u_pm_wide", { seat: ADMIN,
    method: "PATCH", body: { jobIds: ["j_mine1", "j_not_real", "j_rival"] } });
  const kept = db.prepare(
    `SELECT job_id AS j FROM membership_jobs WHERE membership_id='m_wide'`).all().map((r) => r.j);
  ck("only this account's job is stored -- the rival's real job is dropped too",
    JSON.stringify(kept) === JSON.stringify(["j_mine1"]), JSON.stringify(kept));
  // A row naming another account's job narrows this seat to something it can
  // never see, or -- depending which JOIN reads it -- across accounts.
  ck("and CHECK.sql's cross-account invariant reads zero",
    db.prepare(`SELECT COUNT(*) n FROM membership_jobs mj
                  JOIN memberships m ON m.id = mj.membership_id
                  JOIN jobs j ON j.id = mj.job_id
                 WHERE j.account_id <> m.account_id`).get().n === 0);

  // Clearing it is how somebody is widened back to the whole account.
  await call(env, "/api/account-users/u_pm_wide", { seat: ADMIN, method: "PATCH", body: { jobIds: [] } });
  ck("clearing the list widens them back to everything",
    (await jobIds(env, WIDE)).length === 3);

  // The list travels with the role, same rule the property one follows.
  await call(env, "/api/account-users/u_pm", { seat: ADMIN, method: "PATCH", body: { role: "admin" } });
  ck("changing the role clears a stale list",
    db.prepare(`SELECT COUNT(*) n FROM membership_jobs WHERE membership_id='m_pm'`).get().n === 0);
}

console.log("\n-- the roster reads it back, or the form opens empty over a narrowed seat --");
{
  const db = seed(); const env = ENV(db);
  const r = await call(env, "/api/account-users", { seat: ADMIN });
  const rows = r.body.users || r.body || [];
  const pm = (Array.isArray(rows) ? rows : []).find((u) => u.id === "u_pm");
  ck("a narrowed seat carries its job list",
    JSON.stringify((pm?.jobIds || []).sort()) === JSON.stringify(["j_mine1", "j_mine2"]),
    JSON.stringify(pm?.jobIds));
  const wide = (Array.isArray(rows) ? rows : []).find((u) => u.id === "u_pm_wide");
  ck("and an unnarrowed one carries an empty list rather than nothing",
    Array.isArray(wide?.jobIds) && wide.jobIds.length === 0);
}

console.log("\n-- the screen --");
{
  // Offered only where buildings are not: two scope pickers on one form is
  // two lists narrowing the same person by different axes.
  ck("the picker is for a pm on an account with no buildings",
    /const scopeByJob = f\.role === "pm" && !ACCOUNT_KINDS\[accountKind\]\?\.properties && jobs\.length > 0;/.test(APP));
  ck("and it is drawn, with the none-ticked-means-everything note",
    /\{scopeByJob && !roleLocked &&/.test(APP)
      && /Leave them all unticked and they run every job on the account/.test(APP));
  ck("the form sends the list", /jobIds: scopeByJob \? f\.jobIds : \[\],/.test(APP));
  // Omitting it from the explicit field list is how a saved scope never
  // reaches the route -- the same drop-a-field shape that deleted a W-9.
  ck("and the update carries it through rather than dropping it",
    /propertyIds: u\.propertyIds \|\| \[\],\n      jobIds: u\.jobIds \|\| \[\],/.test(APP));
  ck("every UserForm call site is handed the jobs",
    (APP.match(/<UserForm /g) || []).length === (APP.match(/<UserForm [^>]*jobs=\{jobs\}/g) || []).length);
}

console.log("\n-- the migration and its invariants --");
{
  {
    // COMMENTS STRIPPED FIRST. The file's own comment says "there is no ALTER
    // TABLE", which reads to a substring check exactly like an ALTER TABLE --
    // the fourth time this repo has failed an assertion on its own
    // explanation. Same lesson test:rosterword records.
    const sql = M053.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    const creates = sql.match(/CREATE (TABLE|INDEX)[^;]*/g) || [];
    ck("053 creates something at all", creates.length === 3, String(creates.length));
    ck("and every statement is repeatable, so the file can be pasted twice",
      creates.every((c2) => /IF NOT EXISTS/.test(c2)),
      creates.filter((c2) => !/IF NOT EXISTS/.test(c2)).join(" | "));
    // ADD COLUMN is the one statement that cannot be run twice, which is why
    // it always needs a paste of its own.
    ck("and there is no ALTER TABLE", !/ALTER TABLE/.test(sql));
  }
  ck("CHECK.sql counts the table", /m053_membership_jobs/.test(CHECK));
  ck("and both invariants, which must read zero",
    /m053_inv_scoped_wrong_role/.test(CHECK) && /m053_inv_scope_crosses_account/.test(CHECK));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
