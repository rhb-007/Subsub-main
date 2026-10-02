// An invite with a typo in the address could only be thrown away.
//
// Reported looking at "Waiting on contractors": *"make sub/contractors
// editable until they accept invite, instead of just resending or emailing
// invite"*. The panel offered Copy link, Send again and Revoke, so the only
// route from a mistyped email to a working invite was to revoke the record
// and type the whole thing again -- losing when it was first raised, and
// leaving the dashboard reading as though nobody had ever been asked.
//
// `PATCH /api/invites/:id` is the missing step. What this pins is the
// boundary and the one surprising consequence:
//
//   EDITABLE UNTIL THEY ACCEPT. After that the record is their `companies`
//   row and `PATCH /api/subs/:companyId` is the door, with its own rule about
//   whose row it is. Two doors onto one record is how the two disagree.
//
//   REPLACING AN ADDRESS REISSUES THE TOKEN. Resending deliberately reuses
//   it, because reissuing breaks the link already in somebody's inbox. That
//   reasoning inverts here: the reason to change an address is that the link
//   went to the wrong person, and leaving their copy live hands a stranger a
//   way onto this account's roster. ADDING one to a link-only invite does
//   not, because nothing was ever sent and the link may already have been
//   pasted into a message by hand.
//
//   node --no-warnings scripts/invite-edit-test.mjs

import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");

const BASE = `
CREATE TABLE accounts (id TEXT PRIMARY KEY, name TEXT, kind TEXT, subdomain TEXT, plan TEXT,
  theme TEXT, logo_key TEXT, use_default_mark INTEGER DEFAULT 1);
CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, email TEXT, auth_id TEXT);
CREATE TABLE companies (id TEXT PRIMARY KEY, company TEXT);
CREATE TABLE memberships (id TEXT PRIMARY KEY, user_id TEXT, account_id TEXT, role TEXT, company_id TEXT);
-- A pm seat is narrowed through these, and the session middleware reads
-- both before any route runs.
CREATE TABLE membership_properties (membership_id TEXT, property_id TEXT);
CREATE TABLE membership_jobs (membership_id TEXT, job_id TEXT);
CREATE TABLE activity (id TEXT PRIMARY KEY, account_id TEXT, at TEXT, user_id TEXT, kind TEXT, text TEXT, meta TEXT);
CREATE TABLE sub_invites (
  id TEXT PRIMARY KEY, account_id TEXT NOT NULL, token TEXT UNIQUE NOT NULL, label TEXT,
  email TEXT, phone TEXT, contact TEXT, company_name TEXT, sent_at TEXT,
  created_by TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, expires_at TEXT NOT NULL,
  used_at TEXT, company_id TEXT, revoked_at TEXT);
`;

const tok = (n) => String(n).repeat(64).slice(0, 64);
const ahead = (d) => new Date(Date.now() + d * 86400_000).toISOString();

const seed = () => {
  const db = freshDb({ base: BASE, migrations: [] });
  db.exec(`
    INSERT INTO accounts(id,name,kind,subdomain,plan) VALUES
      ('acc1','Sound Property Management','property_manager','soundpm','scale'),
      ('acc2','Outerhome','general_contractor','outerhome','scale');
    INSERT INTO users(id,name,email) VALUES
      ('u_admin','Christopher Lane','chris@soundpm.test'),
      ('u_pm','Dana Pine','dana@soundpm.test'),
      ('u_other','Someone Else','else@outerhome.test');
    INSERT INTO companies(id,company) VALUES ('cmp_pac','Pacific apartment maintenance');
    INSERT INTO memberships(id,user_id,account_id,role,company_id) VALUES
      ('m1','u_admin','acc1','admin',NULL),
      ('m2','u_pm','acc1','pm',NULL),
      ('m3','u_other','acc2','admin',NULL);
    INSERT INTO sub_invites(id,account_id,token,email,phone,contact,company_name,sent_at,created_by,expires_at)
      VALUES ('inv_open','acc1','${tok(1)}','juan@pacificam.com','+12067778899','Juan Soto',
              'Pacific apartment maintenance','2026-10-01 23:00:00','u_admin','${ahead(30)}');
    -- A link made to hand over in person: no address, never sent by us, and
    -- quite possibly already pasted into a message by hand.
    INSERT INTO sub_invites(id,account_id,token,label,created_by,expires_at)
      VALUES ('inv_link','acc1','${tok(2)}','Somebody on site','u_admin','${ahead(30)}');
    -- Already accepted: the record is their companies row from here on.
    INSERT INTO sub_invites(id,account_id,token,email,used_at,created_by,expires_at)
      VALUES ('inv_used','acc1','${tok(3)}','in@pacificam.com','2026-09-30 10:00:00','u_admin','${ahead(30)}');
    INSERT INTO sub_invites(id,account_id,token,email,revoked_at,created_by,expires_at)
      VALUES ('inv_gone','acc1','${tok(4)}','old@pacificam.com','2026-09-30 10:00:00','u_admin','${ahead(30)}');
    -- Raised FROM a contractor's card, so their details already live on a row
    -- this account edits from the roster.
    INSERT INTO sub_invites(id,account_id,token,email,company_id,created_by,expires_at)
      VALUES ('inv_card','acc1','${tok(5)}','juan@pacificam.com','cmp_pac','u_admin','${ahead(30)}');
    -- Another account's, so an id is a miss rather than a way in.
    INSERT INTO sub_invites(id,account_id,token,email,created_by,expires_at)
      VALUES ('inv_theirs','acc2','${tok(6)}','x@outerhome.test','u_other','${ahead(30)}');
  `);
  return { db, env: { DB: makeD1(db) } };
};

