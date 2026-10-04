// An ADMIN was being treated as narrowed to named buildings, and the account
// shut down around them.
//
// Reported as a property manager's own building opening with no vendor list,
// no Edit, no Remove and no owners panel, under a header reading "Your
// buildings" instead of "Properties" — every one of which is `canManage`
// false. The seat was an admin: the impersonation banner carried no fallback
// note at all, which only an admin seat produces.
//
// TWO BUGS, AND EACH IS INVISIBLE WITHOUT THE OTHER.
//
//   THE DOOR. `PATCH /api/platform/accounts/:id/users/:userId` — the console's
//   role control — wrote `memberships.role` and nothing else. The customer
//   side has always gone through `setMembershipProperties` and
//   `setMembershipJobs`, which delete first and write back only for a role
//   that may carry a list. So promoting a project manager scoped to named
//   buildings left their buildings behind on an admin seat.
//
//   THE DISAGREEMENT. `propertyScope` in the Worker answers null for anything
//   but a pm, an owner or a tenant, so the API never refused anything. But
//   `/api/account-users` hands the stored rows to the browser so the user form
//   can draw the picker, and `isScoped` there read the LIST and never the
//   ROLE. Scoped on screen, unscoped on the server, and `runsTheAccount` is
//   what turned that into a locked account.
//
// Fixing only the door leaves every account already in that state broken.
// Fixing only the predicate leaves dead rows arriving for ever. Both, plus
// migration 054 for what is already there.
//
//   node --no-warnings scripts/propscope-test.mjs

import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";
import { checkExpr, checkSql } from "./lib/check-sql.mjs";
import { ALWAYS_SCOPED_ROLES, PROPERTY_SCOPED_ROLES,
  isPropertyScopedRole, isPropertyScoped } from "../shared/propscope.js";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");

// Enough Supabase that requireStaff gets a real answer. Whoever the bearer
// names is who the token belongs to.
const supa = createServer((req, res) => {
  const who = String(req.headers.authorization || "").replace("Bearer ", "");
  if (!who) { res.writeHead(401); return res.end("{}"); }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ id: `auth_${who}`, email: `${who}@subsub.test` }));
}).listen(8995);

console.log("\n-- the rule itself --");
{
  // THE WHOLE POINT: a list against a role that cannot carry one narrows
  // nobody, and reading it as a narrowing is the bug.
  ck("an admin with buildings is NOT narrowed",
    isPropertyScoped({ role: "admin", propertyIds: ["p1", "p2"] }) === false);
  ck("a project manager with buildings is",
    isPropertyScoped({ role: "pm", propertyIds: ["p1"] }) === true);
  // And a manager's list is optional, which is why the role alone cannot
  // answer it either: no rows means nobody narrowed them.
  ck("a project manager with none is not",
    isPropertyScoped({ role: "pm", propertyIds: [] }) === false);
  ck("nor is a seat with no list at all", isPropertyScoped({ role: "pm" }) === false);
  ck("and neither half alone decides it",
    isPropertyScoped({ role: "contractor", propertyIds: ["p1"] }) === false
      && isPropertyScoped({ role: "owner", propertyIds: ["p1"] }) === true);
  ck("an unknown role carries nothing", isPropertyScopedRole("wizard") === false);
  ck("and a guest role is always in the scoped set",
    ALWAYS_SCOPED_ROLES.every((r) => PROPERTY_SCOPED_ROLES.includes(r)));
}

