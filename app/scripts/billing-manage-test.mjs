// Managing the subscription without leaving SubSub.
//
// Stripe's billing portal is hosted-only, so "Manage billing" handed
// somebody to stripe.com in the middle of their own account screen. What the
// portal does is the card, the invoices and cancelling; cancelling was
// already here. These are the other two.
//
// The property that matters most is on card-confirm, because it is the route
// that decides which card an account gets charged on:
//
//   IT READS THE SETUP INTENT BACK FROM STRIPE. A payment method id sent by
//   the browser and trusted would point this account's billing at any card
//   whose id somebody could name.
//
//   AND IT SETS BOTH. The customer's default and the subscription's are two
//   settings; changing only the first leaves the next invoice on the old
//   card -- a card somebody believes they have replaced, failing a month
//   later.
//
//   node --no-warnings scripts/billing-manage-test.mjs

import { readFileSync } from "node:fs";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");
const SCHEMA = readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8");

const seed = () => {
  const db = freshDb({ base: SCHEMA, migrations: [] });
  db.exec(`
    INSERT INTO accounts(id,name,subdomain,kind,plan,stripe_customer_id,stripe_subscription_id)
      VALUES ('acc_gc','Outerhome','outerhome','general_contractor','scale','cus_1','sub_1'),
             ('acc_new','Fresh','fresh','general_contractor','basic',NULL,NULL);
    INSERT INTO users(id,name,email) VALUES ('u_ad','Rae','rae@outerhome.test'),('u_pm','Sam','sam@outerhome.test');
    INSERT INTO memberships(id,user_id,account_id,role) VALUES
      ('m_ad','u_ad','acc_gc','admin'), ('m_pm','u_pm','acc_gc','pm'),
      ('m_new','u_ad','acc_new','admin');
  `);
  return db;
};

const realFetch = globalThis.fetch;
let calls = [];
let si = null;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (!u.includes("stripe")) return realFetch(url, init);
  const body = Object.fromEntries(new URLSearchParams(init.body || ""));
  calls.push({ url: u, method: init.method || "POST", body });
  const json = (o, s = 200) => new Response(JSON.stringify(o),
    { status: s, headers: { "Content-Type": "application/json" } });

  if (/\/customers\/cus_1$/.test(u) && (init.method || "POST") === "GET") {
    return json({ id: "cus_1", invoice_settings: { default_payment_method: "pm_old" } });
  }
  if (/\/customers\/cus_1$/.test(u)) return json({ id: "cus_1" });
  if (/\/payment_methods\/pm_old$/.test(u)) {
    return json({ id: "pm_old", card: { brand: "visa", last4: "4242", exp_month: 4, exp_year: 2029 } });
  }
  if (/\/setup_intents$/.test(u) && (init.method || "POST") === "POST") {
    return json({ id: "seti_new", client_secret: "seti_new_secret_x" });
  }
  if (/\/setup_intents\/seti_/.test(u)) return json(si);
  if (/\/subscriptions\/sub_1$/.test(u)) return json({ id: "sub_1" });
  if (/\/invoices\?/.test(u)) {
    return json({ data: [
      { id: "in_1", number: "A-1", created: 1780000000, total: 9900, currency: "usd",
        status: "paid", invoice_pdf: "https://files.stripe.test/in_1.pdf" },
      { id: "in_2", number: "A-2", created: 1777400000, total: 9900, currency: "usd",
        status: "open", invoice_pdf: null },
    ] });
  }
  return json({ error: { message: "stub has no route for " + u } }, 404);
};

