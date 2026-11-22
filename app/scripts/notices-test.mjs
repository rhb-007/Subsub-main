// THE CONSOLE'S NOTIFICATIONS SCREEN, AND THE EMAILS NOBODY WAS SENT.
//
// Reported as a new subcontractor signing up to Outerhome with no email to
// the account, and asked for as one place in the console to see every
// notification, switch one off and change its words. What this pins:
//
//   Every entry in shared/notices.js is a composer mail.js tags, and its
//   standard words render from the sample (a sample that throws is a row with
//   no words on the console).
//   Any staff member reads the list, with the last 30 days off email_log.
//   Only a superadmin changes one, with a reason; a required one cannot be
//   switched off; a placeholder the email does not have is refused; an
//   invite's body must keep {{link}}.
//   Saved words are what is SENT, through the real apply route, and an email
//   switched off is not sent and is logged as notice_off.
//   Reset puts the standard words back.
//   A contractor accepting a connect request now emails the account that
//   asked, which nothing did before.
//
//   node --no-warnings scripts/notices-test.mjs

import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";
import { NOTICES } from "../shared/notices.js";
import * as MAILMOD from "../worker/mail.js";

const supa = createServer((req, res) => {
  const who = String(req.headers.authorization || "").replace("Bearer ", "");
  if (!who || who === "nobody") { res.writeHead(401); return res.end("{}"); }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ id: `auth_${who}`, email: `${who}@subsub.test` }));
}).listen(8962);
const MAIL = [];
const resend = createServer((req, res) => {
  let body = "";
  req.on("data", (d) => { body += d; });
  req.on("end", () => {
    if (req.url.endsWith("/emails")) MAIL.push(JSON.parse(body || "{}"));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ id: `mail_${MAIL.length}` }));
  });
}).listen(8964);

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");
const SCHEMA = readFileSync(join(app, "worker", "schema.sql"), "utf8");

const db = freshDb({ base: SCHEMA, migrations: [] });
db.exec(`
  INSERT INTO accounts(id,name,kind,subdomain,plan) VALUES
    ('acc_gc','Outerhome','general_contractor','outerhome','scale'),
    ('acc_sub','Pine Roofing','subcontractor','pine','basic');
  INSERT INTO companies(id,company,contact,email) VALUES ('cmp_pine','Pine Roofing','Pat Pine','pat@pine.test');
  UPDATE accounts SET company_id = 'cmp_pine' WHERE id = 'acc_sub';
  INSERT INTO users(id,name,email,auth_id) VALUES
    ('u_super','Richard Staff','super@subsub.test','auth_super'),
    ('u_plain','Helper','plain@subsub.test','auth_plain'),
    ('u_owner','Richard Braun','owner@outerhome.test','auth_owner'),
    ('u_pat','Pat Pine','pat@pine.test','auth_pat');
  INSERT INTO superadmins(user_id,role,finance,impersonate) VALUES
    ('u_super','superadmin',1,1), ('u_plain','standard',0,0);
  INSERT INTO memberships(id,user_id,account_id,role) VALUES
    ('m1','u_owner','acc_gc','admin'), ('m2','u_pat','acc_sub','admin');
  INSERT INTO connect_requests(id,account_id,company_id,requested_by) VALUES ('cr1','acc_gc','cmp_pine','u_owner');
  INSERT INTO email_log(id,account_id,to_email,kind,subject,status,error,at) VALUES
    ('e1','acc_gc','a@x.test','roster_joined','s','sent',NULL,datetime('now','-1 day')),
    ('e2','acc_gc','b@x.test','roster_joined','s','failed','send_failed: domain not verified',datetime('now','-2 day')),
    ('e3','acc_gc','c@x.test','roster_joined','s','sent',NULL,datetime('now','-40 day'));
`);
const env = { DB: makeD1(db),
  SUPABASE_URL: "http://127.0.0.1:8962", SUPABASE_ANON_KEY: "stub", STAFF_ALLOW_PASSWORD: "1",
  RESEND_API_KEY: "re_test", MAIL_FROM: "SubSub <hello@subsub.test>", RESEND_API_BASE: "http://127.0.0.1:8964" };
