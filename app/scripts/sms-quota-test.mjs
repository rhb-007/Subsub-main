// Text messages: 2,500 a month on Scale, none on Basic, and an add-on of
// 5,000 more for $50 a month. app/shared/smsquota.js holds the figures.
//
// The property worth checking is what actually LEAVES, so Twilio and Stripe
// are stubbed at `fetch` and read back: at the cap nothing reaches Twilio; the
// add-on is a line on the Scale subscription with the right price and
// quantity; and the count the screen shows is the count the refusal uses.
//
//   node --no-warnings scripts/sms-quota-test.mjs

import { readFileSync } from "node:fs";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";
import { runCheck } from "./lib/check-sql.mjs";
import { SMS_INCLUDED_SCALE, SMS_ADDON_MESSAGES, SMS_ADDON_PRICE_CENTS, SMS_UNCAPPED_KINDS,
  smsAllowance, smsVerdict, monthStart, smsUsageText } from "../shared/smsquota.js";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");
const SCHEMA = readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8");
const WORKER = readFileSync(new URL("../worker/index.js", import.meta.url), "utf8");
const M070 = readFileSync(new URL("../worker/migrations/070_sms_addon.sql", import.meta.url), "utf8");

console.log("\n-- the figures --");
{
  ck("Scale includes 2,500 a month", SMS_INCLUDED_SCALE === 2500);
  ck("an add-on is 5,000 more", SMS_ADDON_MESSAGES === 5000);
  ck("for $50 a month", SMS_ADDON_PRICE_CENTS === 5000);
  ck("Scale with nothing added is 2,500", smsAllowance({ onScale: true }) === 2500);
  ck("with two add-ons it is 12,500", smsAllowance({ onScale: true, addonBlocks: 2 }) === 12500);
  ck("Basic is none -- texts are part of Scale", smsAllowance({ onScale: false, addonBlocks: 3 }) === 0);
  ck("the last one under the cap goes", smsVerdict({ allowance: 2500, used: 2499 }).ok);
  const at = smsVerdict({ allowance: 2500, used: 2500 });
  ck("at the cap it does not", !at.ok && at.reason === "sms_quota", JSON.stringify(at));
  ck("an emergency call-out goes whatever the count",
    smsVerdict({ allowance: 2500, used: 9000, kind: "emergency_dispatch" }).ok);
  ck("and that is a named kind, not a flag anybody can pass",
    SMS_UNCAPPED_KINDS.join(",") === "emergency_dispatch");
  ck("Basic is refused by name", smsVerdict({ allowance: 0, used: 0 }).reason === "sms_not_on_plan");
  ck("the month starts on the 1st, in the shape sms_log.at sorts against",
    monthStart(new Date("2026-10-17T15:00:00Z")) === "2026-10-01");
  ck("the usage line reads in words",
    smsUsageText({ allowance: 2500, used: 1234 }) === "1,234 of 2,500 text messages used this month.");
}

// ---------------------------------------------------------------------------
// Twilio and Stripe, stubbed at fetch.
// ---------------------------------------------------------------------------
let twilio = [], stripe = [];
let sub = null;          // the subscription the Stripe stub holds
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
    const method = init.method || "POST";
    stripe.push({ url: u, method, body, headers: init.headers || {} });
    const m = u.match(/\/subscription_items\/(\w+)/);
    if (/\/subscriptions\/sub_1$/.test(u)) return json(sub);
    if (/\/subscription_items$/.test(u) && method === "POST") {
      const item = { id: "si_sms", quantity: Number(body.quantity), price: { id: body.price, recurring: { interval: "month" } } };
      sub.items.data.push(item);
      return json(item);
    }
    if (m && method === "POST") {
      const it = sub.items.data.find((i) => i.id === m[1]);
      it.quantity = Number(body.quantity);
      return json(it);
    }
    if (m && method === "DELETE") {
      sub.items.data = sub.items.data.filter((i) => i.id !== m[1]);
      return json({ id: m[1], deleted: true });
    }
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
  STRIPE_PRICE_SCALE_MONTHLY: "price_scale_m", STRIPE_PRICE_SCALE_ANNUAL: "price_scale_y",
  STRIPE_PRICE_SMS_MONTHLY: "price_sms_m", STRIPE_PRICE_SMS_ANNUAL: "price_sms_y",
  ...extra,
});

