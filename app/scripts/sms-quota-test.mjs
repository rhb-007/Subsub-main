// Text messages: 2,500 a month on Scale, none on Basic, and past 2,500 texts
// keep going and the month is $50 for every 5,000 sent, counted from the first
// (7,000 is $100, 12,000 is $150), charged on the 1st. An account can turn
// texts off. app/shared/smsquota.js holds the figures.
//
// The property worth checking is what actually LEAVES, so Twilio and Stripe
// are stubbed at `fetch` and read back: what reaches Twilio past the
// allowance; what the nightly sweep asks Stripe to bill, exactly once; and
// that the count the screen shows is the count the bill uses.
//
//   node --no-warnings scripts/sms-quota-test.mjs

import { readFileSync } from "node:fs";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";
import { runCheck } from "./lib/check-sql.mjs";
import { SMS_INCLUDED_SCALE, SMS_BLOCK_MESSAGES, SMS_BLOCK_PRICE_CENTS, SMS_UNCAPPED_KINDS,
  SMS_OVERAGE_MAX_BLOCKS, SMS_OVERAGE_TERMS, smsAllowance, smsVerdict, smsOverageBlocks, smsOverageCents,
  monthStart, previousMonth, smsUsageText, smsOverageText } from "../shared/smsquota.js";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");
const SCHEMA = readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8");
const WORKER = readFileSync(new URL("../worker/index.js", import.meta.url), "utf8");
const M070 = readFileSync(new URL("../worker/migrations/070_sms_overage.sql", import.meta.url), "utf8");

