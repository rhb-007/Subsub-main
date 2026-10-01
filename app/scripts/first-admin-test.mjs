// The first person on an account is its Admin.
//
// Sound Property Management had one person, a project manager, and no admin —
// so nobody could sign in as it from the console, and nobody inside it could
// reach Account, billing or branding. Fixing the sign-in-as button was fixing
// the symptom. This is the cause:
//
//   POST /api/platform/accounts        wrote an admin membership only INSIDE
//                                      `if (ownerEmail)`.
//   POST /api/platform/accounts/:id/users
//                                      defaulted to `pm`, and the console's
//                                      form opened on `pm` too.
//
// So: create an account without an owner address, add the owner, leave the
// dropdown alone — an account with nobody who can administer it. And it could
// not get out of that by itself, because every door to granting the admin
// role is `requireRole("admin")`. The console could add people and reset
// passwords and not change this one field, so the only remaining remedy was
// SQL against D1.
//
// What the assertions are careful about:
//
//   FORCED, NOT DEFAULTED. A default that produces an account nobody can
//   administer is not a default, it is a trap — and the person who finds it is
//   the customer, weeks later, looking for billing. So asking for `pm`
//   explicitly on an account with no admin still gives an admin, and that is
//   asserted rather than only the empty-body case.
//
//   A CONTRACTOR SEAT IS NOT A TEAM SEAT. Promoting one would put a
//   subcontractor in charge of the account that hires them.
//
//   node --no-warnings scripts/first-admin-test.mjs

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");

const supa = createServer((req, res) => {
  const who = String(req.headers.authorization || "").replace("Bearer ", "");
  if (!who || who === "nobody") { res.writeHead(401); return res.end("{}"); }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ id: `auth_${who}`, email: `${who}@subsub.test` }));
}).listen(8920);

const BASE = `
CREATE TABLE accounts (id TEXT PRIMARY KEY, name TEXT, kind TEXT, plan TEXT, subdomain TEXT);
CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, email TEXT, phone TEXT, auth_id TEXT);
CREATE TABLE companies (id TEXT PRIMARY KEY, company TEXT);
CREATE TABLE memberships (id TEXT PRIMARY KEY, user_id TEXT, account_id TEXT, role TEXT, company_id TEXT);
CREATE TABLE superadmins (user_id TEXT PRIMARY KEY, role TEXT, finance INTEGER DEFAULT 0, impersonate INTEGER DEFAULT 0);
CREATE TABLE activity (id TEXT PRIMARY KEY, account_id TEXT, at TEXT, user_id TEXT, kind TEXT, text TEXT, meta TEXT);
CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id TEXT, actor_id TEXT, kind TEXT, subject_id TEXT, payload TEXT, at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE sub_invites (id TEXT PRIMARY KEY, token TEXT, account_id TEXT, email TEXT, company_id TEXT, role TEXT, name TEXT, created_at TEXT, expires_at TEXT, redeemed_at TEXT, revoked_at TEXT, invited_by TEXT, sent_at TEXT);
`;

const seed = () => {
  const db = freshDb({ base: BASE, migrations: [] });
  db.exec(`
    INSERT INTO accounts(id,name,kind,plan,subdomain) VALUES
      ('acc_none','Sound Property Management','property_manager','scale','soundpm'),
      ('acc_has','Cascade Management','property_manager','scale','cascade');
    INSERT INTO companies(id,company) VALUES ('cmp_sj','San Juan Exteriors');
    INSERT INTO users(id,name,email,auth_id) VALUES
      ('u_staff','Staff Person','staff@subsub.test','auth_staff'),
      ('u_admin','Account Admin','admin@cascade.test',NULL),
      ('u_pm','Dana Pine','dana@cascade.test',NULL),
      ('u_sub','Sub Person','sub@sanjuan.test',NULL);
    INSERT INTO superadmins(user_id,role,impersonate) VALUES ('u_staff','superadmin',1);
    INSERT INTO memberships(id,user_id,account_id,role,company_id) VALUES
      ('m1','u_admin','acc_has','admin',NULL),
      ('m2','u_pm','acc_has','pm',NULL),
      ('m3','u_sub','acc_has','contractor','cmp_sj');
  `);
  return { db, env: { DB: makeD1(db),
    SUPABASE_URL: "http://127.0.0.1:8920", SUPABASE_ANON_KEY: "stub",
    STAFF_ALLOW_PASSWORD: "1" } };
};

const post = (env, accountId, body) => worker.fetch(
  new Request(`https://api.subsub.work/api/platform/accounts/${accountId}/users`, {
    method: "POST", body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", Authorization: "Bearer staff" },
  }), env);
const patch = (env, accountId, userId, body) => worker.fetch(
  new Request(`https://api.subsub.work/api/platform/accounts/${accountId}/users/${userId}`, {
    method: "PATCH", body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", Authorization: "Bearer staff" },
  }), env);
const json = async (r) => [r.status, await r.json().catch(() => ({}))];
const roleOf = (db, acc, email) => db.prepare(
  `SELECT m.role r FROM memberships m JOIN users u ON u.id = m.user_id
    WHERE m.account_id = ? AND lower(u.email) = lower(?)`).get(acc, email)?.r;