const call = async (env, path, { method = "GET", seat = { u: "u_ad", a: "acc1" }, body } = {}) => {
  const res = await worker.fetch(new Request(`https://api.subsub.work${path}`, {
    method,
    headers: { "X-User-Id": seat.u, "X-Account-Id": seat.a, "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }), env);
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

function seed({ plan = "scale", comped = 0, sentThisMonth = 0, sentLastMonth = 0, failedThisMonth = 0,
                blocks = 0, withSub = true } = {}) {
  const db = freshDb({ base: SCHEMA, migrations: [M070] });
  db.exec(`
    INSERT INTO accounts(id,name,subdomain,kind,plan,comped,billing,stripe_customer_id,stripe_subscription_id,sms_addon_blocks)
      VALUES ('acc1','Outerhome','outerhome','general_contractor','${plan}',${comped},'monthly','cus_1',
              ${withSub ? "'sub_1'" : "NULL"},${blocks});
    INSERT INTO users(id,name,email) VALUES ('u_ad','Rae','rae@outerhome.test');
    INSERT INTO users(id,name,email,phone) VALUES ('u_pm','Sam','sam@outerhome.test','(206) 555-0111');
    INSERT INTO memberships(id,user_id,account_id,role) VALUES
      ('m_ad','u_ad','acc1','admin'), ('m_pm','u_pm','acc1','pm');
  `);
  // Rows, in bulk. Dated by month so "this month" and "last month" are real.
  const thisMonth = `${monthStart()} 09:00:00`;
  const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1);
  const lastMonth = `${d.toISOString().slice(0, 7)}-15 09:00:00`;
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

console.log("\n-- the cap, on what actually reaches Twilio --");
{
  const db = seed({ sentThisMonth: 2499 });
  const env = ENV(db);
  twilio = [];
  const r = await invite(env);
  ck("the 2,500th text of the month goes", twilio.length === 1 && r.body.texted === true,
    `${twilio.length} ${JSON.stringify(r.body)}`);
  ck("and is logged as sent", lastLog(db)?.status === "sent", JSON.stringify(lastLog(db)));
  twilio = [];
  const r2 = await invite(env);
  ck("the 2,501st does not reach Twilio", twilio.length === 0, String(twilio.length));
  ck("and the invite says it was not texted", r2.body.texted === false, JSON.stringify(r2.body));
  const l = lastLog(db);
  ck("it is logged, with the reason, as not sent",
    l?.status === "failed" && /^sms_quota/.test(l?.error || ""), JSON.stringify(l));
  ck("and a refusal does not count against the month",
    db.prepare(`SELECT COUNT(*) n FROM sms_log WHERE status='sent' AND account_id='acc1'`).get().n === 2500);
}
{
  const db = seed({ sentLastMonth: 3000 });
  twilio = [];
  await invite(ENV(db));
  ck("last month's texts do not count against this one", twilio.length === 1, String(twilio.length));
}
{
  const db = seed({ sentThisMonth: 2400, failedThisMonth: 500 });
  twilio = [];
  await invite(ENV(db));
  ck("failed texts do not count either", twilio.length === 1, String(twilio.length));
}
{
  const db = seed({ sentThisMonth: 2500, blocks: 1 });
  twilio = [];
  await invite(ENV(db));
  ck("an add-on lifts the cap by 5,000", twilio.length === 1, String(twilio.length));
}
{
  const db = seed({ plan: "basic" });
  twilio = [];
  const r = await invite(ENV(db));
  ck("Basic texts nobody", twilio.length === 0, String(twilio.length));
  ck("and the reason is that texts are Scale", /^sms_not_on_plan/.test(lastLog(db)?.error || ""),
    JSON.stringify(lastLog(db)));
  ck("while the email still goes", r.body.invited === true && r.body.emailed === true, JSON.stringify(r.body));
}
{
  const db = seed({ plan: "basic", comped: 1 });
  twilio = [];
  await invite(ENV(db));
  ck("a comped account is on Scale for texts too", twilio.length === 1, String(twilio.length));
}

console.log("\n-- every text goes through the one door --");
{
  // A quota checked at six of seven call sites is a quota with a door round
  // it. The one raw send is inside sendAccountSms itself.
  const raw = (WORKER.match(/\bsendSms\(/g) || []).length;
  ck("sendSms is called in exactly one place", raw === 1, String(raw));
  const fn = WORKER.slice(WORKER.indexOf("async function sendAccountSms"));
  ck("and that place is the quota-checking door",
    /async function sendAccountSms[\s\S]{0,2000}await sendSms\(env/.test(fn.slice(0, 2200)));
  ck("the emergency call-out goes through it as the uncapped kind",
    /kind: "emergency_dispatch", body: line\.slice\(0, 300\)/.test(WORKER));
  ck("which means it is logged now, where it never was", /sendAccountSms\(c\.env, \{ accountId, companyId, to: co\.phone,/.test(WORKER));
}

console.log("\n-- the billing panel reads the same count --");
{
  const db = seed({ sentThisMonth: 1234 });
  const r = await call(ENV(db), "/api/billing");
  const s = r.body.sms || {};
  ck("it says how many are used", s.used === 1234, JSON.stringify(s));
  ck("out of what is allowed", s.allowance === 2500 && s.included === 2500, JSON.stringify(s));
  ck("and that an add-on can be bought here", s.addonAvailable === true, JSON.stringify(s));
  const comped = seed({ plan: "basic", comped: 1, withSub: false });
  const rc = await call(ENV(comped), "/api/billing");
  ck("a comped account with no subscription is not offered a button that cannot work",
    rc.body.sms?.addonAvailable === false && rc.body.sms?.allowance === 2500, JSON.stringify(rc.body.sms));
  const noPrice = await call(ENV(seed(), { STRIPE_PRICE_SMS_MONTHLY: "" }), "/api/billing");
  ck("nor is one with no add-on price configured", noPrice.body.sms?.addonAvailable === false);
}

console.log("\n-- buying the add-on: a line on the Scale subscription --");
{
  const db = seed();
  const env = ENV(db);
  sub = { id: "sub_1", customer: "cus_1", status: "active", metadata: { account_id: "acc1" },
    items: { data: [{ id: "si_plan", quantity: 1, current_period_end: 1893456000,
      price: { id: "price_scale_m", recurring: { interval: "month" } } }] } };
  stripe = [];
  const r = await call(env, "/api/billing/sms-addon", { method: "POST", body: { blocks: 1 } });
  ck("it is bought", r.status === 200 && r.body.addonBlocks === 1 && r.body.allowance === 7500,
    `${r.status} ${JSON.stringify(r.body)}`);
  const add = stripe.find((x) => /\/subscription_items$/.test(x.url));
  ck("as a subscription item, not a second subscription", !!add && !stripe.some((x) => /\/subscriptions$/.test(x.url)),
    stripe.map((x) => x.method + " " + x.url).join(", "));
  ck("on THIS subscription", add?.body?.subscription === "sub_1", JSON.stringify(add?.body));
  ck("at the monthly add-on price", add?.body?.price === "price_sms_m", add?.body?.price);
  ck("quantity one", add?.body?.quantity === "1", add?.body?.quantity);
  ck("with an idempotency key, so a double press is one purchase",
    /^sms-addon:acc1:1:/.test(add?.headers?.["Idempotency-Key"] || ""), add?.headers?.["Idempotency-Key"]);
  ck("and the count is written", db.prepare(`SELECT sms_addon_blocks b FROM accounts WHERE id='acc1'`).get().b === 1);
  const row = db.prepare(`SELECT plan, billing FROM accounts WHERE id='acc1'`).get();
  ck("the plan is read off the PLAN's line, not the add-on's", row.plan === "scale" && row.billing === "monthly",
    JSON.stringify(row));

  stripe = [];
  const two = await call(env, "/api/billing/sms-addon", { method: "POST", body: { blocks: 2 } });
  const upd = stripe.find((x) => /\/subscription_items\/si_sms$/.test(x.url) && x.method === "POST");
  ck("a second one updates the quantity rather than adding a line",
    two.status === 200 && upd?.body?.quantity === "2" && sub.items.data.length === 2, JSON.stringify(two.body));

  stripe = [];
  const none = await call(env, "/api/billing/sms-addon", { method: "POST", body: { blocks: 0 } });
  ck("removing them deletes the line", none.status === 200 && none.body.addonBlocks === 0
    && stripe.some((x) => x.method === "DELETE" && /si_sms$/.test(x.url)), JSON.stringify(none.body));
  ck("and the plan line is untouched", sub.items.data.length === 1 && sub.items.data[0].id === "si_plan");

  const bad = await call(env, "/api/billing/sms-addon", { method: "POST", body: { blocks: -1 } });
  ck("a negative count is refused", bad.status === 400 && bad.body.error === "bad_blocks");
  const pm = await call(env, "/api/billing/sms-addon", { method: "POST", body: { blocks: 1 },
    seat: { u: "u_pm", a: "acc1" } });
  ck("a project manager cannot buy one", pm.status === 403, String(pm.status));
}
{
  const db = seed({ plan: "basic" });
  stripe = [];
  const r = await call(ENV(db), "/api/billing/sms-addon", { method: "POST", body: { blocks: 1 } });
  ck("Basic cannot buy texts", r.status === 403 && r.body.error === "scale_required", JSON.stringify(r.body));
  ck("and Stripe is never asked", stripe.length === 0);
}
{
  const db = seed({ plan: "basic", comped: 1, withSub: false });
  const r = await call(ENV(db), "/api/billing/sms-addon", { method: "POST", body: { blocks: 1 } });
  ck("a comped account with no subscription is told so", r.status === 409 && r.body.error === "no_subscription",
    JSON.stringify(r.body));
}
{
  const db = seed();
  db.exec(`UPDATE accounts SET billing = 'annual' WHERE id = 'acc1'`);
  sub = { id: "sub_1", customer: "cus_1", status: "active", metadata: { account_id: "acc1" },
    items: { data: [{ id: "si_plan", quantity: 1, price: { id: "price_scale_y", recurring: { interval: "year" } } }] } };
  stripe = [];
  await call(ENV(db), "/api/billing/sms-addon", { method: "POST", body: { blocks: 1 } });
  const add = stripe.find((x) => /\/subscription_items$/.test(x.url));
  ck("an annual subscription takes the yearly add-on price, or Stripe refuses mixed intervals",
    add?.body?.price === "price_sms_y", add?.body?.price);
}

console.log("\n-- the webhook keeps the count, and a downgrade takes it away --");
{
  const db = seed();
  const env = ENV(db, { STRIPE_WEBHOOK_SECRET: "whsec_x" });
  const payload = { id: "evt_1", type: "customer.subscription.updated", data: { object: {
    id: "sub_1", customer: "cus_1", status: "active", metadata: { account_id: "acc1" },
    items: { data: [
      // The add-on FIRST, which is the order that would have been read as the
      // plan by the old `items.data[0]`.
      { id: "si_sms", quantity: 3, price: { id: "price_sms_m", recurring: { interval: "month" } } },
      { id: "si_plan", quantity: 1, price: { id: "price_scale_y", recurring: { interval: "year" } } },
    ] } } } };
  const raw = JSON.stringify(payload);
  const t = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("whsec_x"),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${raw}`));
  const hex = Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
  const res = await worker.fetch(new Request("https://api.subsub.work/api/stripe/webhook", {
    method: "POST", headers: { "stripe-signature": `t=${t},v1=${hex}` }, body: raw }), env);
  ck("the webhook is accepted", res.status === 200, String(res.status));
  const row = db.prepare(`SELECT sms_addon_blocks b, billing FROM accounts WHERE id='acc1'`).get();
  ck("it writes the add-on quantity", row.b === 3, JSON.stringify(row));
  ck("and reads the cycle off the plan's line, wherever it sits", row.billing === "annual", JSON.stringify(row));
}

console.log("\n-- migration 070 --");
{
  const db = seed();
  ck("CHECK.sql sees the column", runCheck(db).m070_sms_addon === 1, String(runCheck(db).m070_sms_addon));
  ck("the migration is one ALTER, a paste of its own",
    (M070.replace(/--.*$/gm, "").match(/ALTER TABLE/g) || []).length === 1);
  const old = freshDb({ base: SCHEMA, migrations: [] });
  old.exec(`ALTER TABLE accounts DROP COLUMN sms_addon_blocks`);
  old.exec(`INSERT INTO accounts(id,name,subdomain,kind,plan,billing,stripe_subscription_id)
              VALUES ('acc1','Outerhome','outerhome','general_contractor','scale','monthly','sub_1');
            INSERT INTO users(id,name,email) VALUES ('u_ad','Rae','rae@outerhome.test');
            INSERT INTO users(id,name,email,phone) VALUES ('u_pm','Sam','sam@outerhome.test','(206) 555-0111');
            INSERT INTO memberships(id,user_id,account_id,role) VALUES ('m_ad','u_ad','acc1','admin'),('m_pm','u_pm','acc1','pm');`);
  twilio = [];
  await invite(ENV(old));
  ck("a database without 070 still texts, on the included allowance", twilio.length === 1, String(twilio.length));
  const r = await call(ENV(old), "/api/billing/sms-addon", { method: "POST", body: { blocks: 1 } });
  ck("and buying an add-on names the migration rather than charging for it",
    r.status === 503 && r.body.migration === "070_sms_addon", `${r.status} ${JSON.stringify(r.body)}`);
}

console.log("\n-- the marketing site quotes the same figures --");
{
  // Three records of one price -- this module, the fee module, and the pages
  // a buyer reads -- and the marketing site has no build step to share a
  // constant with. So the pages are read, and a figure changed in one place
  // and not the other fails here rather than on somebody's invoice.
  const { PLATFORM_FEE_BPS, PLATFORM_FEE_CAP_CENTS } = await import("../shared/fee.js");
  const n = (x) => x.toLocaleString("en-US");
  const fee = `${PLATFORM_FEE_BPS / 100}% of each payment`;
  const cap = `never more than $${n(PLATFORM_FEE_CAP_CENTS / 100)}`;
  const sms = `${n(SMS_INCLUDED_SCALE)} a month`;
  const addon = `Add ${n(SMS_ADDON_MESSAGES)} more a month for $${SMS_ADDON_PRICE_CENTS / 100} a month`;
  for (const page of ["index.html", "pricing.html"]) {
    const html = readFileSync(new URL(`../../${page}`, import.meta.url), "utf8");
    const visible = html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<!--[\s\S]*?-->/g, "");
    ck(`${page}: the fee answer says ${fee}, ${cap}`, visible.includes(fee) && visible.includes(cap));
    ck(`${page}: and that the subcontractor receives the full amount`,
      /your subcontractor receives the full amount/.test(visible));
    ck(`${page}: the texts answer says ${sms}`, visible.includes(sms));
    ck(`${page}: and the add-on`, visible.includes(addon));
    ck(`${page}: and both are in the structured data the crawler reads`,
      /What does SubSub charge to pay my subcontractors\?/.test(html.match(/FAQPage[\s\S]*?<\/script>/)?.[0] || "")
      && /How many text messages come with Scale\?/.test(html.match(/FAQPage[\s\S]*?<\/script>/)?.[0] || ""));
  }
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