console.log("\n-- the figures --");
{
  ck("Scale includes 2,500 a month", SMS_INCLUDED_SCALE === 2500);
  ck("overage comes in blocks of 5,000", SMS_BLOCK_MESSAGES === 5000);
  ck("at $50 a block", SMS_BLOCK_PRICE_CENTS === 5000);
  ck("Scale is 2,500", smsAllowance({ onScale: true }) === 2500);
  ck("Basic is none -- texts are part of Scale", smsAllowance({ onScale: false }) === 0);
  ck("2,500 sent is no overage", smsOverageBlocks({ allowance: 2500, used: 2500 }) === 0);
  ck("2,501 is one block -- part of 5,000 is a block", smsOverageBlocks({ allowance: 2500, used: 2501 }) === 1);
  ck("5,000 is still one", smsOverageBlocks({ allowance: 2500, used: 5000 }) === 1);
  ck("5,001 is two -- the blocks count from the first text, not from the 2,500th",
    smsOverageBlocks({ allowance: 2500, used: 5001 }) === 2);
  // The owner's own examples, in their words.
  ck("7,000 texts is $100", smsOverageCents(smsOverageBlocks({ allowance: 2500, used: 7000 })) === 10000);
  ck("12,000 texts is $150", smsOverageCents(smsOverageBlocks({ allowance: 2500, used: 12000 })) === 15000);
  ck("the runaway guard caps the bill", smsOverageBlocks({ allowance: 2500, used: 10_000_000 }) === SMS_OVERAGE_MAX_BLOCKS);

  ck("under the allowance it goes", smsVerdict({ allowance: 2500, used: 2499, billable: true }).ok);
  const first = smsVerdict({ allowance: 2500, used: 2500, billable: true });
  ck("past it, on a billable account, it STILL goes", first.ok && first.overage, JSON.stringify(first));
  ck("and the first text past it opens a block", first.startsBlock === true && first.blocks === 1);
  ck("the next one does not open another",
    smsVerdict({ allowance: 2500, used: 2501, billable: true }).startsBlock === false);
  ck("the 5,001st opens the second block",
    (() => { const v = smsVerdict({ allowance: 2500, used: 5000, billable: true }); return v.startsBlock && v.blocks === 2; })());
  ck("and the 5,000th does not",
    smsVerdict({ allowance: 2500, used: 4999, billable: true }).startsBlock === false);
  const comped = smsVerdict({ allowance: 2500, used: 2500, billable: false });
  ck("with nothing to bill it pauses at the allowance", !comped.ok && comped.reason === "sms_quota", JSON.stringify(comped));
  ck("the last text inside the ceiling goes",
    smsVerdict({ allowance: 2500, used: SMS_OVERAGE_MAX_BLOCKS * 5000 - 1, billable: true }).ok);
  const runaway = smsVerdict({ allowance: 2500, used: SMS_OVERAGE_MAX_BLOCKS * 5000, billable: true });
  ck("and a runaway stops at the ceiling", !runaway.ok && runaway.reason === "sms_overage_ceiling", JSON.stringify(runaway));
  ck("an emergency call-out goes whatever the count",
    smsVerdict({ allowance: 2500, used: 9_000_000, kind: "emergency_dispatch" }).ok
    && smsVerdict({ allowance: 2500, used: 9000, kind: "emergency_dispatch", billable: false }).ok);
  const off = smsVerdict({ allowance: 2500, used: 10, billable: true, off: true });
  ck("an account that turned texts off sends none", !off.ok && off.reason === "sms_off", JSON.stringify(off));
  ck("except an emergency call-out, which goes whatever the switch says",
    smsVerdict({ allowance: 2500, used: 10, billable: true, off: true, kind: "emergency_dispatch" }).ok);
  ck("and that is a named kind, not a flag anybody can pass", SMS_UNCAPPED_KINDS.join(",") === "emergency_dispatch");
  ck("Basic is refused by name", smsVerdict({ allowance: 0, used: 0, billable: true }).reason === "sms_not_on_plan");
  ck("the month starts on the 1st, in the shape sms_log.at sorts against",
    monthStart(new Date("2026-10-17T15:00:00Z")) === "2026-10-01");
  const pm = previousMonth(new Date("2026-01-03T15:00:00Z"));
  ck("last month across a year end", pm.month === "2025-12" && pm.from === "2025-12-01" && pm.to === "2026-01-01",
    JSON.stringify(pm));
  ck("the usage line under the allowance", smsUsageText({ allowance: 2500, used: 1234 }) === "1,234 of 2,500 text messages used this month.");
  ck("and over it", smsUsageText({ allowance: 2500, used: 3140 }) === "3,140 text messages this month — past the 2,500 included.",
    smsUsageText({ allowance: 2500, used: 3140 }));
  ck("what the 1st will charge, in words",
    smsOverageText({ allowance: 2500, used: 7000 }) === "So far this month comes to $100 (2 blocks of 5,000), charged automatically on the 1st.",
    smsOverageText({ allowance: 2500, used: 7000 }));
  ck("the price phrase carries the owner's examples",
    SMS_OVERAGE_TERMS === "$50 for every 5,000 texts sent in the month, or part of 5,000 — 7,000 is $100, 12,000 is $150",
    SMS_OVERAGE_TERMS);
}

// ---------------------------------------------------------------------------
// Twilio and Stripe, stubbed at fetch.
// ---------------------------------------------------------------------------
let twilio = [], stripe = [], stripeRefuse = null;
const json = (o, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.startsWith("https://twilio.test")) {
    twilio.push(Object.fromEntries(new URLSearchParams(String(init.body || ""))));
    return json({ sid: "SM" + twilio.length });
  }
  if (u.startsWith("https://stripe.test")) {
    const body = Object.fromEntries(new URLSearchParams(String(init.body || "")));
    stripe.push({ url: u, method: init.method || "POST", body, headers: init.headers || {} });
    if (stripeRefuse) { const m = stripeRefuse; stripeRefuse = null; return json({ error: { message: m } }, 402); }
    if (/\/invoiceitems$/.test(u)) return json({ id: "ii_" + stripe.length });
    if (/\/invoices$/.test(u)) return json({ id: "in_" + stripe.length });
    return json({ error: { message: "stub has no route for " + u } }, 404);
  }
  if (u.startsWith("https://mail.test")) return json({ id: "em_1" });
  return realFetch(url, init);
};