const ENV = (db) => ({ DB: makeD1(db), STRIPE_SECRET_KEY: "sk_test_x" });
const call = async (env, path, { method = "GET", seat = { u: "u_ad", a: "acc_gc" }, body } = {}) => {
  const res = await worker.fetch(new Request(`https://api.subsub.work${path}`, {
    method,
    headers: { "X-User-Id": seat.u, "X-Account-Id": seat.a, "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }), env);
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

// ---- what is on file ------------------------------------------------------
{
  console.log("\n-- the card, named rather than gestured at --");
  const env = ENV(seed());
  const r = await call(env, "/api/billing/card");
  ck("it says which card, in four digits",
    r.status === 200 && r.body.card?.last4 === "4242" && r.body.card?.brand === "visa",
    JSON.stringify(r.body.card));
  ck("and when it expires", r.body.card?.expMonth === 4 && r.body.card?.expYear === 2029);
  // Four digits and an expiry is what somebody needs to recognise their own
  // card. Anything else about it is not ours to hold or to show.
  ck("and nothing else about it",
    Object.keys(r.body.card || {}).sort().join(",") === "brand,expMonth,expYear,last4",
    Object.keys(r.body.card || {}).join(","));

  const none = await call(env, "/api/billing/card", { seat: { u: "u_ad", a: "acc_new" } });
  ck("an account with no customer has no card rather than an error",
    none.status === 200 && none.body.card === null, `${none.status} ${JSON.stringify(none.body)}`);

  const pm = await call(env, "/api/billing/card", { seat: { u: "u_pm", a: "acc_gc" } });
  ck("and a project manager cannot read it", pm.status === 403, String(pm.status));
}

// ---- changing it ----------------------------------------------------------
{
  console.log("\n-- changing it happens in the browser, against Stripe --");
  const env = ENV(seed());
  calls = [];
  const setup = await call(env, "/api/billing/card-setup", { method: "POST" });
  ck("it hands back a client secret and nothing else",
    setup.status === 200 && setup.body.clientSecret === "seti_new_secret_x"
    && Object.keys(setup.body).join(",") === "clientSecret",
    JSON.stringify(setup.body));
  const made = calls.find((x) => /\/setup_intents$/.test(x.url));
  ck("scoped to this account's customer", made?.body.customer === "cus_1", made?.body.customer);
  ck("and kept for a charge nobody will be present for",
    made?.body.usage === "off_session", made?.body.usage);

  const noCust = await call(env, "/api/billing/card-setup",
    { method: "POST", seat: { u: "u_ad", a: "acc_new" } });
  ck("an account with nothing to bill is told so",
    noCust.status === 409 && noCust.body.error === "no_subscription",
    `${noCust.status} ${noCust.body.error}`);
}

// ---- and the one that decides what gets charged ---------------------------
{
  console.log("\n-- confirming, which is the route worth guarding --");
  const env = ENV(seed());

  si = { id: "seti_new", customer: "cus_1", status: "succeeded", payment_method: "pm_new" };
  calls = [];
  const ok = await call(env, "/api/billing/card-confirm",
    { method: "POST", body: { setupIntentId: "seti_new" } });
  ck("a confirmed one is accepted", ok.status === 200 && ok.body.ok === true,
    `${ok.status} ${JSON.stringify(ok.body)}`);
  const cust = calls.find((x) => /\/customers\/cus_1$/.test(x.url) && x.method !== "GET");
  ck("the customer's default is pointed at the new card",
    cust?.body["invoice_settings[default_payment_method]"] === "pm_new",
    cust?.body["invoice_settings[default_payment_method]"]);
  // Both, because they are two settings. Only the first leaves the next
  // invoice on the old card -- one somebody believes they have replaced.
  const sub = calls.find((x) => /\/subscriptions\/sub_1$/.test(x.url));
  ck("and so is the subscription's",
    sub?.body.default_payment_method === "pm_new", sub?.body.default_payment_method);

  // The whole reason it reads the intent back rather than taking a payment
  // method id from the browser.
  si = { id: "seti_other", customer: "cus_SOMEBODY_ELSE", status: "succeeded", payment_method: "pm_theirs" };
  calls = [];
  const theirs = await call(env, "/api/billing/card-confirm",
    { method: "POST", body: { setupIntentId: "seti_other" } });
  ck("somebody else's setup intent is refused",
    theirs.status === 404 && theirs.body.error === "not_found",
    `${theirs.status} ${theirs.body.error}`);
  ck("and nothing was pointed anywhere",
    !calls.some((x) => x.body["invoice_settings[default_payment_method]"]));

  si = { id: "seti_new", customer: "cus_1", status: "requires_payment_method", payment_method: null };
  const unfinished = await call(env, "/api/billing/card-confirm",
    { method: "POST", body: { setupIntentId: "seti_new" } });
  ck("an unfinished one is refused",
    unfinished.status === 409 && unfinished.body.error === "not_confirmed",
    `${unfinished.status} ${unfinished.body.error}`);

  const junk = await call(env, "/api/billing/card-confirm",
    { method: "POST", body: { setupIntentId: "pm_1234" } });
  ck("and something that is not a setup intent never reaches Stripe",
    junk.status === 400 && junk.body.error === "bad_setup_intent",
    `${junk.status} ${junk.body.error}`);
}

// ---- invoices -------------------------------------------------------------
{
  console.log("\n-- and what they have been charged --");
  const env = ENV(seed());
  const r = await call(env, "/api/billing/invoices");
  ck("they are listed here rather than somewhere else",
    r.status === 200 && (r.body.invoices || []).length === 2,
    `${r.status} ${(r.body.invoices || []).length}`);
  const one = (r.body.invoices || [])[0];
  ck("with a date, an amount and whether it was paid",
    one?.created?.startsWith("20") && one?.total === 9900 && one?.status === "paid",
    JSON.stringify(one));
  ck("and the PDF when there is one", one?.pdf === "https://files.stripe.test/in_1.pdf");
  ck("an open one carries no PDF rather than a dead link",
    (r.body.invoices || [])[1]?.pdf === null);

  const none = await call(env, "/api/billing/invoices", { seat: { u: "u_ad", a: "acc_new" } });
  ck("an account with no customer has an empty list, not an error",
    none.status === 200 && Array.isArray(none.body.invoices) && none.body.invoices.length === 0);
}

// ---- not configured -------------------------------------------------------
{
  console.log("\n-- and with no Stripe key at all --");
  const env = { DB: makeD1(seed()) };
  for (const [path, method] of [["/api/billing/card", "GET"],
    ["/api/billing/card-setup", "POST"], ["/api/billing/invoices", "GET"]]) {
    const r = await call(env, path, { method });
    ck(`${path} is 501 rather than a crash`,
      r.status === 501 && r.body.error === "billing_not_configured", `${r.status} ${r.body.error}`);
  }
}

globalThis.fetch = realFetch;
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
