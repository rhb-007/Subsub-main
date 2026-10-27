// One owner per account (100).
//
// An account may have several admins. They are equal except here: the OWNER
// is the admin nobody else can remove or demote, and the one who removes or
// demotes other admins and hands ownership on. Billing stays with every admin.
//
//   The owner cannot be removed or demoted, by anybody, themselves included.
//   Another admin cannot remove or demote an admin; the owner can.
//   Any admin still manages a project manager.
//   The owner hands ownership to another admin, and only to an admin.
//   With nothing recorded, the earliest admin is the owner (a database
//   without 100 answers the same), and 100's backfill picks that same person.
//   The users route says who the owner is; the invariant counts an owner who
//   is no longer an admin.
//
//   node --no-warnings scripts/account-owner-test.mjs

import { readFileSync } from "node:fs";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";
import { runCheck } from "./lib/check-sql.mjs";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d && !ok ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");
const SCHEMA = readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8");
const M100 = readFileSync(new URL("../worker/migrations/100_account_owners.sql", import.meta.url), "utf8");

// Ann started the company; Bo is a later admin; Cy is a project manager. The
// LATER admin is inserted first, so "the first row back" and "the earliest
// admin" give different answers.
const seed = ({ migrated = true } = {}) => {
  const db = freshDb({ base: SCHEMA, migrations: [] });
  if (!migrated) db.exec(`DROP TABLE account_owners;`);
  db.exec(`
    INSERT INTO accounts(id,name,subdomain,kind,plan,billing) VALUES
      ('acc','Acme','acme','general_contractor','scale','monthly');
    INSERT INTO users(id,name,email) VALUES ('u_ann','Ann','ann@x.test'),('u_bo','Bo','bo@x.test'),
      ('u_cy','Cy','cy@x.test'),('u_di','Di','di@x.test');
    INSERT INTO memberships(id,user_id,account_id,role,created_at) VALUES
      ('m_bo','u_bo','acc','admin','2026-05-01 00:00:00'),
      ('m_ann','u_ann','acc','admin','2026-01-01 00:00:00'),
      ('m_cy','u_cy','acc','pm','2026-06-01 00:00:00'),
      ('m_di','u_di','acc','admin','2026-07-01 00:00:00');
  `);
  return db;
};
const ENV = (db) => ({ DB: makeD1(db) });
const call = async (env, path, { method = "GET", as = "u_ann", body } = {}) => {
  const res = await worker.fetch(new Request(`https://api.subsub.work${path}`, {
    method, headers: { "Content-Type": "application/json", "X-User-Id": as, "X-Account-Id": "acc" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }), env);
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
const roleOf = (db, u) => db.prepare(`SELECT role FROM memberships WHERE user_id = ? AND account_id = 'acc'`).get(u)?.role;

{
  console.log("\n-- with nothing recorded, the earliest admin owns it --");
  const db = seed(); const env = ENV(db);
  const users = await call(env, "/api/account-users");
  const owner = (users.body || []).filter((u) => u.isOwner).map((u) => u.id);
  ck("the users route names one owner, the earliest admin", JSON.stringify(owner) === '["u_ann"]', JSON.stringify(owner));
  const acct = await call(env, "/api/account");
  ck("and the account says so", acct.body.ownerId === "u_ann", acct.body.ownerId);
}

{
  console.log("\n-- what another admin may not do --");
  const db = seed(); const env = ENV(db);
  const rm = await call(env, "/api/account-users/u_ann", { method: "DELETE", as: "u_bo" });
  ck("remove the owner", rm.status === 409 && rm.body.error === "cannot_remove_owner", JSON.stringify(rm));
  const dm = await call(env, "/api/account-users/u_ann", { method: "PATCH", as: "u_bo", body: { role: "pm" } });
  ck("demote the owner", dm.status === 409 && dm.body.error === "owner_cannot_be_demoted", JSON.stringify(dm));
  const rmDi = await call(env, "/api/account-users/u_di", { method: "DELETE", as: "u_bo" });
  ck("remove another admin", rmDi.status === 403 && rmDi.body.error === "owner_only" && roleOf(db, "u_di") === "admin", JSON.stringify(rmDi));
  const dmDi = await call(env, "/api/account-users/u_di", { method: "PATCH", as: "u_bo", body: { role: "pm" } });
  ck("demote another admin", dmDi.status === 403 && roleOf(db, "u_di") === "admin", JSON.stringify(dmDi));
  const hand = await call(env, "/api/account/owner", { method: "POST", as: "u_bo", body: { userId: "u_bo" } });
  ck("hand ownership to themselves", hand.status === 403 && hand.body.error === "owner_only");
  const second = await call(env, "/api/account/second-business", { method: "POST", as: "u_bo",
    body: { name: "Acme PM", subdomain: "acmepm", kind: "property_manager" } });
  ck("add a second business", second.status === 403 && second.body.error === "owner_only", JSON.stringify(second));
  const pm = await call(env, "/api/account-users/u_cy", { method: "PATCH", as: "u_bo", body: { role: "admin" } });
  ck("but any admin still manages a project manager", pm.status === 200 && roleOf(db, "u_cy") === "admin", JSON.stringify(pm));
}

{
  console.log("\n-- what the owner may do --");
  const db = seed(); const env = ENV(db);
  const self = await call(env, "/api/account-users/u_ann", { method: "PATCH", as: "u_ann", body: { role: "pm" } });
  ck("not demote themselves", self.status === 409 && roleOf(db, "u_ann") === "admin", JSON.stringify(self));
  const dmDi = await call(env, "/api/account-users/u_di", { method: "PATCH", as: "u_ann", body: { role: "pm" } });
  ck("demote another admin", dmDi.status === 200 && roleOf(db, "u_di") === "pm", JSON.stringify(dmDi));
  const rmDi = await call(env, "/api/account-users/u_di", { method: "DELETE", as: "u_ann" });
  ck("remove someone", rmDi.status === 200 && !roleOf(db, "u_di"), JSON.stringify(rmDi));
  const toPm = await call(env, "/api/account/owner", { method: "POST", as: "u_ann", body: { userId: "u_cy" } });
  ck("not hand it to a project manager", toPm.status === 409 && toPm.body.error === "not_an_admin");
  const hand = await call(env, "/api/account/owner", { method: "POST", as: "u_ann", body: { userId: "u_bo" } });
  ck("hand it to another admin", hand.status === 200 && hand.body.ownerId === "u_bo", JSON.stringify(hand));
  const row = db.prepare(`SELECT user_id, set_by FROM account_owners WHERE account_id = 'acc'`).get();
  ck("recorded, with who did it", row?.user_id === "u_bo" && row.set_by === "u_ann", JSON.stringify(row));
  ck("and the feed says so", !!db.prepare(`SELECT 1 FROM activity WHERE account_id = 'acc' AND text LIKE '%made Bo the account owner%'`).get());
  const after = await call(env, "/api/account-users/u_ann", { method: "PATCH", as: "u_bo", body: { role: "pm" } });
  ck("after which the new owner may demote the old one", after.status === 200 && roleOf(db, "u_ann") === "pm", JSON.stringify(after));
  const back = await call(env, "/api/account/owner", { method: "POST", as: "u_ann", body: { userId: "u_ann" } });
  ck("and the old one cannot take it back", back.status === 403);
}

{
  console.log("\n-- an owner who stops being an admin --");
  const db = seed(); const env = ENV(db);
  db.exec(`INSERT INTO account_owners(account_id,user_id) VALUES ('acc','u_di');
           UPDATE memberships SET role = 'pm' WHERE user_id = 'u_di';`);
  const users = await call(env, "/api/account-users");
  ck("the earliest admin answers instead", (users.body || []).find((u) => u.isOwner)?.id === "u_ann");
  ck("and the invariant counts the row", runCheck(db).m100_inv_owner_not_admin === 1);
  db.exec(`UPDATE memberships SET role = 'admin' WHERE user_id = 'u_di';`);
  ck("an owner who is an admin is not counted", runCheck(db).m100_inv_owner_not_admin === 0);
}

{
  console.log("\n-- a database without 100 --");
  const db = seed({ migrated: false }); const env = ENV(db);
  const rm = await call(env, "/api/account-users/u_ann", { method: "DELETE", as: "u_bo" });
  ck("the earliest admin is still protected", rm.status === 409 && rm.body.error === "cannot_remove_owner");
  const hand = await call(env, "/api/account/owner", { method: "POST", as: "u_ann", body: { userId: "u_bo" } });
  ck("handing it on names the migration", hand.status === 503 && hand.body.migration === "100_account_owners", JSON.stringify(hand));
  console.log("\n-- the backfill --");
  db.exec(M100);
  ck("100 records the earliest admin", db.prepare(`SELECT user_id FROM account_owners WHERE account_id = 'acc'`).get()?.user_id === "u_ann");
  db.exec(M100);
  ck("and can be run twice", db.prepare(`SELECT COUNT(*) AS n FROM account_owners`).get().n === 1);
}

{
  console.log("\n-- signing up records the owner --");
  const db = seed(); const env = ENV(db);
  const r = await call(env, "/api/signup", { method: "POST", as: "", body: {
    company: "Zed Roofing", subdomain: "zedroof", name: "Zed", email: "zed@x.test", kind: "general_contractor", plan: "basic" } });
  const acct = db.prepare(`SELECT id FROM accounts WHERE subdomain = 'zedroof'`).get();
  const own = acct && db.prepare(`SELECT u.email FROM account_owners ao JOIN users u ON u.id = ao.user_id WHERE ao.account_id = ?`).get(acct.id);
  ck("the person who signed up owns it", own?.email === "zed@x.test", `${r.status} ${JSON.stringify(r.body)}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
