// An invite nobody has accepted can be finished by hand.
//
// Asked for from the invite panel: "Include add to roster from this
// treatment, so I can simply add them myself". The account types the rest in
// through the ordinary add form, and POST /api/subs takes `fromInviteId`:
//
//   The invite is checked BEFORE anything is written, so a refused one leaves
//   no roster row behind (accepted, revoked, already on a card, another
//   account's).
//   It is BOUND to the record it makes, so the link already in their inbox
//   lands their login on this row rather than minting a second copy of them.
//   Nothing more is sent: no second invitation for one person.
//
//   node --no-warnings scripts/invite-to-roster-test.mjs

import { readFileSync } from "node:fs";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d && !ok ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");
const SCHEMA = readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8");
const ahead = (d) => new Date(Date.now() + d * 86400_000).toISOString();
const tok = (n) => String(n).repeat(64).slice(0, 64);

const seed = () => {
  const db = freshDb({ base: SCHEMA, migrations: [] });
  db.exec(`
    INSERT INTO accounts(id,name,subdomain,kind,plan,billing) VALUES
      ('acc','Outerhome','outerhome','general_contractor','scale','monthly'),
      ('acc2','Other GC','othergc','general_contractor','scale','monthly');
    INSERT INTO users(id,name,email) VALUES ('u_admin','Richard','r@outerhome.test'),('u_x','X','x@other.test');
    INSERT INTO memberships(id,user_id,account_id,role) VALUES ('m1','u_admin','acc','admin'),('m2','u_x','acc2','admin');
    INSERT INTO companies(id,company) VALUES ('cmp_card','Already Carded');
    INSERT INTO sub_invites(id,account_id,token,email,phone,contact,company_name,sent_at,created_by,expires_at) VALUES
      ('inv_open','acc','${tok(1)}','enterprise.roofing@live.test','+14254668486','Eli Park','Enterprise Roofing','2026-10-27 10:00:00','u_admin','${ahead(15)}'),
      ('inv_used','acc','${tok(2)}','used@x.test',NULL,'U','Used Co','2026-10-01 10:00:00','u_admin','${ahead(15)}'),
      ('inv_rev','acc','${tok(3)}','rev@x.test',NULL,'R','Rev Co','2026-10-01 10:00:00','u_admin','${ahead(15)}'),
      ('inv_card','acc','${tok(4)}','card@x.test',NULL,'C','Already Carded','2026-10-01 10:00:00','u_admin','${ahead(15)}'),
      ('inv_other','acc2','${tok(5)}','oth@x.test',NULL,'O','Other Co','2026-10-01 10:00:00','u_x','${ahead(15)}');
    UPDATE sub_invites SET used_at = '2026-10-02 10:00:00' WHERE id = 'inv_used';
    UPDATE sub_invites SET revoked_at = '2026-10-02 10:00:00' WHERE id = 'inv_rev';
    UPDATE sub_invites SET company_id = 'cmp_card' WHERE id = 'inv_card';
  `);
  return db;
};
const call = async (env, path, body) => {
  const res = await worker.fetch(new Request(`https://api.subsub.work${path}`, {
    method: "POST", headers: { "Content-Type": "application/json", "X-User-Id": "u_admin", "X-Account-Id": "acc" },
    body: JSON.stringify(body),
  }), env);
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
const sub = (over = {}) => ({
  company: "Enterprise Roofing", contact: "Eli Park", email: "enterprise.roofing@live.test", phone: "(425)466-8486",
  categories: ["roofing"], caps: ["Tear-off"], crews: [{ id: "c1", name: "Crew 1", members: [{ name: "Eli", role: "Lead" }] }],
  coverage: { mode: "cities", cities: ["Seattle"], radii: [] }, ...over,
});

{
  console.log("\n-- finishing an open invite --");
  const db = seed(); const env = { DB: makeD1(db) };
  const r = await call(env, "/api/subs", sub({ fromInviteId: "inv_open" }));
  ck("it is added", r.status === 201 && !!r.body.companyId, JSON.stringify(r));
  ck("and the reply says the invite is bound", r.body.fromInvite?.bound === true, JSON.stringify(r.body));
  const inv = db.prepare(`SELECT company_id FROM sub_invites WHERE id = 'inv_open'`).get();
  ck("the invite now names the record", inv.company_id === r.body.companyId, JSON.stringify(inv));
  const en = db.prepare(`SELECT status FROM engagements WHERE account_id = 'acc' AND company_id = ?`).get(r.body.companyId);
  ck("an engagement is on the roster", !!en, JSON.stringify(en));
  ck("no second invitation is sent", r.body.invite?.invited === false && r.body.invite?.reason === "invite_already_out", JSON.stringify(r.body.invite));
  const seats = db.prepare(`SELECT COUNT(*) AS n FROM memberships WHERE company_id = ?`).get(r.body.companyId).n;
  ck("and no seat is minted ahead of them", seats === 0, String(seats));
  const again = await call(env, "/api/subs", sub({ company: "Twice", email: "t@x.test", fromInviteId: "inv_open" }));
  ck("finishing it twice is refused", again.status === 409 && again.body.error === "on_their_card", JSON.stringify(again));
}

for (const [id, code, status] of [["inv_used", "already_accepted", 409], ["inv_rev", "revoked", 409],
  ["inv_card", "on_their_card", 409], ["inv_other", "invite_not_found", 404], ["nope", "invite_not_found", 404]]) {
  const db = seed(); const env = { DB: makeD1(db) };
  const before = db.prepare(`SELECT COUNT(*) AS n FROM engagements`).get().n;
  const r = await call(env, "/api/subs", sub({ company: `For ${id}`, email: `${id}@new.test`, fromInviteId: id }));
  ck(`${id} is refused as ${code}`, r.status === status && r.body.error === code, JSON.stringify(r));
  ck(`and nothing is written for ${id}`, db.prepare(`SELECT COUNT(*) AS n FROM engagements`).get().n === before);
}

{
  console.log("\n-- the ordinary add is unchanged --");
  const db = seed(); const env = { DB: makeD1(db) };
  const r = await call(env, "/api/subs", sub({ company: "Plain", email: "plain@new.test" }));
  ck("it is added with no invite named", r.status === 201 && !r.body.fromInvite, JSON.stringify(r.body));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
