// The two nightly growth sweeps.
//
// RE-TOUCH. The pack page promises it stays current -- "when they renew, this
// page shows the new certificate rather than the one that has lapsed" -- and
// the link expires in SHARE_DAYS. So a year later, when the certificate
// actually renews, every recipient is holding a dead URL and the promise went
// quietly unkept. The renewal now sends a fresh link.
//
// It is the cheapest recurring reach this product has, which is exactly why
// the rails matter more than the feature: it lands on general contractors who
// mostly have no account. What is asserted here is the restraint, not the
// sending.
//
// EMBED NUDGE. The public application form has existed since the start and
// nobody knows it is there. Told once, ever, at the point an account has
// enough of a roster to want it to fill itself.
//
//   node --no-warnings scripts/growth-test.mjs

import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");
const read = (f) => readFileSync(new URL(`../worker/migrations/${f}`, import.meta.url), "utf8");
const SCHEMA = readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8");
const M031 = `ALTER TABLE accounts ADD COLUMN company_id TEXT REFERENCES companies(id);`;

// A local stand-in for Resend, so the emails are real objects rather than a
// spy on a function nobody calls the same way twice.
const MAILPORT = 8957;
const inbox = [];
const mail = createServer((req, res) => {
  let b = ""; req.on("data", (d) => { b += d; });
  req.on("end", () => {
    try { inbox.push(JSON.parse(b || "{}")); } catch { /* ignore */ }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ id: `m${inbox.length}` }));
  });
}).listen(MAILPORT);

const iso = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const ENV = {
  CRON_SECRET: "s3cret", RESEND_API_KEY: "k", MAIL_FROM: "SubSub <no@subsub.test>",
  RESEND_API_BASE: `http://127.0.0.1:${MAILPORT}`,
};
const cron = (env, path) => worker.fetch(
  new Request(`https://api.subsub.work/api/cron/${path}`, {
    headers: { Authorization: "Bearer s3cret" } }), env);
const json = async (r) => [r.status, await r.json().catch(() => ({}))];
const one = (db, sql, ...b) => db.prepare(sql).get(...b);

const seed = () => {
  const db = freshDb({ base: SCHEMA,
    migrations: [M031, read("037_document_detail.sql"), read("041_doc_shares.sql"),
      read("044_retouch.sql")] });
  db.exec(`
    INSERT INTO companies(id,company,contact,email,insurance,bond)
      VALUES ('cmp_ridge','Ridge Roofing','Sam Ridge','sam@ridge.test',1,1);
    -- Last year's certificate, superseded, and this morning's replacement.
    INSERT INTO company_docs(id,company_id,kind,expires_on,uploaded_at,superseded_at)
      VALUES ('d_old','cmp_ridge','insurance','${iso(-10)}','${iso(-370)}','${iso(-1)}');
    INSERT INTO company_docs(id,company_id,kind,expires_on,uploaded_at)
      VALUES ('d_new','cmp_ridge','insurance','${iso(360)}','${iso(-1)}');
    -- Two general contractors they sent paperwork to last year. Both links
    -- expired months ago, which is the whole problem.
    INSERT INTO doc_shares(id,token,company_id,to_email,to_name,expires_at)
      VALUES ('sh_a','tok_a','cmp_ridge','pm@cascade.test','Priya','${iso(-340)}'),
             ('sh_b','tok_b','cmp_ridge','ops@birch.test','Bo','${iso(-300)}');`);
  return { db, env: { ...ENV, DB: makeD1(db) } };
};

console.log("\n-- a renewal reaches the people who were already sent it --");
{
  inbox.length = 0;
  const { db, env } = seed();
  const [s, out] = await json(await cron(env, "retouch"));
  ck("the sweep runs", s === 200, `${s} ${JSON.stringify(out)}`);
  ck("both recipients are emailed", out.sent === 2, JSON.stringify(out));
  ck("and the mail really went", inbox.length === 2, String(inbox.length));
  ck("to the right people",
    inbox.map((m) => m.to).flat().sort().join(",") === "ops@birch.test,pm@cascade.test",
    JSON.stringify(inbox.map((m) => m.to)));
  ck("saying what renewed", /renewed their certificate of insurance/i.test(inbox[0]?.subject || ""),
    inbox[0]?.subject);
  ck("and the new date", inbox.some((m) => m.text.includes(iso(360))));
  ck("it says why they are hearing from us",
    /sent you\s+their paperwork through SubSub/.test(inbox[0]?.text || ""),
    (inbox[0]?.text || "").slice(0, 200));
  ck("and how to stop", /would rather not hear/.test(inbox[0]?.text || ""));

  // A fresh link, because theirs is long dead.
  const fresh = db.prepare(
    `SELECT token, expires_at FROM doc_shares WHERE company_id='cmp_ridge' AND sent_by IS NULL
      AND id NOT IN ('sh_a','sh_b')`).all();
  ck("a new link is minted for each", fresh.length === 2, String(fresh.length));
  ck("not the expired one they were holding",
    fresh.every((f) => f.token !== "tok_a" && f.token !== "tok_b"));
  ck("and it is in the email", inbox.every((m) =>
    fresh.some((f) => m.text.includes(f.token))));
  ck("tied back to the ledger",
    one(db, `SELECT COUNT(*) AS n FROM doc_retouches WHERE share_id IS NOT NULL`).n === 2);
}

