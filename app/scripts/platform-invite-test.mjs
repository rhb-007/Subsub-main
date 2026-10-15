// STAFF CAN RESEND OR CANCEL AN INVITATION NOBODY OPENED.
//
// Asked for from the console's Companies screen: an invitation that was sent
// and never opened had a window that said "resending lives on that account's
// Contractors screen" and nothing to press. What this pins:
//
//   Resend sends the SAME token again, and an expired invite gets a fresh
//   window on that same token rather than a second link.
//   Cancel revokes the link, is superadmin only, and cancels once.
//   Neither works on an invite somebody already used, and resend refuses a
//   canceled one and one with no address.
//   Both are recorded on the account that sent the invite.
//
//   node --no-warnings scripts/platform-invite-test.mjs

import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";

const supa = createServer((req, res) => {
  const who = String(req.headers.authorization || "").replace("Bearer ", "");
  if (!who || who === "nobody") { res.writeHead(401); return res.end("{}"); }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ id: `auth_${who}`, email: `${who}@subsub.test` }));
}).listen(8946);
// Every email the Worker tries to send, so "it went" is read off the wire.
const MAIL = [];
const resend = createServer((req, res) => {
  let body = "";
  req.on("data", (d) => { body += d; });
  req.on("end", () => {
    MAIL.push(JSON.parse(body || "{}"));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ id: `mail_${MAIL.length}` }));
  });
}).listen(8948);

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");
const SCHEMA = readFileSync(join(app, "worker", "schema.sql"), "utf8");
const TOKEN = "a".repeat(64), TOKEN2 = "b".repeat(64);
const later = new Date(Date.now() + 10 * 86400_000).toISOString();
const before = new Date(Date.now() - 2 * 86400_000).toISOString();