const ENV = (db, extra = {}) => ({
  DB: makeD1(db),
  TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "t", TWILIO_FROM: "+12065550100",
  TWILIO_API_BASE: "https://twilio.test",
  RESEND_API_KEY: "re_x", MAIL_FROM: "SubSub <hello@subsub.work>", RESEND_API_BASE: "https://mail.test",
  STRIPE_SECRET_KEY: "sk_test_x", STRIPE_API_BASE: "https://stripe.test",
  CRON_SECRET: "cron_x",
  ...extra,
});

const call = async (env, path, { method = "GET", seat = { u: "u_ad", a: "acc1" }, body, headers } = {}) => {
  const res = await worker.fetch(new Request(`https://api.subsub.work${path}`, {
    method,
    headers: { "X-User-Id": seat.u, "X-Account-Id": seat.a, "Content-Type": "application/json", ...(headers || {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }), env);
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

const LAST = previousMonth();
function seed({ plan = "scale", comped = 0, billing = "monthly", sentThisMonth = 0, sentLastMonth = 0,
                failedThisMonth = 0, withSub = true, migrate = true } = {}) {
  const db = freshDb({ base: SCHEMA, migrations: migrate ? [M070] : [] });
  if (!migrate) db.exec(`DROP TABLE IF EXISTS sms_overage; DROP TABLE IF EXISTS account_sms_settings`);
  db.exec(`
    INSERT INTO accounts(id,name,subdomain,kind,plan,comped,billing,stripe_customer_id,stripe_subscription_id)
      VALUES ('acc1','Outerhome','outerhome','general_contractor','${plan}',${comped},'${billing}',
              ${withSub ? "'cus_1'" : "NULL"}, ${withSub ? "'sub_1'" : "NULL"});
    INSERT INTO users(id,name,email) VALUES ('u_ad','Rae','rae@outerhome.test');
    INSERT INTO users(id,name,email,phone) VALUES ('u_pm','Sam','sam@outerhome.test','(206) 555-0111');
    INSERT INTO memberships(id,user_id,account_id,role) VALUES
      ('m_ad','u_ad','acc1','admin'), ('m_pm','u_pm','acc1','pm');
  `);
  const thisMonth = `${monthStart()} 09:00:00`;
  const lastMonth = `${LAST.month}-15 09:00:00`;
  const bulk = (n, at, status) => n && db.exec(`
    WITH RECURSIVE k(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM k WHERE i < ${n})
    INSERT INTO sms_log(id,account_id,to_phone,kind,status,at)
      SELECT 'x${status}${at.slice(0, 7)}' || i, 'acc1', '+12065550000', 'wo_issued', '${status}', '${at}' FROM k;`);
  bulk(sentThisMonth, thisMonth, "sent");
  bulk(sentLastMonth, lastMonth, "sent");
  bulk(failedThisMonth, thisMonth, "failed");
  return db;
}

const invite = (env) => call(env, "/api/account-users/u_pm/invite", { method: "POST" });
const lastLog = (db) => db.prepare(
  `SELECT status, error, kind FROM sms_log WHERE kind = 'user_invite' ORDER BY rowid DESC LIMIT 1`).get();
const activity = (db, kind) => db.prepare(`SELECT text FROM activity WHERE kind = ?`).all(kind).map((r) => r.text);

console.log("\n-- past the allowance, texts keep going --");
{
  const db = seed({ sentThisMonth: 2499 });
  const env = ENV(db);
  twilio = [];
  const r = await invite(env);
  ck("the 2,500th text of the month goes", twilio.length === 1 && r.body.texted === true,
    `${twilio.length} ${JSON.stringify(r.body)}`);
  ck("and opens no block -- it is still included", activity(db, "sms_overage").length === 0);
  twilio = [];
  const r2 = await invite(env);
  ck("the 2,501st goes too", twilio.length === 1 && r2.body.texted === true, JSON.stringify(r2.body));
  const told = activity(db, "sms_overage");
  ck("and the account is told, once, that it opened a $50 block",
    told.length === 1 && /passed 2,500/.test(told[0]) && /charged on the 1st: \$50 for every 5,000 texts/.test(told[0])
    && /can be turned off/.test(told[0]), told.join(" | "));
  twilio = [];
  await invite(env);
  ck("the 2,502nd goes and does not tell them again",
    twilio.length === 1 && activity(db, "sms_overage").length === 1, String(activity(db, "sms_overage").length));
}
{
  const db = seed({ sentLastMonth: 3000 });
  twilio = [];
  await invite(ENV(db));
  ck("last month's texts do not count against this one",
    twilio.length === 1 && activity(db, "sms_overage").length === 0, String(twilio.length));
}
{
  const db = seed({ sentThisMonth: 2400, failedThisMonth: 500 });
  await invite(ENV(db));
  ck("failed texts are not counted, so they are never billed", activity(db, "sms_overage").length === 0);
}
{
  const db = seed({ plan: "basic", withSub: false });
  twilio = [];
  const r = await invite(ENV(db));
  ck("Basic texts nobody", twilio.length === 0, String(twilio.length));
  ck("and the reason is that texts are Scale", /^sms_not_on_plan/.test(lastLog(db)?.error || ""), JSON.stringify(lastLog(db)));
  ck("while the email still goes", r.body.invited === true && r.body.emailed === true, JSON.stringify(r.body));
}
{
  // Comped: Scale with nothing to charge. Included texts go; past them it
  // pauses rather than running up a bill on an account we gave the plan to.
  const db = seed({ plan: "basic", comped: 1, withSub: false, sentThisMonth: 2499 });
  twilio = [];
  await invite(ENV(db));
  ck("a comped account gets the included texts", twilio.length === 1, String(twilio.length));
  twilio = [];
  await invite(ENV(db));
  ck("and pauses past them -- there is nothing to bill", twilio.length === 0, String(twilio.length));
  ck("logged with the reason", /^sms_quota/.test(lastLog(db)?.error || ""), JSON.stringify(lastLog(db)));
}
{
  const db = seed({ sentThisMonth: 2500 + SMS_OVERAGE_MAX_BLOCKS * 5000 });
  twilio = [];
  await invite(ENV(db));
  ck("a runaway month stops at the ceiling rather than billing for ever", twilio.length === 0, String(twilio.length));
}

console.log("\n-- an account can turn texts off --");
{
  const db = seed({ sentThisMonth: 10 });
  const env = ENV(db);
  let r = await call(env, "/api/billing/sms", { method: "PUT", seat: { u: "u_pm", a: "acc1" }, body: { off: true } });
  ck("a project manager cannot -- it decides what the account is charged for", r.status === 403, String(r.status));
  r = await call(env, "/api/billing/sms", { method: "PUT", body: {} });
  ck("a body with no answer is refused rather than read as off", r.status === 400 && r.body.error === "off_required",
    JSON.stringify(r.body));
  r = await call(env, "/api/billing/sms", { method: "PUT", body: { off: true } });
  ck("an admin turns them off", r.status === 200 && r.body.off === true, JSON.stringify(r.body));
  ck("and the billing panel says so", (await call(env, "/api/billing")).body.sms?.off === true);
  twilio = [];
  const inv = await invite(env);
  ck("then nothing is texted", twilio.length === 0, String(twilio.length));
  ck("logged with the reason", /^sms_off/.test(lastLog(db)?.error || ""), JSON.stringify(lastLog(db)));
  ck("while the email still goes", inv.body.emailed === true, JSON.stringify(inv.body));
  ck("and the change is on the feed", activity(db, "sms_setting").length === 1);
  r = await call(env, "/api/billing/sms", { method: "PUT", body: { off: false } });
  twilio = [];
  await invite(env);
  ck("turned back on, they go again", r.body.off === false && twilio.length === 1, String(twilio.length));
  ck("one row per account", db.prepare(`SELECT COUNT(*) n FROM account_sms_settings`).get().n === 1);
}

console.log("\n-- every text goes through the one door --");
{
  const raw = (WORKER.match(/\bsendSms\(/g) || []).length;
  ck("sendSms is called in exactly one place", raw === 1, String(raw));
  const at = WORKER.indexOf("async function sendAccountSms");
  ck("and that place is the counting door", at > 0 && /await sendSms\(env/.test(WORKER.slice(at, at + 3000)));
  ck("the emergency call-out goes through it as the uncapped kind",
    /kind: "emergency_dispatch", body: line\.slice\(0, 300\)/.test(WORKER));
  ck("the sweep runs nightly with the others", /\["sms-overage", smsOverageSweep\]/.test(WORKER));
  ck("there is no add-on to buy any more -- overage replaced it",
    !/\/api\/billing\/sms-addon/.test(WORKER) && !/sms_addon_blocks/.test(SCHEMA));
}

console.log("\n-- the billing panel reads the same count --");
{
  const db = seed({ sentThisMonth: 3140 });
  const r = await call(ENV(db), "/api/billing");
  const s = r.body.sms || {};
  ck("it says how many are used", s.used === 3140 && s.allowance === 2500, JSON.stringify(s));
  ck("and what the next bill carries so far", s.overageBlocks === 1 && s.overageCents === 5000, JSON.stringify(s));
  ck("and that it is billable", s.billable === true);
  const comped = await call(ENV(seed({ plan: "basic", comped: 1, withSub: false, sentThisMonth: 3000 })), "/api/billing");
  ck("a comped account is told nothing is billed",
    comped.body.sms?.billable === false && comped.body.sms?.overageCents === 0, JSON.stringify(comped.body.sms));
}

console.log("\n-- the sweep bills last month, once --");
{
  const db = seed({ sentLastMonth: 8000 });
  const env = ENV(db);
  stripe = [];
  const r = await call(env, "/api/cron/sms-overage", { headers: { Authorization: "Bearer cron_x" } });
  ck("it runs", r.status === 200 && r.body.billed === 1 && r.body.month === LAST.month, JSON.stringify(r.body));
  const item = stripe.find((x) => /\/invoiceitems$/.test(x.url));
  const inv = stripe.find((x) => /\/invoices$/.test(x.url));
  ck("as an invoice item on the customer", item?.body?.customer === "cus_1", JSON.stringify(item?.body));
  ck("for two blocks -- 8,000 sent is two -- at $50 each", item?.body?.amount === "10000", item?.body?.amount);
  ck("in dollars", item?.body?.currency === "usd");
  ck("on an invoice of its own, charged on the 1st rather than whenever the plan renews",
    inv?.body?.customer === "cus_1" && inv?.body?.collection_method === "charge_automatically"
    && inv?.body?.auto_advance === "true", JSON.stringify(inv?.body));
  ck("the invoice is made first and the line put on it by id",
    stripe.indexOf(inv) >= 0 && stripe.indexOf(inv) < stripe.indexOf(item)
    && item?.body?.invoice === `in_${stripe.indexOf(inv) + 1}`,
    JSON.stringify(item?.body));
  ck("and it leaves anything else pending on the customer alone -- a proration is not ours to charge",
    inv?.body?.pending_invoice_items_behavior === "exclude", inv?.body?.pending_invoice_items_behavior);
  ck("never tied to the subscription's renewal", !("subscription" in (item?.body || {})), JSON.stringify(item?.body));
  ck("and it says what it is for", /Extra text messages/.test(item?.body?.description || "")
    && /8,000 sent/.test(item?.body?.description || ""), item?.body?.description);
  ck("with an idempotency key on the account and month",
    item?.headers?.["Idempotency-Key"] === `sms-overage:acc1:${LAST.month}`, item?.headers?.["Idempotency-Key"]);
  const row = db.prepare(`SELECT * FROM sms_overage WHERE account_id='acc1'`).get();
  ck("the month is recorded as billed, with both of Stripe's references",
    row?.status === "billed" && /^ii_\d+ in_\d+$/.test(row?.processor_ref || "") && row.blocks === 2 && row.amount_cents === 10000,
    JSON.stringify(row));
  ck("and the account is told it was billed", activity(db, "sms_overage_billed").length === 1);
  ck("the billed check reads zero", runCheck(db).m070_inv_billed_unrecorded === 0);

  stripe = [];
  const again = await call(env, "/api/cron/sms-overage", { headers: { Authorization: "Bearer cron_x" } });
  ck("the next night bills nothing again", again.body.billed === 0 && again.body.already === 1 && stripe.length === 0,
    JSON.stringify(again.body));
  const panel = await call(env, "/api/billing");
  ck("and the panel shows last month's charge", panel.body.sms?.lastMonth?.amountCents === 10000
    && panel.body.sms?.lastMonth?.status === "billed", JSON.stringify(panel.body.sms?.lastMonth));

  db.exec(`UPDATE sms_overage SET processor_ref = NULL`);
  ck("and the check counts a billed month with no Stripe line behind it", runCheck(db).m070_inv_billed_unrecorded === 1);
}
{
  const db = seed({ sentLastMonth: 2500 });
  stripe = [];
  const r = await call(ENV(db), "/api/cron/sms-overage", { headers: { Authorization: "Bearer cron_x" } });
  ck("exactly the allowance bills nothing", r.body.accounts === 0 && stripe.length === 0, JSON.stringify(r.body));
}
{
  // 12,000 is three blocks, $150 -- and a yearly plan is charged the same way,
  // on the 1st, because there is one path.
  const db = seed({ sentLastMonth: 12000, billing: "annual" });
  stripe = [];
  await call(ENV(db), "/api/cron/sms-overage", { headers: { Authorization: "Bearer cron_x" } });
  const item = stripe.find((x) => /\/invoiceitems$/.test(x.url));
  const inv = stripe.find((x) => /\/invoices$/.test(x.url));
  ck("12,000 texts is $150", item?.body?.amount === "15000", item?.body?.amount);
  ck("and a yearly plan is charged on the 1st exactly as a monthly one is",
    inv?.body?.collection_method === "charge_automatically" && !("subscription" in (item?.body || {})),
    JSON.stringify(inv?.body));
}
{
  const db = seed({ sentLastMonth: 7000 });
  stripe = [];
  await call(ENV(db), "/api/cron/sms-overage", { headers: { Authorization: "Bearer cron_x" } });
  ck("7,000 texts is $100", stripe.find((x) => /\/invoiceitems$/.test(x.url))?.body?.amount === "10000");
}
{
  const db = seed({ sentLastMonth: 3000 });
  const env = ENV(db);
  stripeRefuse = "Your card was declined.";
  const r = await call(env, "/api/cron/sms-overage", { headers: { Authorization: "Bearer cron_x" } });
  const row = db.prepare(`SELECT status, error FROM sms_overage`).get();
  ck("a refusal is recorded as failed, with Stripe's words", r.body.failed === 1 && row.status === "failed"
    && /declined/.test(row.error || ""), JSON.stringify(row));
  stripe = [];
  const retry = await call(env, "/api/cron/sms-overage", { headers: { Authorization: "Bearer cron_x" } });
  ck("and the next night tries again", retry.body.billed === 1
    && db.prepare(`SELECT status FROM sms_overage`).get().status === "billed", JSON.stringify(retry.body));
}
{
  const db = seed({ plan: "basic", comped: 1, withSub: false, sentLastMonth: 3000 });
  stripe = [];
  const r = await call(ENV(db), "/api/cron/sms-overage", { headers: { Authorization: "Bearer cron_x" } });
  ck("a comped account is recorded as not billable and never charged", r.body.notBillable === 1 && stripe.length === 0
    && db.prepare(`SELECT status FROM sms_overage`).get()?.status === "not_billable", JSON.stringify(r.body));
}
{
  const r = await call(ENV(seed()), "/api/cron/sms-overage");
  ck("the sweep route wants the cron secret", r.status === 403, String(r.status));
}

console.log("\n-- migration 070 --");
{
  const db = seed();
  ck("CHECK.sql sees the table", runCheck(db).m070_sms_overage === 6, String(runCheck(db).m070_sms_overage));
  ck("and the one-row-per-month index", runCheck(db).m070_sms_overage_unique === 1);
  ck("and the switch's table", runCheck(db).m070_sms_settings === 4, String(runCheck(db).m070_sms_settings));
  ck("the migration has no ALTER TABLE, so it can be pasted twice",
    !/ALTER TABLE/.test(M070.replace(/--.*$/gm, "")));
  const old = seed({ migrate: false, sentThisMonth: 2600, sentLastMonth: 3000 });
  twilio = [];
  await invite(ENV(old));
  ck("a database without 070 still texts", twilio.length === 1, String(twilio.length));
  const r = await call(ENV(old), "/api/cron/sms-overage", { headers: { Authorization: "Bearer cron_x" } });
  ck("and the sweep names the migration rather than charging what it cannot record",
    r.body.migration === "070_sms_overage", JSON.stringify(r.body));
  const sw = await call(ENV(old), "/api/billing/sms", { method: "PUT", body: { off: true } });
  ck("and the switch names it too, rather than claiming texts are off",
    sw.status === 503 && sw.body.migration === "070_sms_overage", JSON.stringify(sw.body));
}

console.log("\n-- the marketing site quotes the same figures --");
{
  // Three records of one price -- the modules, and the pages a buyer reads --
  // and the marketing site has no build step to share a constant with. So the
  // pages are read, and a figure changed in one place and not the other fails
  // here rather than on somebody's invoice.
  const { PLATFORM_FEE_BPS, PLATFORM_FEE_CAP_CENTS } = await import("../shared/fee.js");
  const n = (x) => x.toLocaleString("en-US");
  const fee = `${PLATFORM_FEE_BPS / 100}% of each payment`;
  const cap = `never more than $${n(PLATFORM_FEE_CAP_CENTS / 100)}`;
  const sms = `${n(SMS_INCLUDED_SCALE)} a month`;
  const over = `$${SMS_BLOCK_PRICE_CENTS / 100} for every ${n(SMS_BLOCK_MESSAGES)} sent that month`;
  for (const page of ["index.html", "pricing.html"]) {
    const html = readFileSync(new URL(`../../${page}`, import.meta.url), "utf8");
    const visible = html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<!--[\s\S]*?-->/g, "");
    const ld = html.match(/FAQPage[\s\S]*?<\/script>/)?.[0] || "";
    ck(`${page}: the fee answer says ${fee}, ${cap}`, visible.includes(fee) && visible.includes(cap));
    const { PLATFORM_FEE_FREE_CENTS } = await import("../shared/fee.js");
    ck(`${page}: and that the first $${n(PLATFORM_FEE_FREE_CENTS / 100)} is free`,
      visible.includes(`Nothing on the first $${n(PLATFORM_FEE_FREE_CENTS / 100)} you send through SubSub`));
    ck(`${page}: and that the subcontractor receives the full amount`,
      /your subcontractor receives the full amount/.test(visible));
    ck(`${page}: the texts answer says ${sms}`, visible.includes(sms));
    ck(`${page}: and how going over is billed`, visible.includes(over) && /charged automatically on the 1st/.test(visible));
    ck(`${page}: with the owner's examples`, visible.includes("7,000 texts is $100, 12,000 is $150"));
    ck(`${page}: and that texts can be turned off`, /turn text messages off/.test(visible));
    ck(`${page}: and no longer the old rule`, !/each extra 5,000, or part of 5,000/.test(html) && !/following month's bill/.test(html));
    ck(`${page}: and nothing still sells a pre-bought add-on`, !/Add 5,000 more a month/.test(html));
    ck(`${page}: and both are in the structured data the crawler reads`,
      /What does SubSub charge to pay my subcontractors\?/.test(ld) && /How many text messages come with Scale\?/.test(ld));
  }
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