console.log("\n-- and it will not do it again --");
{
  inbox.length = 0;
  const { db, env } = seed();
  await json(await cron(env, "retouch"));
  inbox.length = 0;
  const [, again] = await json(await cron(env, "retouch"));
  ck("a second run sends nothing", again.sent === 0, JSON.stringify(again));
  ck("and no mail goes out", inbox.length === 0, String(inbox.length));
  ck("because it already told them", again.skipped?.already_told_them === 2,
    JSON.stringify(again.skipped));
  ck("with no duplicate ledger rows",
    one(db, `SELECT COUNT(*) AS n FROM doc_retouches`).n === 2);
}

console.log("\n-- the restraint, one rule at a time --");
{
  // A W-9 does not expire, so "we renewed it" is not news anybody asked for.
  const { db, env } = seed();
  db.exec(`UPDATE company_docs SET kind='w9', expires_on=NULL WHERE id='d_new';
           UPDATE company_docs SET kind='w9' WHERE id='d_old';`);
  inbox.length = 0;
  const [, r] = await json(await cron(env, "retouch"));
  ck("a document that does not expire is not a renewal", r.sent === 0, JSON.stringify(r));
  ck("and it says why", r.skipped?.does_not_expire === 2, JSON.stringify(r.skipped));
}
{
  // A first upload is not a renewal: telling somebody their contractor
  // "renewed" a certificate they have never seen is nonsense.
  const { db, env } = seed();
  db.exec(`DELETE FROM company_docs WHERE id='d_old'`);
  inbox.length = 0;
  const [, r] = await json(await cron(env, "retouch"));
  ck("a first upload sends nothing", r.sent === 0, JSON.stringify(r));
  ck("because there is nothing to renew", r.skipped?.not_a_renewal === 2,
    JSON.stringify(r.skipped));
}
{
  // A certificate already out of date is not good news.
  const { db, env } = seed();
  db.exec(`UPDATE company_docs SET expires_on='${iso(-2)}' WHERE id='d_new'`);
  inbox.length = 0;
  const [, r] = await json(await cron(env, "retouch"));
  ck("an already-expired renewal is not sent", r.sent === 0, JSON.stringify(r));
  ck("and it says why", r.skipped?.already_expired === 2, JSON.stringify(r.skipped));
}
{
  // Uploaded weeks ago is not news, and a backlog from a failing sweep must
  // not all go out at once.
  const { db, env } = seed();
  db.exec(`UPDATE company_docs SET uploaded_at='${iso(-40)}' WHERE id='d_new'`);
  inbox.length = 0;
  const [, r] = await json(await cron(env, "retouch"));
  ck("an old upload is left alone", r.sent === 0 && inbox.length === 0, JSON.stringify(r));
}
{
  // The subcontractor withdrew that link. Re-sending one they revoked would
  // undo a decision they made about their own paperwork.
  const { db, env } = seed();
  db.exec(`UPDATE doc_shares SET revoked_at='${iso(-5)}' WHERE id='sh_a'`);
  inbox.length = 0;
  const [, r] = await json(await cron(env, "retouch"));
  ck("a revoked share is not revived", r.sent === 1, JSON.stringify(r));
  ck("and it says why", r.skipped?.share_revoked === 1, JSON.stringify(r.skipped));
  ck("the other still goes", inbox[0]?.to?.[0] === "ops@birch.test",
    JSON.stringify(inbox.map((m) => m.to)));
}
{
  // One email per recipient per quiet period, however many documents renewed.
  const { db, env } = seed();
  db.exec(`INSERT INTO company_docs(id,company_id,kind,expires_on,uploaded_at,superseded_at)
             VALUES ('b_old','cmp_ridge','bond','${iso(-5)}','${iso(-380)}','${iso(-1)}');
           INSERT INTO company_docs(id,company_id,kind,expires_on,uploaded_at)
             VALUES ('b_new','cmp_ridge','bond','${iso(300)}','${iso(-1)}');`);
  inbox.length = 0;
  const [, r] = await json(await cron(env, "retouch"));
  ck("two documents renewing is still one email each", r.sent === 2, JSON.stringify(r));
  ck("not four", inbox.length === 2, String(inbox.length));
  ck("and the second is held back by the quiet period",
    r.skipped?.too_soon === 2, JSON.stringify(r.skipped));
}