const patch = (env, id, body, who = "u_admin", acct = "acc1") => worker.fetch(
  new Request(`https://api.subsub.work/api/invites/${id}`, {
    method: "PATCH", body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", "X-User-Id": who, "X-Account-Id": acct },
  }), env);
const json = async (r) => [r.status, await r.json().catch(() => ({}))];
const rowOf = (db, id) => db.prepare(`SELECT * FROM sub_invites WHERE id = ?`).get(id);

try {
  console.log("\n-- the typo, corrected --");
  {
    const { db, env } = seed();
    const before = rowOf(db, "inv_open");
    const [s, b] = await json(await patch(env, "inv_open", { email: "juan@pacificam.co" }));
    ck("it saves", s === 200, `${s} ${JSON.stringify(b)}`);
    ck("and the address is the new one", rowOf(db, "inv_open").email === "juan@pacificam.co",
      rowOf(db, "inv_open").email);
    // THE REPLACED ADDRESS HELD A LIVE CREDENTIAL. Whoever got the first
    // email can still open it, and the whole reason to change the address is
    // that they should not.
    ck("the old link has stopped working", rowOf(db, "inv_open").token !== before.token);
    ck("and the reply says so, rather than leaving it to be noticed",
      b.reissued === true, String(b.reissued));
    // Nothing has gone to the new address, so the panel must stop saying it
    // has -- which is also what makes it offer Send again rather than read
    // as finished.
    ck("and it is no longer marked sent", rowOf(db, "inv_open").sent_at === null,
      String(rowOf(db, "inv_open").sent_at));
    ck("with a fresh expiry", new Date(rowOf(db, "inv_open").expires_at) > new Date(),
      rowOf(db, "inv_open").expires_at);
    ck("and the account can see what happened",
      /new link/.test(db.prepare(`SELECT text FROM activity WHERE kind='invite_updated'`).get()?.text || ""),
      db.prepare(`SELECT text FROM activity WHERE kind='invite_updated'`).get()?.text);
  }

  console.log("\n-- a name is not an address, so the link survives --");
  {
    const { db, env } = seed();
    const before = rowOf(db, "inv_open");
    const [s, b] = await json(await patch(env, "inv_open",
      { companyName: "Pacific Apartment Maintenance LLC", contact: "Juan G. Soto" }));
    ck("it saves", s === 200, `${s} ${JSON.stringify(b)}`);
    ck("the company is renamed",
      rowOf(db, "inv_open").company_name === "Pacific Apartment Maintenance LLC");
    // Killing a working link to fix a spelling would make correcting a name
    // cost somebody their invitation.
    ck("and the link is untouched", rowOf(db, "inv_open").token === before.token);
    ck("so is when it was sent", rowOf(db, "inv_open").sent_at === before.sent_at);
    ck("and the reply does not claim otherwise", b.reissued === false, String(b.reissued));
  }

  console.log("\n-- ADDING an address to a link invite is not REPLACING one --");
  {
    // Nothing was ever sent to anybody, so there is no wrong inbox to shut
    // out -- and the link may well have been pasted into a message by hand,
    // which reissuing would break.
    const { db, env } = seed();
    const before = rowOf(db, "inv_link");
    const [s, b] = await json(await patch(env, "inv_link", { email: "site@pacificam.com" }));
    ck("it saves", s === 200, `${s} ${JSON.stringify(b)}`);
    ck("the address is on it now", rowOf(db, "inv_link").email === "site@pacificam.com");
    ck("and the link somebody may already hold still works",
      rowOf(db, "inv_link").token === before.token);
    ck("and the reply says nothing was reissued", b.reissued === false, String(b.reissued));
  }

  console.log("\n-- and only what was sent is written --");
  {
    // A form that knows four fields must not blank a fifth it has never
    // heard of -- the shape that deleted a W-9 through SubForm.
    const { db, env } = seed();
    await patch(env, "inv_open", { contact: "Juan G. Soto" });
    const r = rowOf(db, "inv_open");
    ck("the fields nobody touched are still there",
      r.email === "juan@pacificam.com" && r.phone === "+12067778899"
        && r.company_name === "Pacific apartment maintenance",
      JSON.stringify({ e: r.email, p: r.phone, c: r.company_name }));
    // And an empty string clears a field on purpose, which is how somebody
    // takes a wrong number off.
    const { db: db2, env: env2 } = seed();
    const [s2] = await json(await patch(env2, "inv_open", { phone: "" }));
    ck("an emptied field is cleared", s2 === 200 && rowOf(db2, "inv_open").phone === null,
      `${s2} ${rowOf(db2, "inv_open").phone}`);
    // Removing an address is replacing it as far as the old holder is
    // concerned: their copy must stop working too.
    ck("and removing one reissues as well, because that copy is still out there",
      rowOf(db2, "inv_open").token !== tok(1));
  }

  console.log("\n-- what it refuses, and why each one is its own answer --");
  {
    const { db, env } = seed();
    let [s, b] = await json(await patch(env, "inv_used", { email: "new@pacificam.com" }));
    ck("an accepted invite is refused", s === 409 && b.error === "already_accepted", `${s} ${b.error}`);
    ck("and nothing was written", rowOf(db, "inv_used").email === "in@pacificam.com");

    [s, b] = await json(await patch(env, "inv_gone", { email: "new@pacificam.com" }));
    ck("a revoked one is refused", s === 409 && b.error === "revoked", `${s} ${b.error}`);

    // Its details already live on a row this account edits from the roster.
    // Writing the invite's copy would leave two answers to one question.
    [s, b] = await json(await patch(env, "inv_card", { email: "new@pacificam.com" }));
    ck("one raised from their card is sent to their card",
      s === 409 && b.error === "on_their_card", `${s} ${b.error}`);
    ck("and it names which card, so the screen can point at it",
      b.companyId === "cmp_pac", String(b.companyId));

    // Scoped by account, the same answer resend gives, so this cannot be
    // walked to find out which invite ids are real.
    [s, b] = await json(await patch(env, "inv_theirs", { email: "new@outerhome.test" }));
    ck("another account's invite is a miss, not a refusal",
      s === 404 && b.error === "not_found", `${s} ${b.error}`);
    ck("and an id that does not exist answers identically",
      JSON.stringify(await json(await patch(env, "inv_nope", { email: "a@b.test" })))
        === JSON.stringify([s, b]));

    [s, b] = await json(await patch(env, "inv_open", { email: "not-an-address" }));
    ck("a bad email is refused", s === 400 && b.error === "bad_email", `${s} ${b.error}`);
    [s, b] = await json(await patch(env, "inv_open", { phone: "12" }));
    ck("a bad mobile is refused", s === 400 && b.error === "bad_phone", `${s} ${b.error}`);
    ck("and neither wrote anything", rowOf(db, "inv_open").email === "juan@pacificam.com"
      && rowOf(db, "inv_open").phone === "+12067778899");

    [s, b] = await json(await patch(env, "inv_open", { email: "juan@pacificam.com" }));
    ck("a save that changes nothing says so rather than reissuing",
      s === 400 && b.error === "nothing_to_change", `${s} ${b.error}`);
    ck("and the link is untouched by it", rowOf(db, "inv_open").token === tok(1));
  }

  console.log("\n-- who may do it --");
  {
    // The same seats that create and resend one. Revoking is admin-only
    // because it destroys a live credential; correcting an address does not,
    // and a project manager chasing a contractor is exactly who notices the
    // typo.
    const { db, env } = seed();
    const [s] = await json(await patch(env, "inv_open", { contact: "Juan S." }, "u_pm"));
    ck("a project manager may correct one", s === 200, String(s));
    ck("and it was written", rowOf(db, "inv_open").contact === "Juan S.");
    // A seat on the other account cannot reach this one even by naming it.
    const [s2, b2] = await json(await patch(env, "inv_open", { contact: "x" }, "u_other", "acc1"));
    ck("somebody with no seat here cannot", s2 === 403, `${s2} ${b2.error}`);
  }

} finally { /* nothing to close */ }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
