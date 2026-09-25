// Support could never see what a subcontractor sees.
//
// The console's impersonate route took an account and looked up one thing:
//
//   SELECT user_id FROM memberships WHERE account_id = ? AND role = 'admin'
//
// So "sign in as this account" always meant an admin, and a subcontractor's
// portal -- a different app, with their jobs, their documents, their
// availability, their QR code -- was unreachable. "It looks wrong on my end"
// was unanswerable for the half of the people on this platform who are
// contractors.
//
// Naming a seat is a privileged act, so this covers what it must refuse as
// carefully as what it must allow: still staff, still holding the
// impersonate flag, and still a seat ON THAT ACCOUNT. Picking a person is
// choosing among people already there, never a way to reach anybody else.
//
// Driven through the real Worker against a real database, with staff auth
// going through the real Supabase code path against a stub.
//
//   node --no-warnings scripts/impersonate-seat-test.mjs

import { createServer } from "node:http";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");

// Supabase, enough of it that verifySupabaseToken() gets a real answer.
// Whoever the bearer names is who the token belongs to.
const supa = createServer((req, res) => {
  const who = String(req.headers.authorization || "").replace("Bearer ", "");
  if (!who || who === "nobody") { res.writeHead(401); return res.end("{}"); }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ id: `auth_${who}`, email: `${who}@subsub.test` }));
}).listen(8918);

const BASE = `
CREATE TABLE accounts (id TEXT PRIMARY KEY, name TEXT, kind TEXT);
CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, email TEXT, auth_id TEXT);
CREATE TABLE companies (id TEXT PRIMARY KEY, company TEXT);
CREATE TABLE memberships (id TEXT PRIMARY KEY, user_id TEXT, account_id TEXT, role TEXT, company_id TEXT);
CREATE TABLE superadmins (user_id TEXT PRIMARY KEY, role TEXT, finance INTEGER DEFAULT 0, impersonate INTEGER DEFAULT 0);
CREATE TABLE activity (id TEXT PRIMARY KEY, account_id TEXT, at TEXT, user_id TEXT, kind TEXT, text TEXT, meta TEXT);
CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id TEXT, actor_id TEXT, kind TEXT, subject_id TEXT, payload TEXT, at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE impersonation_sessions (
  token TEXT PRIMARY KEY, account_id TEXT NOT NULL, act_as_user_id TEXT NOT NULL,
  staff_user_id TEXT NOT NULL, reason TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL, ended_at TEXT);
`;

const seed = () => {
  const db = freshDb({ base: BASE, migrations: [] });
  db.exec(`
    INSERT INTO accounts(id,name,kind) VALUES ('acc1','Cascade Management','property_manager'),
                                              ('acc2','Sound PM','property_manager');
    INSERT INTO companies(id,company) VALUES ('cmp_sj','San Juan Exteriors'),('cmp_pug','Puget Electricity');
    INSERT INTO users(id,name,email,auth_id) VALUES
      ('u_staff','Staff Person','staff@subsub.test','auth_staff'),
      ('u_nofl','No Flag','noflag@subsub.test','auth_noflag'),
      ('u_admin','Account Admin','admin@cascade.test',NULL),
      ('u_sj','Richard Braun','rb@sanjuan.test',NULL),
      ('u_pug','Mega Slavo','mega@puget.test',NULL),
      ('u_else','Somebody Else','else@sound.test',NULL);
    INSERT INTO superadmins(user_id,role,impersonate) VALUES ('u_staff','superadmin',1),('u_nofl','superadmin',0);
    INSERT INTO memberships(id,user_id,account_id,role,company_id) VALUES
      ('m1','u_admin','acc1','admin',NULL),
      ('m2','u_sj','acc1','contractor','cmp_sj'),
      ('m3','u_pug','acc1','contractor','cmp_pug'),
      ('m4','u_else','acc2','admin',NULL);
  `);
  return { db, env: { DB: makeD1(db),
    SUPABASE_URL: "http://127.0.0.1:8918", SUPABASE_ANON_KEY: "stub",
    STAFF_ALLOW_PASSWORD: "1" } };
};