console.log("\n-- saying stop, from the page they are already on --");
{
  inbox.length = 0;
  const { db, env } = seed();
  // Keyed by the token they hold: no second secret, and nobody can
  // unsubscribe anybody else.
  const [s] = await json(await worker.fetch(new Request(
    "https://api.subsub.work/api/pack/tok_a/stop",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }), env));
  ck("the opt-out takes no account", s === 200, String(s));
  ck("and is recorded against their address",
    one(db, `SELECT to_email, company_id FROM doc_share_optouts`).to_email === "pm@cascade.test");
  ck("for that subcontractor only",
    one(db, `SELECT company_id FROM doc_share_optouts`).company_id === "cmp_ridge");

  const [, r] = await json(await cron(env, "retouch"));
  ck("they are skipped", r.sent === 1, JSON.stringify(r));
  ck("by name", r.skipped?.opted_out === 1, JSON.stringify(r.skipped));
  ck("and the other recipient is unaffected",
    inbox.length === 1 && inbox[0].to[0] === "ops@birch.test", JSON.stringify(inbox.map((m) => m.to)));

  // A token that is not a share answers the same, so this cannot be used to
  // test whether a token is real.
  const [s2] = await json(await worker.fetch(new Request(
    "https://api.subsub.work/api/pack/not_a_token/stop",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }), env));
  ck("an unknown token answers the same as a real one", s2 === s, `${s2} vs ${s}`);
  ck("and records nothing", one(db, `SELECT COUNT(*) AS n FROM doc_share_optouts`).n === 1);
}
{
  // "Any contractor", not just this one.
  const { db, env } = seed();
  await worker.fetch(new Request("https://api.subsub.work/api/pack/tok_a/stop",
    { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ all: true }) }), env);
  ck("stopping all of them stores no company",
    one(db, `SELECT company_id FROM doc_share_optouts`).company_id === null);
  const [, r] = await json(await cron(env, "retouch"));
  ck("and they hear from nobody", r.skipped?.opted_out === 1, JSON.stringify(r.skipped));
}

console.log("\n-- telling an account the application form exists --");
{
  inbox.length = 0;
  const { db, env } = seed();
  db.exec(`
    INSERT INTO accounts(id,name,subdomain,kind) VALUES
      ('acc_big','Outerhome','outerhome','general_contractor'),
      ('acc_new','Fresh Start','freshstart','general_contractor');
    INSERT INTO users(id,name,email) VALUES
      ('u_pat','Pat Boss','pat@outerhome.test'),
      ('u_pm','Pam PM','pam@outerhome.test'),
      ('u_new','Nia New','nia@freshstart.test');
    INSERT INTO memberships(id,user_id,account_id,role) VALUES
      ('m1','u_pat','acc_big','admin'),
      ('m2','u_pm','acc_big','pm'),
      ('m3','u_new','acc_new','admin');
    INSERT INTO companies(id,company) VALUES ('c1','A'),('c2','B'),('c3','C'),('c4','D');
    INSERT INTO engagements(id,account_id,company_id,status) VALUES
      ('e1','acc_big','c1','active'),('e2','acc_big','c2','active'),('e3','acc_big','c3','active'),
      ('e4','acc_new','c4','active');`);

  const [s, out] = await json(await cron(env, "embed-nudge"));
  ck("the sweep runs", s === 200, `${s} ${JSON.stringify(out)}`);
  ck("the account with three contractors is told", out.sent === 1, JSON.stringify(out));
  ck("the one with a single contractor is not",
    !inbox.some((m) => (m.to || []).includes("nia@freshstart.test")),
    JSON.stringify(inbox.map((m) => m.to)));
  // A project manager does not put things on the company website.
  ck("only the admin, not the project manager",
    inbox.length === 1 && inbox[0].to[0] === "pat@outerhome.test",
    JSON.stringify(inbox.map((m) => m.to)));
  ck("it names the account", /Outerhome/.test(inbox[0]?.subject || ""), inbox[0]?.subject);
  ck("and points at the screen rather than pasting code",
    !/<form/.test(inbox[0]?.text || "") && /Contractors screen/.test(inbox[0]?.text || ""));
  ck("offering the hosted link too",
    /outerhome\.subsub\.work\/\?apply=1/.test(inbox[0]?.text || ""));

  // Once, ever.
  inbox.length = 0;
  const [, again] = await json(await cron(env, "embed-nudge"));
  ck("and it never says it twice", again.sent === 0 && inbox.length === 0,
    JSON.stringify(again));
  ck("because it wrote that down",
    one(db, `SELECT COUNT(*) AS n FROM events WHERE kind='growth.embed_nudged'`).n === 1);
}

console.log("\n-- neither sweep needs a secret it does not have --");
{
  const { env } = seed();
  for (const path of ["retouch", "embed-nudge"]) {
    const r = await worker.fetch(new Request(`https://api.subsub.work/api/cron/${path}`), env);
    ck(`${path} refuses an unauthenticated call`, r.status === 403, String(r.status));
  }
}

mail.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