console.log("\n-- and it is ONE rule, not one per language --");
{
  // Three expressions of it in two files is how they came to disagree. Both
  // read the module now; a copy growing back here is what this catches.
  const APP = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const W = readFileSync(new URL("../worker/index.js", import.meta.url), "utf8");
  const defines = (src) => /^const ALWAYS_SCOPED_ROLES\s*=/m.test(src);
  ck("the browser does not keep its own list", !defines(APP));
  ck("nor does the Worker", !defines(W));
  ck("both import it", /from "\.\.\/shared\/propscope\.js"/.test(APP)
    && /from "\.\.\/shared\/propscope\.js"/.test(W));
  // The predicate specifically: `isScoped` reading raw propertyIds is the
  // line that was wrong, and a reader of this file should not have to guess
  // whether it was fixed by name or by behaviour.
  ck("and isScoped is the shared predicate rather than a local one",
    /const isScoped = isPropertyScoped;/.test(APP)
      && !/const isScoped = \(m\) => \(m\?\.propertyIds/.test(APP));
}

const BASE = `
CREATE TABLE accounts (id TEXT PRIMARY KEY, name TEXT, kind TEXT, subdomain TEXT, plan TEXT);
CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, email TEXT, auth_id TEXT, phone TEXT, avatar_key TEXT);
CREATE TABLE memberships (id TEXT PRIMARY KEY, user_id TEXT, account_id TEXT, role TEXT, company_id TEXT, unit TEXT);
CREATE TABLE membership_properties (membership_id TEXT, property_id TEXT);
CREATE TABLE membership_jobs (membership_id TEXT, job_id TEXT);
CREATE TABLE properties (id TEXT PRIMARY KEY, account_id TEXT, name TEXT);
CREATE TABLE jobs (id TEXT PRIMARY KEY, account_id TEXT, title TEXT);
CREATE TABLE superadmins (user_id TEXT PRIMARY KEY, role TEXT, finance INTEGER DEFAULT 0, impersonate INTEGER DEFAULT 0);
CREATE TABLE activity (id TEXT PRIMARY KEY, account_id TEXT, at TEXT, user_id TEXT, kind TEXT, text TEXT, meta TEXT);
CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id TEXT, actor_id TEXT, kind TEXT, subject_id TEXT, payload TEXT, at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE platform_audit (id TEXT PRIMARY KEY, at TEXT, staff_user_id TEXT, account_id TEXT, kind TEXT, text TEXT, meta TEXT);
`;

const seed = () => {
  const db = freshDb({ base: BASE, migrations: [] });
  db.exec(`
    INSERT INTO accounts(id,name,kind,subdomain,plan) VALUES
      ('acc1','Sound Property Management','property_manager','soundpm','scale');
    INSERT INTO users(id,name,email,auth_id) VALUES
      ('u_staff','Richard Braun','staff@subsub.test','auth_staff'),
      ('u_pm','Christopher Lane','chris@soundpm.test','auth_chris'),
      ('u_own','Owner Person','own@soundpm.test',NULL);
    INSERT INTO superadmins(user_id,role,impersonate) VALUES ('u_staff','superadmin',1);
    INSERT INTO memberships(id,user_id,account_id,role) VALUES
      ('m_pm','u_pm','acc1','pm'),
      ('m_own','u_own','acc1','owner');
    INSERT INTO properties(id,account_id,name) VALUES
      ('p_a','acc1','Ballard Apts'),('p_b','acc1','Press Apartments');
    INSERT INTO jobs(id,account_id,title) VALUES ('j_1','acc1','Leaking sink');
    -- Scoped to one of the two buildings and one job: the only fixture either
    -- direction can be checked against.
    INSERT INTO membership_properties(membership_id,property_id) VALUES ('m_pm','p_a'),('m_own','p_b');
    INSERT INTO membership_jobs(membership_id,job_id) VALUES ('m_pm','j_1');
  `);
  return { db, env: { DB: makeD1(db),
    SUPABASE_URL: "http://127.0.0.1:8995", SUPABASE_ANON_KEY: "stub",
    STAFF_ALLOW_PASSWORD: "1" } };
};

const setRole = (env, userId, role) => worker.fetch(
  new Request(`https://api.subsub.work/api/platform/accounts/acc1/users/${userId}`, {
    method: "PATCH", body: JSON.stringify({ role }),
    headers: { "Content-Type": "application/json", Authorization: "Bearer staff" },
  }), env);
const json = async (r) => [r.status, await r.json().catch(() => ({}))];
const counts = (db, mid) => ({
  props: db.prepare(`SELECT COUNT(*) n FROM membership_properties WHERE membership_id = ?`).get(mid).n,
  jobs: db.prepare(`SELECT COUNT(*) n FROM membership_jobs WHERE membership_id = ?`).get(mid).n,
});

console.log("\n-- promoting a scoped manager takes their scope with it --");
{
  const { db, env } = seed();
  ck("they start narrowed", counts(db, "m_pm").props === 1 && counts(db, "m_pm").jobs === 1,
    JSON.stringify(counts(db, "m_pm")));
  const [s, b] = await json(await setRole(env, "u_pm", "admin"));
  ck("the role changes", s === 200 && b.role === "admin", `${s} ${JSON.stringify(b)}`);
  // THE REPORTED BUG. An admin is never narrowed by building, so rows left
  // behind are a list nothing reads on the server and everything reads in the
  // browser.
  ck("and the buildings go with it", counts(db, "m_pm").props === 0,
    String(counts(db, "m_pm").props));
  ck("and so do the jobs", counts(db, "m_pm").jobs === 0, String(counts(db, "m_pm").jobs));
  // Scoped to NOBODY ELSE: a route that cleared the table rather than the
  // seat would pass every assertion above.
  ck("and nobody else's scope is touched", counts(db, "m_own").props === 1,
    String(counts(db, "m_own").props));
}

console.log("\n-- and what the screen is then told --");
{
  // The browser reads `/api/account-users`, which hands back the STORED rows
  // so the user form can draw the picker. That is right and stays -- which is
  // exactly why the predicate has to ask about the role.
  const { db, env } = seed();
  const users = async () => (await (await worker.fetch(
    new Request("https://api.subsub.work/api/account-users",
      { headers: { Authorization: "Bearer chris", "X-Account-Id": "acc1" } }), env)).json());

  let rows = await users();
  const pm = rows.find((r) => r.id === "u_pm");
  ck("a scoped manager's buildings reach the form", (pm.propertyIds || []).length === 1,
    JSON.stringify(pm.propertyIds));
  ck("and the shared rule calls that seat narrowed", isPropertyScoped(pm) === true);

  await setRole(env, "u_pm", "admin");
  rows = await users();
  const now = rows.find((r) => r.id === "u_pm");
  ck("after the promotion there is nothing to draw", (now.propertyIds || []).length === 0,
    JSON.stringify(now.propertyIds));
  ck("and the seat reads as running the account", isPropertyScoped(now) === false);
  // THE BELT TO THAT BRACES: even with a row left behind by some older door,
  // the predicate must not narrow an admin. This is the half that fixes the
  // accounts already in that state before 054 is run.
  db.exec(`INSERT INTO membership_properties(membership_id,property_id) VALUES ('m_pm','p_a')`);
  const stale = (await users()).find((r) => r.id === "u_pm");
  ck("a stale row still reaches the form", (stale.propertyIds || []).length === 1,
    JSON.stringify(stale.propertyIds));
  ck("and is STILL not read as narrowing an admin", isPropertyScoped(stale) === false);
}

console.log("\n-- what the role route still refuses --");
{
  const { db, env } = seed();
  let [s, b] = await json(await setRole(env, "u_own", "admin"));
  ck("a guest seat is not promotable", s === 409 && b.error === "not_a_team_seat", `${s} ${b.error}`);
  // And a refusal must not have run the clearing anyway.
  ck("and their buildings are untouched", counts(db, "m_own").props === 1,
    String(counts(db, "m_own").props));
  [s, b] = await json(await setRole(env, "u_pm", "pm"));
  ck("setting the role it already has changes nothing", s === 200 && b.changed === false,
    `${s} ${JSON.stringify(b)}`);
  // Which is load-bearing: clearing on a no-op would wipe a scoped manager's
  // buildings every time somebody pressed Save over the value already there.
  ck("and their buildings survive it", counts(db, "m_pm").props === 1,
    String(counts(db, "m_pm").props));
}

console.log("\n-- 054 clears what the old door already left --");
{
  const { db } = seed();
  db.exec(`UPDATE memberships SET role = 'admin' WHERE id = 'm_pm'`);
  ck("the stale rows are there to begin with",
    counts(db, "m_pm").props === 1 && counts(db, "m_pm").jobs === 1);
  const sql = readFileSync(new URL("../worker/migrations/054_scope_rows_follow_role.sql",
    import.meta.url), "utf8");
  db.exec(sql);
  ck("it clears the buildings", counts(db, "m_pm").props === 0);
  ck("and the jobs", counts(db, "m_pm").jobs === 0);
  ck("and leaves a real scope alone", counts(db, "m_own").props === 1,
    String(counts(db, "m_own").props));
  // Pasted twice by somebody who is not sure whether it ran. Every statement
  // has to be a no-op the second time.
  db.exec(sql);
  ck("running it again does nothing", counts(db, "m_own").props === 1 && counts(db, "m_pm").props === 0);
  // ADD COLUMN is the one statement that cannot be repeated, so this is one
  // paste -- and the comment saying so must not itself look like one.
  ck("and it is one paste", !/^\s*ALTER TABLE/mi.test(sql.replace(/^\s*--.*$/gm, "")));
}

console.log("\n-- the invariant that finds it on a live database --");
{
  const { db } = seed();
  // Read out of CHECK.sql by NAME rather than by a regex ending in the alias,
  // which is what broke when that file became one row per check: the alias is
  // `AS value` now and the name is a string literal.
  let q = "";
  try { q = checkExpr("m054_inv_scoped_wrong_role"); } catch (e) { q = ""; }
  ck("CHECK.sql counts the shape", !!q && /membership_properties/.test(q), q.slice(0, 60));
  ck("and reads zero on a healthy database", db.prepare(`SELECT ${q} AS n`).get().n === 0,
    String(db.prepare(`SELECT ${q} AS n`).get().n));
  db.exec(`UPDATE memberships SET role = 'admin' WHERE id = 'm_pm'`);
  ck("and non-zero the moment a seat cannot carry its list",
    db.prepare(`SELECT ${q} AS n`).get().n === 1,
    String(db.prepare(`SELECT ${q} AS n`).get().n));
  // `_inv_` in the name is what tells schema-drift it is a must-be-zero count
  // rather than an unrun migration -- the trap that file already records.
  ck("and it says in its own name that it is an invariant",
    /m054_inv_/.test(checkSql()));
}

supa.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
