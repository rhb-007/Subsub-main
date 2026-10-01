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
CREATE TABLE membership_properties (membership_id TEXT, property_id TEXT);
CREATE TABLE membership_jobs (membership_id TEXT, job_id TEXT);
CREATE TABLE properties (id TEXT PRIMARY KEY, account_id TEXT, name TEXT, address TEXT,
  city TEXT, state TEXT, zip TEXT, units INTEGER, notes TEXT,
  owner_account_id TEXT, owner_declared_at TEXT);
CREATE TABLE impersonation_sessions (
  token TEXT PRIMARY KEY, account_id TEXT NOT NULL, act_as_user_id TEXT NOT NULL,
  staff_user_id TEXT NOT NULL, reason TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL, ended_at TEXT);
`;

const seed = () => {
  const db = freshDb({ base: BASE, migrations: [] });
  db.exec(`
    INSERT INTO accounts(id,name,kind) VALUES ('acc1','Cascade Management','property_manager'),
                                              ('acc2','Sound PM','property_manager'),
                                              -- THE REPORTED SHAPE: one seat, and it is not an admin.
                                              -- The console's account INSERT only writes an admin when
                                              -- it is given an owner email, and its add-user defaults
                                              -- to pm, so an account made without an address and
                                              -- then given one person is exactly this.
                                              ('acc3','Sound Property Management','property_manager'),
                                              -- And one with nobody on it at all, which is the only
                                              -- case that may still refuse.
                                              ('acc4','Empty Co','property_manager');
    INSERT INTO companies(id,company) VALUES ('cmp_sj','San Juan Exteriors'),('cmp_pug','Puget Electricity');
    INSERT INTO users(id,name,email,auth_id) VALUES
      ('u_staff','Staff Person','staff@subsub.test','auth_staff'),
      ('u_nofl','No Flag','noflag@subsub.test','auth_noflag'),
      ('u_admin','Account Admin','admin@cascade.test',NULL),
      ('u_sj','Richard Braun','rb@sanjuan.test',NULL),
      ('u_pug','Mega Slavo','mega@puget.test',NULL),
      ('u_else','Somebody Else','else@sound.test',NULL),
      ('u_pm','Dana Pine','dana@soundpm.test',NULL),
      ('u_ten','Tenant Person','ten@soundpm.test',NULL),
      ('u_dana2','Dana Two','dana2@soundpm.test',NULL);
    INSERT INTO superadmins(user_id,role,impersonate) VALUES ('u_staff','superadmin',1),('u_nofl','superadmin',0);
    INSERT INTO memberships(id,user_id,account_id,role,company_id) VALUES
      ('m1','u_admin','acc1','admin',NULL),
      ('m2','u_sj','acc1','contractor','cmp_sj'),
      ('m3','u_pug','acc1','contractor','cmp_pug'),
      ('m4','u_else','acc2','admin',NULL),
      -- acc3 has a tenant too, so the fallback is choosing rather than
      -- taking the only row there is.
      ('m5','u_ten','acc3','tenant',NULL),
      ('m6','u_pm','acc3','pm',NULL),
      -- A pm on an account that DOES have an admin, scoped to one of its two
      -- buildings. The only fixture either direction of the standing-in rule
      -- can be checked against: an unscoped pm would pass whether or not the
      -- scope is dropped, and an account with no admin cannot show that a
      -- healthy one is left alone.
      ('m7','u_dana2','acc2','pm',NULL);
    -- BOTH pms are scoped to one of their account's two buildings, and the
    -- standing-in one has to be or the fixture cannot tell the rules apart:
    -- an unscoped pm sees the whole book whether or not the scope is dropped,
    -- so the assertion below would pass with the drop deleted. It did.
    INSERT INTO membership_properties(membership_id,property_id) VALUES ('m7','p_a'),('m6','p_c');
    INSERT INTO properties(id,account_id,name,owner_account_id) VALUES
      ('p_a','acc2','Alder Court','acc2'),
      ('p_b','acc2','Birch House','acc2'),
      ('p_c','acc3','Cedar Flats','acc3'),
      ('p_d','acc3','Dogwood Mews','acc3');
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
  console.log("\n-- AN ACCOUNT WITH NO ADMIN CAN BE OPENED AT ALL --");
  {
    // REPORTED FROM THE CONSOLE: the header read "1 Team users" and pressing
    // the button said "That account has nobody on it to sign in as". Two
    // queries disagreeing about one account, in front of somebody who could
    // see both -- the KPI counts every non-contractor membership, and this
    // route wanted `role = 'admin'`.
    const { db, env } = seed();
    const [s, b] = await json(await impersonate(env, "staff", "acc3"));
    ck("it opens", s === 200, `${s} ${JSON.stringify(b)}`);
    // It CHOOSES: a pm over a tenant, because a pm is the most complete view of
    // the account's own work. Taking the tenant would open a guest seat scoped
    // to named buildings and call it the account.
    ck("in the most able seat there is", b.actAsUserId === "u_pm", JSON.stringify(b));
    ck("and names the role", b.actAsRole === "pm", String(b.actAsRole));
    ck("the session is for that person",
      db.prepare(`SELECT act_as_user_id a FROM impersonation_sessions`).get()?.a === "u_pm");

    // SAID OUT LOUD, because the screen behind it is about to be missing
    // Account, billing and branding -- which reads as the console having
    // failed rather than as the account being short of somebody.
    ck("the reply says it fell back", b.fellBack === true, String(b.fellBack));
    ck("and that the account has no admin", b.accountHasAdmin === false, String(b.accountHasAdmin));

    // An admin seat must not claim it fell back, or the banner fires on every
    // ordinary sign-in and people stop reading it.
    const [, ok] = await json(await impersonate(env, "staff", "acc1"));
    ck("an ordinary admin sign-in says neither", ok.fellBack === false && ok.accountHasAdmin === true,
      JSON.stringify({ f: ok.fellBack, a: ok.accountHasAdmin }));
  }

  console.log("\n-- AND THE SEAT IT FELL BACK TO RUNS THE ACCOUNT --");
  {
    // THE SECOND HALF OF THE SAME REPORT. Falling back made the account
    // openable and not usable: a pm cannot reach Account, billing or
    // branding, and `runsTheAccount` being false also empties the screens
    // that remain -- a property opened with no vendor list, no Edit, no
    // owners panel, and one sentence telling a managing agent to add an
    // owner who will appoint a manager. Reported as "it says assign someone
    // to manage it -- the admin should be able to access everything within
    // this account".
    //
    // Nobody inside the account can fix it either: every door to granting
    // the admin role is requireRole("admin").
    const { env } = seed();
    const [, b] = await json(await impersonate(env, "staff", "acc3"));
    ck("the reply says the session is standing in", b.standingIn === true, String(b.standingIn));

    // `/api/billing/card` is requireRole("admin") and, with no Stripe key,
    // answers 501 for an admin and 403 for anybody else -- so it reads the
    // EFFECTIVE role out of the middleware without needing a schema.
    const card = (tok) => worker.fetch(new Request("https://api.subsub.work/api/billing/card",
      { headers: { "X-Impersonation-Token": tok } }), env);
    ck("and an admin-only route lets it through", (await card(b.token)).status === 501,
      String((await card(b.token)).status));

    // And the scope goes with the role. A pm's buildings narrow a PERSON,
    // and there is no person here -- an admin still scoped to some of the
    // book is the hybrid `runsTheAccount` refuses anyway, so leaving it
    // would redraw the half-shut account one layer down.
    const props = await worker.fetch(new Request("https://api.subsub.work/api/properties",
      { headers: { "X-Impersonation-Token": b.token } }), env);
    const rows = await props.json();
    ck("and it sees the whole book", Array.isArray(rows) && rows.length === 2,
      JSON.stringify(rows));

    // AN ACCOUNT THAT HAS AN ADMIN IS NOT WIDENED. This is why naming a seat
    // still reproduces a complaint: a scoped pm stays a scoped pm.
    const [, p2] = await json(await impersonate(env, "staff", "acc2", { userId: "u_dana2" }));
    ck("a pm on an account with an admin does not stand in", p2.standingIn === false,
      String(p2.standingIn));
    ck("so the admin-only route still refuses it", (await card(p2.token)).status === 403,
      String((await card(p2.token)).status));
    const scoped = await (await worker.fetch(new Request("https://api.subsub.work/api/properties",
      { headers: { "X-Impersonation-Token": p2.token } }), env)).json();
    ck("and their buildings are still only theirs",
      scoped.length === 1 && scoped[0].id === "p_a", JSON.stringify(scoped));

    // A GUEST IS NEVER PROMOTED, however short of admins the account is. An
    // owner or a tenant is somebody else's client; standing in their seat is
    // how support sees what a client sees.
    const [, t] = await json(await impersonate(env, "staff", "acc3", { userId: "u_ten" }));
    ck("a tenant seat on the same admin-less account does not stand in",
      t.standingIn === false, String(t.standingIn));
    ck("and gets no admin route", (await card(t.token)).status === 403,
      String((await card(t.token)).status));

    // The audit trail says what was done, not only whose seat it was. "(pm
    // seat)" over a session that reached billing understates it.
    const { db: db3, env: env3 } = seed();
    await impersonate(env3, "staff", "acc3");
    const act = db3.prepare(`SELECT text, meta FROM activity WHERE kind='impersonation'`).get();
    ck("the activity row says it ran as an admin", /ran as one/.test(act.text), act.text);
    ck("and the meta records it", JSON.parse(act.meta).ranAsAdmin === true, act.meta);
    const { db: db4, env: env4 } = seed();
    await impersonate(env4, "staff", "acc2", { userId: "u_dana2" });
    const plain = db4.prepare(`SELECT text, meta FROM activity WHERE kind='impersonation'`).get();
    ck("an ordinary pm seat still reads as a pm seat",
      /\(pm seat\)$/.test(plain.text) && JSON.parse(plain.meta).ranAsAdmin === false, plain.text);
  }

  console.log("\n-- and nobody at all is still refused, in its own words --");
  {
    const { env } = seed();
    const [s, b] = await json(await impersonate(env, "staff", "acc4"));
    ck("an account with no memberships is refused", s === 409, `${s} ${JSON.stringify(b)}`);
    // A DIFFERENT ERROR FROM THE OLD ONE. `no_admin_on_account` was shown over a
    // header saying there was a user; this only fires when there is genuinely
    // nobody, so the console can say the thing to do about it.
    ck("and says there is no seat, not no admin", b.error === "no_seat_on_account", String(b.error));
    ck("naming a person who is not there is still its own refusal",
      (await json(await impersonate(env, "staff", "acc4", { userId: "u_pm" })))[1].error === "not_on_this_account");
  }

  console.log("\n-- the console says the same two things the route does --");
  {
    const { readFileSync } = await import("node:fs");
    const APP = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
    // The old message is gone WITH the old error code, or the screen keeps
    // answering a code the server no longer sends -- which falls through to
    // a raw `e.message` and reads as an unexplained failure.
    ck("the screen no longer answers the retired code", !/no_admin_on_account/.test(APP));
    ck("it answers the one the route sends", /no_seat_on_account/.test(APP));
    ck("and tells somebody what to do about it", /Add a user to it first/.test(APP));
    // The banner has two sentences to say now, and they are different
    // sentences. Standing in: the account has nobody to administer it, and
    // this session is being one -- the customer's to fix. A named non-admin
    // seat on a healthy account: this is that person's view, which is what
    // was asked for.
    ck("the banner has a standing-in branch", /impersonating\.standingIn \?/.test(APP));
    ck("and still names a deliberately named seat", /impersonating\.seatRole \?/.test(APP));
    ck("and says what is actually wrong with the account",
      /This account has <b>no admin<\/b>/.test(APP));
    ck("and what to do about it", /Give somebody the admin role/.test(APP));

    // THE SCOPE GOES WITH THE ROLE IN THE BROWSER TOO, which is where the
    // reported symptom actually was: `runsTheAccount` is
    // `isStaffRole(role) && !isScoped(membership)`, so promoting the role
    // alone leaves a scoped pm drawing the half-shut property panel. Read
    // statically because driving the console's sign-in in a browser needs the
    // staff console, Supabase and a live API; what that costs is that this
    // pins the shape rather than the behaviour, so the next line pins that
    // nothing reads the raw seat for the role any more.
    ck("the effective membership drops the scope as well as the role",
      /role: "admin", propertyIds: \[\], jobIds: \[\]/.test(APP));
    ck("and the role is read off that, not off the seat row",
      /const role = membership\.role;/.test(APP) && !/const role = seat\.role;/.test(APP));
  }

} finally {
  supa.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