const ctx = { waitUntil() {} };
const call = (method, path, body, who = "super", acct = null) => worker.fetch(
  new Request(`https://api.subsub.work${path}`, {
    method, body: method === "GET" ? undefined : JSON.stringify(body || {}),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${who}`,
      ...(acct ? { "X-Account-Id": acct } : {}) },
  }), env, ctx);
const json = async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) });

try {
  // ---- the catalog ---------------------------------------------------------
  for (const n of NOTICES) {
    const fn = MAILMOD[n.composer];
    let m = null, err = "";
    try { m = fn(n.sample); } catch (e) { err = String(e?.message || e); }
    ck(`${n.key}: the standard words render from the sample`, !!m?.subject && !!m?.text, err);
    ck(`${n.key}: tagged with its own key`, m?.notice?.kind === n.key, JSON.stringify(m?.notice?.kind));
  }
  const keys = NOTICES.map((n) => n.key);
  ck("no key is listed twice", new Set(keys).size === keys.length);

  // ---- reading -------------------------------------------------------------
  const list = await json(await call("GET", "/api/platform/notices", null, "plain"));
  ck("any staff member reads the list", list.status === 200, String(list.status));
  ck("every notice is on it", (list.body.notices || []).length === NOTICES.length);
  const rj = (list.body.notices || []).find((n) => n.key === "roster_joined");
  ck("the last 30 days are counted off email_log, not all time",
    rj?.last30?.sent === 1 && rj?.last30?.failed === 1, JSON.stringify(rj?.last30));
  ck("and the last failure carries its error", /domain not verified/.test(rj?.last30?.lastError?.error || ""));
  ck("it says mail is configured", list.body.mailConfigured === true);
  ck("customer seats cannot read it",
    (await call("GET", "/api/platform/notices", null, "owner", "acc_gc")).status >= 401);

  // ---- refusals ------------------------------------------------------------
  const r1 = await json(await call("PUT", "/api/platform/notices/roster_joined", { subject: "x", reason: "r" }, "plain"));
  ck("a standard staff member cannot change one", r1.status === 403, String(r1.status));
  const r2 = await json(await call("PUT", "/api/platform/notices/roster_joined", { subject: "x" }));
  ck("a change needs a reason", r2.body.error === "reason_required");
  const r3 = await json(await call("PUT", "/api/platform/notices/sub_invite", { enabled: false, reason: "r" }));
  ck("an invite cannot be switched off", r3.status === 409 && r3.body.error === "required_notice");
  const r4 = await json(await call("PUT", "/api/platform/notices/roster_joined",
    { subject: "{{companyName}} for {{nonsense}}", reason: "r" }));
  ck("a placeholder this email does not have is refused, by name",
    r4.body.error === "unknown_placeholder" && r4.body.unknown?.includes("nonsense"), JSON.stringify(r4.body));
  const r5 = await json(await call("PUT", "/api/platform/notices/user_invite",
    { body: "Welcome aboard {{name}}.", reason: "r" }));
  ck("an invite's body must keep the link", r5.body.error === "link_required");

  // ---- saved words are what is sent ---------------------------------------
  const s1 = await json(await call("PUT", "/api/platform/notices/roster_joined", {
    subject: "New on {{account.name}}: {{companyName}}",
    body: "Hello {{firstName}},\n\n{{companyName}} ({{contact}}) wants in.\n\n{{link}}", reason: "clearer" }));
  ck("a superadmin saves new words", s1.status === 200 && s1.body.ok, JSON.stringify(s1.body));
  ck("and it is audited", !!db.prepare(`SELECT 1 FROM events WHERE kind = 'notice_changed'`).get());

  MAIL.length = 0;
  const ap = await json(await call("POST", "/api/apply/outerhome", {
    company: "T&V Sons Construction", contact: "Tomas Vega", email: "tomas@tv.test", phone: "2065550100",
    categories: ["roofing"], city: "Tacoma", zip: "98402" }, "nobody"));
  ck("the application lands", ap.status === 200, JSON.stringify(ap.body));
  const toOwner = MAIL.find((m) => (m.to || [])[0] === "owner@outerhome.test");
  ck("the account's admin is emailed about it", !!toOwner, MAIL.map((m) => m.to?.[0]).join(","));
  ck("with the saved subject, filled in", toOwner?.subject === "New on Outerhome: T&V Sons Construction", toOwner?.subject);
  ck("and the saved body, filled in",
    /Hello Richard,/.test(toOwner?.text || "") && /T&V Sons Construction \(Tomas Vega\) wants in/.test(toOwner?.text || ""),
    toOwner?.text);
  ck("the HTML is rebuilt from the new words, logo and all",
    /email-logo\.png/.test(toOwner?.html || "") && /wants in/.test(toOwner?.html || ""));

  // ---- switched off --------------------------------------------------------
  await call("PUT", "/api/platform/notices/application_received", { enabled: false, reason: "testing" });
  MAIL.length = 0;
  await call("POST", "/api/apply/outerhome", {
    company: "Cedar Gutters", contact: "Cy Cedar", email: "cy@cedar.test", phone: "2065550101",
    categories: ["gutters"], city: "Tacoma", zip: "98402" }, "nobody");
  // They still get the separate choose-a-password email, which is a
  // different notice; the one switched off is the confirmation.
  ck("an email switched off is not sent",
    !MAIL.some((m) => (m.to || [])[0] === "cy@cedar.test" && /We received your application/.test(m.subject || "")),
    MAIL.map((m) => `${m.to?.[0]}: ${m.subject}`).join(" | "));
  const offRow = db.prepare(`SELECT status, error FROM email_log WHERE kind = 'application_received' AND to_email = 'cy@cedar.test'`).get();
  ck("and the mail log says it was off", offRow?.status === "failed" && /^notice_off/.test(offRow?.error || ""), JSON.stringify(offRow));
  ck("the other emails still go", MAIL.some((m) => (m.to || [])[0] === "owner@outerhome.test"));
  const list2 = await json(await call("GET", "/api/platform/notices"));
  const ar = list2.body.notices.find((n) => n.key === "application_received");
  ck("the list says it is off, and counts the one not sent as off, not failed",
    ar.enabled === false && ar.last30.off === 1 && ar.last30.failed === 0, JSON.stringify(ar.last30));

  // ---- reset ---------------------------------------------------------------
  const rs = await json(await call("DELETE", "/api/platform/notices/roster_joined", { reason: "back" }));
  ck("reset needs nothing but a reason", rs.status === 200);
  MAIL.length = 0;
  await call("POST", "/api/apply/outerhome", {
    company: "Birch Siding", contact: "Bo Birch", email: "bo@birch.test", phone: "2065550102",
    categories: ["siding"], city: "Tacoma", zip: "98402" }, "nobody");
  const back = MAIL.find((m) => (m.to || [])[0] === "owner@outerhome.test");
  ck("and the standard words go out again", /applied to join your roster/.test(back?.subject || ""), back?.subject);

  // ---- preview and test ----------------------------------------------------
  const pv = await json(await call("POST", "/api/platform/notices/roster_joined/preview",
    { subject: "Hi {{account.name}}", body: "{{bogus}}" }, "plain"));
  ck("the preview fills the sample in and names what it cannot",
    pv.body.subject === "Hi Outerhome" && pv.body.unknown?.includes("bogus"), JSON.stringify(pv.body));
  MAIL.length = 0;
  const ts = await json(await call("POST", "/api/platform/notices/application_received/test", {}, "plain"));
  ck("a test goes to the staff member pressing it, even while the email is off",
    ts.status === 200 && MAIL[0]?.to?.[0] === "plain@subsub.test" && /^\[Test\]/.test(MAIL[0]?.subject || ""),
    JSON.stringify(ts.body));

  // ---- connect accepted now emails the asker -------------------------------
  MAIL.length = 0;
  const cr = await json(await call("POST", "/api/my-connect-requests/cr1/respond", { accept: true }, "pat", "acc_sub"));
  ck("the contractor accepts the request", cr.status === 200, JSON.stringify(cr.body));
  const told = MAIL.find((m) => (m.to || [])[0] === "owner@outerhome.test");
  ck("the account that asked is emailed", /accepted your request to connect/.test(told?.subject || ""), told?.subject);
  ck("and it is logged as roster_joined",
    !!db.prepare(`SELECT 1 FROM email_log WHERE kind = 'roster_joined' AND subject LIKE '%accepted your request%'`).get());

  // ---- the work order footer survives new words ----------------------------
  await call("PUT", "/api/platform/notices/wo_issued", { body: "New job: {{trade}}", reason: "shorter" });
  MAIL.length = 0;
  const wo = MAILMOD.workOrderIssuedEmail({ ...NOTICES.find((n) => n.key === "wo_issued").sample,
    claimLink: "https://app.subsub.work/claim/abc" });
  await MAILMOD.sendEmail(env, { to: "crew@x.test", ...wo });
  ck("a work order in new words still says how it was sent, with its claim link",
    /^New job: Roofing/.test(MAIL[0]?.text || "") && /Sent via SubSub/.test(MAIL[0]?.text || "")
      && /\/claim\/abc/.test(MAIL[0]?.text || ""), MAIL[0]?.text);

  // ---- a database without 104 ----------------------------------------------
  db.exec(`DROP TABLE notice_settings`);
  MAILMOD.forgetNoticeSettings();
  const l3 = await json(await call("GET", "/api/platform/notices"));
  ck("without 104 the list still loads and says so", l3.status === 200 && l3.body.migrated === false);
  const s3 = await json(await call("PUT", "/api/platform/notices/roster_joined", { subject: "x", reason: "r" }));
  ck("and a save names the migration", s3.body.migration === "104_notice_settings", JSON.stringify(s3.body));
} finally {
  supa.close(); resend.close();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
