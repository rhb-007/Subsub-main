// A document request to a contractor with no SubSub login carries their
// invite link, not a sign-in page they cannot use.
//
// Asked for as "what if I just request docs from them after I create their
// account? It should also prompt them to create a login if they haven't yet".
// The request said "Upload them here ... Sign in as <email>", which for
// somebody nobody has ever given a password is a dead end. Now:
//
//   No login and an invite already out: the SAME token goes in the request, so
//   the invitation and the request open one door, and nothing new is minted.
//   No login and no invite: one is minted on send, bound to the company, and
//   reads as sent. The preview mints nothing.
//   A login already: the request is unchanged.
//
//   node --no-warnings scripts/doc-request-login-test.mjs

import { readFileSync } from "node:fs";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d && !ok ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");
const SCHEMA = readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8");
const ahead = (d) => new Date(Date.now() + d * 86400_000).toISOString();
const tok = "a".repeat(64);

const seed = () => {
  const db = freshDb({ base: SCHEMA, migrations: [] });
  db.exec(`
    INSERT INTO accounts(id,name,subdomain,kind,plan,billing) VALUES ('acc','Outerhome','outerhome','general_contractor','scale','monthly');
    INSERT INTO users(id,name,email) VALUES ('u_admin','Richard','r@outerhome.test'),('u_sub','Sam','sam@seated.test');
    INSERT INTO memberships(id,user_id,account_id,role) VALUES ('m1','u_admin','acc','admin');
    INSERT INTO companies(id,company,contact,email) VALUES
      ('cmp_inv','Enterprise Roofing','Eli','eli@enterprise.test'),
      ('cmp_new','Fresh Gutters','Fay','fay@fresh.test'),
      ('cmp_seat','Seated Siding','Sam','sam@seated.test');
    INSERT INTO engagements(id,account_id,company_id,status) VALUES
      ('e1','acc','cmp_inv','invited'),('e2','acc','cmp_new','invited'),('e3','acc','cmp_seat','active');
    INSERT INTO memberships(id,user_id,account_id,role,company_id) VALUES ('m2','u_sub','acc','contractor','cmp_seat');
    INSERT INTO sub_invites(id,account_id,token,email,contact,company_name,company_id,sent_at,created_by,expires_at) VALUES
      ('inv_1','acc','${tok}','eli@enterprise.test','Eli','Enterprise Roofing','cmp_inv','2026-10-27 10:00:00','u_admin','${ahead(15)}');
  `);
  return db;
};
const call = async (env, path, body) => {
  const res = await worker.fetch(new Request(`https://api.subsub.work${path}`, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json", "X-User-Id": "u_admin", "X-Account-Id": "acc" },
    body: body ? JSON.stringify(body) : undefined,
  }), env);
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
const sent = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url).includes("resend")) { sent.push(JSON.parse(init.body)); return new Response(JSON.stringify({ id: "em_1" }), { status: 200 }); }
  return realFetch(url, init);
};
const ENV = (db) => ({ DB: makeD1(db), RESEND_API_KEY: "re_x", MAIL_FROM: "no-reply@subsub.work" });

try {
  {
    console.log("\n-- an invite already out --");
    const db = seed(); const env = ENV(db);
    const pv = await call(env, "/api/notify/documents/preview?companyId=cmp_inv");
    ck("the preview says they have no login yet", /don't have a SubSub login yet/.test(pv.body.text || ""), pv.body.text);
    ck("and carries their invite link", (pv.body.text || "").includes(`/?invite=${tok}`), pv.body.text);
    ck("not the sign-in instruction", !/Sign in as/.test(pv.body.text || ""), pv.body.text);
    sent.length = 0;
    const r = await call(env, "/api/notify/documents", { companyId: "cmp_inv" });
    ck("the request goes", r.status === 200, JSON.stringify(r));
    ck("with the same link", sent[0]?.text?.includes(`/?invite=${tok}`), sent[0]?.text);
    ck("and the html links it", sent[0]?.html?.includes(`href="https://app.subsub.work/?invite=${tok}"`), "");
    const n = db.prepare(`SELECT COUNT(*) AS n FROM sub_invites WHERE company_id = 'cmp_inv'`).get().n;
    ck("no second invite is minted", n === 1, String(n));
  }
  {
    console.log("\n-- no invite yet --");
    const db = seed(); const env = ENV(db);
    const pv = await call(env, "/api/notify/documents/preview?companyId=cmp_new");
    ck("the preview promises a sign-up link", /don't have a SubSub login yet/.test(pv.body.text || "")
      && /personal sign-up link/.test(pv.body.text || ""), pv.body.text);
    const none = db.prepare(`SELECT COUNT(*) AS n FROM sub_invites WHERE company_id = 'cmp_new'`).get().n;
    ck("and the preview mints nothing", none === 0, String(none));
    sent.length = 0;
    const r = await call(env, "/api/notify/documents", { companyId: "cmp_new" });
    const inv = db.prepare(`SELECT token, email, sent_at FROM sub_invites WHERE company_id = 'cmp_new'`).get();
    ck("sending mints one, bound to the company", r.status === 200 && !!inv, JSON.stringify(r));
    ck("its link is in the email", !!inv && sent[0]?.text?.includes(`/?invite=${inv.token}`), sent[0]?.text);
    ck("and it reads as sent", !!inv?.sent_at, JSON.stringify(inv));
    ck("one email, not an invite and a request", sent.length === 1, String(sent.length));
  }
  {
    console.log("\n-- a login already --");
    const db = seed(); const env = ENV(db);
    const pv = await call(env, "/api/notify/documents/preview?companyId=cmp_seat");
    ck("the request is the ordinary one", /Sign in as sam@seated\.test/.test(pv.body.text || "")
      && !/login yet/.test(pv.body.text || ""), pv.body.text);
    ck("and links the documents page", /\/documents/.test(pv.body.text || ""), pv.body.text);
  }
} finally {
  globalThis.fetch = realFetch;
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