const impersonate = (env, who, accountId, body = {}) => worker.fetch(
  new Request(`https://api.subsub.work/api/platform/impersonate/${accountId}`, {
    method: "POST", body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${who}` },
  }), env);
const json = async (r) => [r.status, await r.json().catch(() => ({}))];

try {
  console.log("\n-- what it did before, unchanged --");
  {
    const { db, env } = seed();
    const [s, b] = await json(await impersonate(env, "staff", "acc1"));
    ck("no seat named still takes an admin", s === 200 && b.actAsUserId === "u_admin", `${s} ${JSON.stringify(b)}`);
    ck("and says which role it took", b.actAsRole === "admin", String(b.actAsRole));
    ck("the session is for that person",
      db.prepare(`SELECT act_as_user_id a FROM impersonation_sessions`).get().a === "u_admin");
  }

  console.log("\n-- and what it could never do --");
  {
    const { db, env } = seed();
    const [s, b] = await json(await impersonate(env, "staff", "acc1", { userId: "u_sj" }));
    ck("a contractor seat can be opened", s === 200 && b.actAsUserId === "u_sj", `${s} ${JSON.stringify(b)}`);
    ck("and it is named as a contractor", b.actAsRole === "contractor", String(b.actAsRole));
    ck("the session acts as them, not as an admin",
      db.prepare(`SELECT act_as_user_id a FROM impersonation_sessions`).get().a === "u_sj");
    ck("a second contractor on the same account is reachable too",
      (await json(await impersonate(env, "staff", "acc1", { userId: "u_pug" })))[1].actAsUserId === "u_pug");
  }

  console.log("\n-- naming a seat is not a way to reach anybody else --");
  {
    const { db, env } = seed();
    let [s, b] = await json(await impersonate(env, "staff", "acc1", { userId: "u_else" }));
    ck("somebody on another account is refused",
      s === 409 && b.error === "not_on_this_account", `${s} ${JSON.stringify(b)}`);
    [s, b] = await json(await impersonate(env, "staff", "acc1", { userId: "u_staff" }));
    ck("a staff member with no seat there is refused", s === 409, `${s} ${b.error}`);
    [s, b] = await json(await impersonate(env, "staff", "acc1", { userId: "nobody-at-all" }));
    ck("a user id that does not exist is refused", s === 409, `${s} ${b.error}`);
    ck("and none of those opened a session",
      db.prepare(`SELECT COUNT(*) n FROM impersonation_sessions`).get().n === 0,
      String(db.prepare(`SELECT COUNT(*) n FROM impersonation_sessions`).get().n));
  }

  console.log("\n-- and it is still staff only --");
  {
    const { db, env } = seed();
    let [s] = await json(await impersonate(env, "nobody", "acc1", { userId: "u_sj" }));
    ck("no session at all is refused", s === 401, String(s));
    [s] = await json(await impersonate(env, "rb", "acc1", { userId: "u_sj" }));
    ck("a customer login is refused", s === 403, String(s));
    [s] = await json(await impersonate(env, "noflag", "acc1", { userId: "u_sj" }));
    ck("staff without the impersonate flag is refused", s === 403, String(s));
    ck("and none of them opened a session",
      db.prepare(`SELECT COUNT(*) n FROM impersonation_sessions`).get().n === 0);
  }

  console.log("\n-- the account is told whose seat was taken --");
  {
    const { db, env } = seed();
    await impersonate(env, "staff", "acc1", { userId: "u_sj" });
    const act = db.prepare(`SELECT text, meta FROM activity WHERE kind='impersonation'`).get();
    ck("the activity row says it was not an admin seat",
      /contractor seat/.test(act.text), act.text);
    const meta = JSON.parse(act.meta);
    ck("and records who", meta.actAsUserId === "u_sj" && meta.actAsRole === "contractor", act.meta);
    const ev = db.prepare(`SELECT payload FROM events WHERE kind='impersonation_started'`).get();
    ck("so does the event", JSON.parse(ev.payload).actAsUserId === "u_sj", ev.payload);

    // The ordinary case still reads the way it always did.
    const { db: db2, env: env2 } = seed();
    await impersonate(env2, "staff", "acc1");
    ck("an admin seat still reads plainly",
      db2.prepare(`SELECT text FROM activity WHERE kind='impersonation'`).get().text
        === "Staff Person signed in as this account",
      db2.prepare(`SELECT text FROM activity WHERE kind='impersonation'`).get().text);
  }
} finally {
  supa.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