try {
  console.log("\n-- the first person on an account is its admin --");
  {
    const { db, env } = seed();
    // THE REPORTED PRESS: the console's form opens on the pm option, so this
    // is what adding the owner of a new account actually sent.
    const [s, b] = await json(await post(env, "acc_none",
      { name: "Rick Owner", email: "rick@soundpm.test", role: "pm" }));
    ck("the request goes through", s === 200 || s === 201, `${s} ${JSON.stringify(b).slice(0, 80)}`);
    // FORCED, not defaulted: `pm` was asked for explicitly and overridden,
    // because an account nobody can administer is not a thing to allow
    // somebody to make by leaving a dropdown alone.
    ck("and they are an Admin, not what the form said",
      roleOf(db, "acc_none", "rick@soundpm.test") === "admin",
      String(roleOf(db, "acc_none", "rick@soundpm.test")));
    ck("the reply says it was overridden", b.forcedAdmin === true, String(b.forcedAdmin));
    // Said in the audit trail too, or "why is this person an admin" has no
    // answer six months later.
    ck("and the audit row says why",
      /first person on the account/.test(
        db.prepare(`SELECT text t FROM activity WHERE kind = 'user_added'`).get()?.t || ""),
      db.prepare(`SELECT text t FROM activity WHERE kind = 'user_added'`).get()?.t);
  }

  console.log("\n-- and the SECOND person is whatever was asked for --");
  {
    const { db, env } = seed();
    // An account that already has an admin is not short of one, so the form's
    // answer stands. Forcing every seat to admin would be the opposite bug.
    const [, b] = await json(await post(env, "acc_has",
      { name: "New Manager", email: "new@cascade.test", role: "pm" }));
    ck("a pm stays a pm", roleOf(db, "acc_has", "new@cascade.test") === "pm",
      String(roleOf(db, "acc_has", "new@cascade.test")));
    ck("and nothing claims it was overridden", !b.forcedAdmin, String(b.forcedAdmin));
    const [, b2] = await json(await post(env, "acc_has",
      { name: "Second Admin", email: "two@cascade.test", role: "admin" }));
    ck("an admin asked for is an admin", roleOf(db, "acc_has", "two@cascade.test") === "admin");
    ck("and that is not an override either", !b2.forcedAdmin, String(b2.forcedAdmin));
  }

  console.log("\n-- a contractor seat is not a team seat --");
  {
    const { db, env } = seed();
    // A roster seat on an account with no admin must NOT be promoted: that
    // would hand the account to a subcontractor it hires.
    await json(await post(env, "acc_none",
      { name: "Roofer", email: "roofer@sanjuan.test", role: "contractor" }));
    ck("adding one to an admin-less account leaves it a contractor",
      roleOf(db, "acc_none", "roofer@sanjuan.test") === "contractor",
      String(roleOf(db, "acc_none", "roofer@sanjuan.test")));
    ck("so the account still has no admin",
      !db.prepare(`SELECT 1 y FROM memberships WHERE account_id = 'acc_none' AND role = 'admin'`).get());
  }

  console.log("\n-- AND AN ACCOUNT ALREADY STUCK HAS A WAY OUT --");
  {
    // There was no route to change a role anywhere, which is what made this a
    // dead end rather than a nuisance: the customer's own door is
    // requireRole("admin"), which such an account cannot get through.
    const { db, env } = seed();
    db.exec(`INSERT INTO memberships(id,user_id,account_id,role) VALUES ('m9','u_pm','acc_none','pm')`);
    const [s, b] = await json(await patch(env, "acc_none", "u_pm", { role: "admin" }));
    ck("a project manager can be promoted", s === 200 && b.role === "admin", `${s} ${JSON.stringify(b)}`);
    ck("and the membership actually moved",
      roleOf(db, "acc_none", "dana@cascade.test") === "admin",
      String(roleOf(db, "acc_none", "dana@cascade.test")));
    ck("it is audited, with where it came from",
      /from pm to admin/.test(db.prepare(
        `SELECT text t FROM activity WHERE kind = 'user_role_changed'`).get()?.t || ""),
      db.prepare(`SELECT text t FROM activity WHERE kind = 'user_role_changed'`).get()?.t);
  }

  console.log("\n-- what it refuses --");
  {
    const { db, env } = seed();
    // THE LAST ADMIN MAY NOT BE DEMOTED. Without this the console can produce
    // the very state it exists to fix, in one press -- and this route is the
    // only thing that could undo it.
    const [s, b] = await json(await patch(env, "acc_has", "u_admin", { role: "pm" }));
    ck("the only admin cannot be demoted", s === 409 && b.error === "last_admin", `${s} ${JSON.stringify(b)}`);
    ck("and they are still an admin",
      roleOf(db, "acc_has", "admin@cascade.test") === "admin");
    // With a second admin there, it is an ordinary change.
    await json(await post(env, "acc_has", { name: "Second", email: "two@cascade.test", role: "admin" }));
    ck("with somebody else holding it, the demotion goes through",
      (await json(await patch(env, "acc_has", "u_admin", { role: "pm" })))[0] === 200);

    const { env: e2 } = seed();
    // One rule for all three non-team seats rather than a special case per
    // seat -- which is how owner and tenant were missed in the first place.
    ck("a contractor seat is refused",
      (await json(await patch(e2, "acc_has", "u_sub", { role: "admin" })))[1].error === "not_a_team_seat");
    ck("somebody not on the account is refused",
      (await json(await patch(e2, "acc_none", "u_admin", { role: "admin" })))[1].error === "not_on_this_account");
    ck("and a role that is not a team role is refused",
      (await json(await patch(e2, "acc_has", "u_pm", { role: "contractor" })))[1].error === "bad_role");
    ck("staff without a session cannot reach it at all",
      (await worker.fetch(new Request(
        "https://api.subsub.work/api/platform/accounts/acc_has/users/u_pm",
        { method: "PATCH", body: "{}", headers: { "Content-Type": "application/json" } }), e2)).status >= 400);
  }

  console.log("\n-- A GUEST SEAT IS NOT A TEAM SEAT --");
  {
    // THE BUG THE ROLE CONTROL SHIPPED WITH. The console's Team panel lists
    // every membership that is not a contractor, which is NOT the team: a
    // building owner invited onto a managing agent's account and a tenant of
    // one of its buildings both appear there. The first version of this route
    // refused only `contractor`, so either of them could be made an admin --
    // handing a client, or a tenant, admin of their agent's whole business:
    // every other building, every contractor on the roster, the billing.
    const { db, env } = seed();
    db.exec(`INSERT INTO users(id,name,email) VALUES ('u_own','Owner Guest','own@landlord.test'),
                                                    ('u_ten','Tenant Guest','ten@flat.test')`);
    db.exec(`INSERT INTO memberships(id,user_id,account_id,role) VALUES
               ('g1','u_own','acc_has','owner'), ('g2','u_ten','acc_has','tenant')`);
    const [s1, b1] = await json(await patch(env, "acc_has", "u_own", { role: "admin" }));
    ck("a building owner guest cannot be promoted", s1 === 409 && b1.error === "not_a_team_seat",
      `${s1} ${JSON.stringify(b1)}`);
    ck("and the refusal names the seat it is", b1.seat === "owner", String(b1.seat));
    ck("a tenant cannot either",
      (await json(await patch(env, "acc_has", "u_ten", { role: "admin" })))[1].error === "not_a_team_seat");
    ck("and neither of them moved",
      roleOf(db, "acc_has", "own@landlord.test") === "owner"
      && roleOf(db, "acc_has", "ten@flat.test") === "tenant");
    // The contractor case still refuses, under the one rule rather than its
    // own special case.
    ck("a contractor seat is still refused",
      (await json(await patch(env, "acc_has", "u_sub", { role: "admin" })))[1].error === "not_a_team_seat");
  }

  console.log("\n-- the console says the same thing the route does --");
  {
    const APP = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
    // The form must not open on `pm` for an account with no admin, or the
    // screen shows one thing and the server stores another -- which is the
    // same lie as a screen being stricter than its route, pointed at a
    // dropdown.
    ck("the add-user form opens on Admin when there is no admin",
      /role: teamHasAdmin \? "pm" : "admin"/.test(APP));
    // And the dropdown is not drawn at all there. Offering a choice the route
    // overrides is the screen-that-lies rule with the lie on the server side:
    // somebody picks pm, presses Add, and gets an admin with nothing having
    // said so.
    ck("and it does not offer a choice the route will override",
      /teamHasAdmin \? \(\s*<select value=\{addUser\.role\}/.test(APP));
    ck("saying what will happen instead",
      /the first person on an account runs it/.test(APP));
    // The condition is reported rather than left to be discovered.
    ck("and the panel says when nobody can administer the account",
      /Nobody on this account is an Admin/.test(APP));
    // The role is a control, which is the thing that did not exist.
    ck("the role is editable", /onSetUserRole\(open\.a\.id, u\.id, e\.target\.value\)/.test(APP));
    // AND ONLY FOR A TEAM SEAT. The select carries just Admin and Property
    // manager, so drawing it over an `owner` row renders a control reading
    // "Admin" for somebody who is not one -- a screen stating a role that is
    // not held, which is worse than the missing control it replaced.
    ck("but only for a team seat", /\{!isTeamSeat\(m\.role\) \? \(/.test(APP));
    ck("a guest keeps a plain badge", /role-badge r-\$\{m\.role\}[\s\S]{0,160}roleLabelIn\(kindOf\(open\.a\), m\.role\)/.test(APP));
    // And the warning does not send somebody to promote a row that cannot be.
    ck("with only guests, the warning says to add a user instead",
      /The only seats here are guests, who cannot be promoted/.test(APP));
    ck("and a refusal says which person is the obstacle",
      /is the only Admin on this account/.test(APP));
    // Read through the shared predicate, not a second === "admin" here.
    ck("whether there is an admin is the shared rule",
      /hasAdminSeat\(teamSeats\)/.test(APP) && /from "\.\.\/shared\/seats\.js"/.test(APP));
  }
} finally {
  supa.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