const seed = () => {
  const db = freshDb({ base: SCHEMA, migrations: [] });
  db.exec(`
    INSERT INTO accounts(id,name,kind,subdomain,plan) VALUES
      ('acc_gc','Outerhome','general_contractor','outerhome','scale');
    INSERT INTO users(id,name,email,auth_id) VALUES
      ('u_super','Richard','super@subsub.test','auth_super'),
      ('u_plain','Helper','plain@subsub.test','auth_plain');
    INSERT INTO superadmins(user_id,role,finance,impersonate) VALUES
      ('u_super','superadmin',1,1),
      ('u_plain','standard',0,0);
    INSERT INTO sub_invites(id,account_id,token,label,email,contact,company_name,sent_at,expires_at,created_at) VALUES
      ('inv_live','acc_gc','${TOKEN}','Enterprise Roofing','enterprise.roofing@live.test','Rodolfo Mendoza',
        'Enterprise Roofing','2026-10-01 10:00:00','${later}','2026-09-26 10:00:00'),
      -- Past its date: the link in their inbox is dead today.
      ('inv_old','acc_gc','${TOKEN2}','Modern Exteriors','vm@modern.test','Vlad M',
        'Modern Exteriors','2026-09-01 10:00:00','${before}','2026-08-26 10:00:00'),
      ('inv_used','acc_gc','${"c".repeat(64)}','Used Co','used@x.test',NULL,'Used Co',NULL,'${later}','2026-09-01'),
      ('inv_none','acc_gc','${"d".repeat(64)}','Hand-over link',NULL,NULL,'Hand-over',NULL,'${later}','2026-09-01');
    UPDATE sub_invites SET used_at = '2026-10-02' WHERE id = 'inv_used';
  `);
  return { db, env: { DB: makeD1(db),
    SUPABASE_URL: "http://127.0.0.1:8946", SUPABASE_ANON_KEY: "stub", STAFF_ALLOW_PASSWORD: "1",
    RESEND_API_KEY: "re_test", MAIL_FROM: "SubSub <hello@subsub.test>",
    RESEND_API_BASE: "http://127.0.0.1:8948" } };
};
const call = (env, path, who = "super") => worker.fetch(
  new Request(`https://api.subsub.work${path}`, {
    method: "POST", body: "{}",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${who}` },
  }), env);
const json = async (r) => [r.status, await r.json().catch(() => ({}))];
const inv = (db, id) => db.prepare(`SELECT * FROM sub_invites WHERE id = ?`).get(id);

try {
  console.log("\n-- resend --");
  {
    const { db, env } = seed();
    MAIL.length = 0;
    const [s, b] = await json(await call(env, "/api/platform/invites/inv_live/resend", "plain"));
    ck("standard staff may resend (support work)", s === 200 && b.ok, `${s} ${JSON.stringify(b)}`);
    ck("the email really went, to the invite's address",
      MAIL.length === 1 && [].concat(MAIL[0]?.to).includes("enterprise.roofing@live.test"), JSON.stringify(MAIL.map((m) => m.to)));
    ck("carrying the SAME link that is already in their inbox",
      MAIL.length === 1 && String(MAIL[0].html || MAIL[0].text || "").includes(TOKEN), "");
    const row = inv(db, "inv_live");
    ck("the token did not change", row.token === TOKEN);
    ck("sent_at moved", row.sent_at !== "2026-10-01 10:00:00", row.sent_at);
    ck("a live invite keeps its expiry", row.expires_at === later && b.extended === false, row.expires_at);
    const ev = db.prepare(`SELECT * FROM events WHERE kind = 'invite_resent'`).get();
    ck("recorded on the account that sent it, naming the staff member",
      ev?.account_id === "acc_gc" && ev?.actor_id === "u_plain", JSON.stringify(ev));
    const feed = db.prepare(`SELECT text FROM activity WHERE kind = 'invite_resent' AND account_id = 'acc_gc'`).get();
    ck("and its own feed says SubSub support did it", /SubSub support sent the invite to Enterprise Roofing/.test(feed?.text || ""), feed?.text);
  }
  {
    // AN EXPIRED LINK IS RENEWED ON THE SAME TOKEN, not replaced.
    const { db, env } = seed();
    MAIL.length = 0;
    const [s, b] = await json(await call(env, "/api/platform/invites/inv_old/resend"));
    const row = inv(db, "inv_old");
    ck("an expired invite can be resent", s === 200 && b.extended === true, `${s} ${JSON.stringify(b)}`);
    ck("with a new expiry about 30 days out",
      new Date(row.expires_at) > new Date(Date.now() + 29 * 86400_000), row.expires_at);
    ck("on the same token", row.token === TOKEN2);
    ck("and it went", MAIL.length === 1);
  }
  {
    const { db, env } = seed();
    const [u] = await json(await call(env, "/api/platform/invites/inv_used/resend"));
    ck("an invite somebody used is refused", u === 409);
    const [n, nb] = await json(await call(env, "/api/platform/invites/inv_none/resend"));
    ck("one with no address says so", n === 400 && nb.error === "no_contact", `${n} ${JSON.stringify(nb)}`);
    const [x] = await json(await call(env, "/api/platform/invites/nope/resend"));
    ck("an unknown id is not_found", x === 404);
    const [g] = await json(await call(env, "/api/platform/invites/inv_live/resend", "nobody"));
    ck("somebody who is not signed in gets nothing", g === 401 || g === 403, String(g));
    ck("and nothing changed", inv(db, "inv_live").sent_at === "2026-10-01 10:00:00");
  }

  console.log("\n-- cancel --");
  {
    const { db, env } = seed();
    const [p] = await json(await call(env, "/api/platform/invites/inv_live/cancel", "plain"));
    ck("standard staff may NOT cancel (it destroys a live credential)", p === 403, String(p));
    ck("and the invite is untouched", inv(db, "inv_live").revoked_at === null);
    const [s, b] = await json(await call(env, "/api/platform/invites/inv_live/cancel"));
    ck("a superadmin may", s === 200 && b.ok, `${s} ${JSON.stringify(b)}`);
    ck("and the link is revoked", !!inv(db, "inv_live").revoked_at);
    const [again] = await json(await call(env, "/api/platform/invites/inv_live/cancel"));
    ck("a second press cancels nothing more", again === 409, String(again));
    ck("recorded once on the account", db.prepare(`SELECT COUNT(*) n FROM events WHERE kind = 'invite_canceled'`).get().n === 1);
    const [r, rb] = await json(await call(env, "/api/platform/invites/inv_live/resend"));
    ck("a canceled invite cannot be resent", r === 409 && rb.error === "revoked", `${r} ${JSON.stringify(rb)}`);
    const [u] = await json(await call(env, "/api/platform/invites/inv_used/cancel"));
    ck("an invite somebody used cannot be canceled", u === 409 && !inv(db, "inv_used").revoked_at, String(u));
  }
} finally {
  supa.close(); resend.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
