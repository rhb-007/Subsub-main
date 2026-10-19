// Per-unit pricing for accounts that keep buildings (084).
//
// A property manager, a portfolio manager and a building owner pay the flat
// $99 until their buildings hold more than 80 units. Past that it is $1.25 per
// OCCUPIED unit a month, never less than $99, monthly only, plus a one-time
// setup fee by portfolio size. These are the properties that hold it:
//
//   The rule is one module, and the checkout, the sync and the billing read
//   all answer from it. A blank occupied count is billed as full.
//
//   The setup fee is charged ONCE: at checkout when it is a new subscription,
//   as an invoice item when an existing subscriber crosses 80, and never
//   twice -- including when a building is saved before the checkout webhook.
//
//   Yearly is refused past 80 units, and a yearly subscriber is left alone.
//
//   node --no-warnings scripts/unit-pricing-test.mjs

import { readFileSync } from "node:fs";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";
import { runCheck, checkStatements } from "./lib/check-sql.mjs";
import { unitPricing, setupTierFor, portfolioUnits, unitTermsText, UNIT_THRESHOLD,
  UNIT_PRICE_CENTS, MIN_MONTHLY_CENTS, SETUP_TIERS, yearlyAllowed, effectiveBilling } from "../shared/unitpricing.js";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");
const SCHEMA = readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8");

// ---- the rule -------------------------------------------------------------
{
  console.log("\n-- the rule --");
  const b = (units, occ) => ({ units, occupiedUnits: occ });
  ck("the threshold is 80, the unit price $1.25 and the minimum $99",
    UNIT_THRESHOLD === 80 && UNIT_PRICE_CENTS === 125 && MIN_MONTHLY_CENTS === 9900);
  ck("80 units is still the flat price", !unitPricing("property_manager", [b(80, 80)]).applies);
  const u81 = unitPricing("property_manager", [b(81, 81)]);
  ck("81 is per unit", u81.applies && u81.monthlyCents === 10125, JSON.stringify(u81));
  const low = unitPricing("property_manager", [b(100, 60)]);
  ck("never less than $99: 60 occupied is the minimum on the flat line",
    low.applies && low.monthlyCents === 9900 && low.line.kind === "flat" && low.line.quantity === 1,
    JSON.stringify(low));
  const big = unitPricing("portfolio_manager", [b(300, 250), b(100, null)]);
  ck("a blank occupied count is billed as full, and counted as unknown",
    big.total === 400 && big.occupied === 350 && big.unknown === 1 && big.line.kind === "unit"
    && big.line.quantity === 350 && big.monthlyCents === 350 * 125, JSON.stringify(big));
  ck("an occupied count over the units is capped at the units in the rule",
    portfolioUnits([b(10, 50)]).occupied === 10);
  ck("a general contractor is never per unit",
    !unitPricing("general_contractor", [b(500, 500)]).eligible
    && !unitPricing("general_contractor", [b(500, 500)]).applies);
  ck("a building owner is", unitPricing("building_owner", [b(90, 90)]).applies);
  ck("a unit-priced kind is never yearly, at any size",
    !unitPricing("property_manager", [b(80, 80)]).annualAllowed
    && !unitPricing("property_manager", [b(81, 81)]).annualAllowed);
  ck("a general contractor still may be", unitPricing("general_contractor", [b(500, 500)]).annualAllowed
    && yearlyAllowed("general_contractor") && !yearlyAllowed("building_owner"));
  ck("a stored year with nothing paid behind it reads as monthly",
    effectiveBilling({ kind: "property_manager", billing: "annual" }) === "monthly");
  ck("a yearly subscription really running keeps its year",
    effectiveBilling({ kind: "property_manager", billing: "annual", stripe_subscription_id: "sub_1" }) === "annual");
  ck("a general contractor's year is its year", effectiveBilling({ kind: "general_contractor", billing: "annual" }) === "annual");
  const tiers = [[81, 25000], [250, 25000], [251, 50000], [500, 50000], [501, 100000],
    [1000, 100000], [1001, 200000], [5000, 200000]];
  ck("each setup step doubles: $250, $500, $1,000, $2,000",
    tiers.every(([n, c]) => setupTierFor(n).cents === c),
    tiers.map(([n]) => `${n}:${setupTierFor(n).cents}`).join(" "));
  ck("the steps are the four asked for",
    SETUP_TIERS.map((t) => t.cents).join(",") === "25000,50000,100000,200000");
  ck("no setup fee at 80 or fewer", unitPricing("property_manager", [b(80, 80)]).setupCents === 0);
  const t = unitTermsText();
  ck("the words carry the figures", /\$1\.25 per occupied unit/.test(t.perUnit) && /\$99/.test(t.perUnit)
    && /\$250 for up to 250/.test(t.setup) && /\$2,000 above 1,000/.test(t.setup), JSON.stringify(t));
}

// ---- a stubbed Stripe ----------------------------------------------------
const realFetch = globalThis.fetch;
let calls = [];
let subState = {};   // sub id -> { item: {...}, metadata, interval }
let invoiceItems = 0;
const json = (o, s = 200) => new Response(JSON.stringify(o),
  { status: s, headers: { "Content-Type": "application/json" } });
const subObj = (id) => {
  const s = subState[id];
  return { id, status: "active", customer: s.customer, metadata: s.metadata || {},
    items: { data: [{ id: `si_${id}`, quantity: s.item.quantity,
      price: { id: s.item.priceId || `price_dyn_${id}`, unit_amount: s.item.unitAmount,
        recurring: { interval: s.interval || "month" } } }] } };
};
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (!u.includes("stripe")) return realFetch(url, init);
  const method = init.method || "POST";
  const body = Object.fromEntries(new URLSearchParams(init.body || ""));
  calls.push({ url: u, method, body, key: init.headers?.["Idempotency-Key"] || null });
  if (/\/prices\/price_monthly$/.test(u)) return json({ id: "price_monthly", product: "prod_scale" });
  let m = u.match(/\/subscriptions\/(sub_[a-z0-9_]+)$/);
  if (m && method === "GET") return subState[m[1]] ? json(subObj(m[1])) : json({ error: { message: "no sub" } }, 404);
  m = u.match(/\/subscription_items\/si_(sub_[a-z0-9_]+)$/);
  if (m) {
    const s = subState[m[1]];
    if (body.price) s.item = { priceId: body.price, unitAmount: 9900, quantity: Number(body.quantity) };
    else s.item = { priceId: null, unitAmount: Number(body["price_data[unit_amount]"]), quantity: Number(body.quantity) };
    return json({ id: `si_${m[1]}` });
  }
  if (/\/invoiceitems$/.test(u)) { invoiceItems += 1; return json({ id: `ii_${invoiceItems}` }); }
  if (/\/checkout\/sessions$/.test(u)) return json({ id: "cs_1", url: "https://checkout.stripe.test/cs_1" });
  return json({ error: { message: "stub has no route for " + u } }, 404);
};

const seed = ({ migrated = true } = {}) => {
  const db = freshDb({ base: SCHEMA, migrations: [] });
  if (!migrated) {
    db.exec(`ALTER TABLE properties DROP COLUMN occupied_units; DROP TABLE account_setup_fees;`);
  }
  db.exec(`
    INSERT INTO accounts(id,name,subdomain,kind,plan,billing,stripe_customer_id,stripe_subscription_id,subscription_status)
      VALUES ('acc_pm','Sound PM','sound','property_manager','scale','monthly','cus_pm','sub_pm','active'),
             ('acc_new','New PM','newpm','property_manager','basic','monthly',NULL,NULL,NULL),
             ('acc_yr','Year PM','yearpm','portfolio_manager','scale','annual','cus_yr','sub_yr','active'),
             ('acc_gc','Outerhome','outerhome','general_contractor','basic','monthly',NULL,NULL,NULL);
    INSERT INTO users(id,name,email) VALUES ('u_pm','Rae','rae@sound.test'),('u_new','Ned','ned@new.test'),
      ('u_yr','Yan','yan@year.test'),('u_gc','Gus','gus@outer.test');
    INSERT INTO memberships(id,user_id,account_id,role) VALUES
      ('m1','u_pm','acc_pm','admin'),('m2','u_new','acc_new','admin'),('m3','u_yr','acc_yr','admin'),
      ('m4','u_gc','acc_gc','admin');
    INSERT INTO properties(id,account_id,name,units,owner_account_id) VALUES
      ('p_pm1','acc_pm','Ballard Apts',60,'acc_pm'),
      ('p_new1','acc_new','Press Apts',100,'acc_new'),
      ('p_yr1','acc_yr','Tower',300,'acc_yr'),
      ('p_gc1','acc_gc','Shop',500,'acc_gc');
  `);
  if (migrated) db.exec(`UPDATE properties SET occupied_units = 90 WHERE id = 'p_new1';`);
  subState = {
    sub_pm: { customer: "cus_pm", item: { priceId: "price_monthly", unitAmount: 9900, quantity: 1 } },
    sub_yr: { customer: "cus_yr", interval: "year", item: { priceId: "price_annual", unitAmount: 99000, quantity: 1 } },
  };
  calls = []; invoiceItems = 0;
  return db;
};
const ENV = (db) => ({ DB: makeD1(db), STRIPE_SECRET_KEY: "sk_test_x", STRIPE_PRICE_SCALE_MONTHLY: "price_monthly",
  STRIPE_PRICE_SCALE_ANNUAL: "price_annual", STRIPE_WEBHOOK_SECRET: "whsec_x", CRON_SECRET: "cron_x" });
const call = async (env, path, { method = "GET", seat = ["u_pm", "acc_pm"], body, bearer } = {}) => {
  const res = await worker.fetch(new Request(`https://api.subsub.work${path}`, {
    method,
    headers: { "Content-Type": "application/json",
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : { "X-User-Id": seat[0], "X-Account-Id": seat[1] }) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }), env);
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
async function hook(env, payload) {
  const raw = JSON.stringify(payload);
  const t = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("whsec_x"),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${raw}`));
  const hex = Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
  const res = await worker.fetch(new Request("https://api.subsub.work/api/stripe/webhook", {
    method: "POST", headers: { "stripe-signature": `t=${t},v1=${hex}`, "Content-Type": "application/json" }, body: raw,
  }), env);
  return res.status;
}

// ---- the occupied count on a building -------------------------------------
{
  console.log("\n-- a building's occupied count --");
  const db = seed(); const env = ENV(db);
  const over = await call(env, "/api/properties", { method: "POST", body: { name: "A", units: 10, occupiedUnits: 11 } });
  ck("more occupied than units is refused by name", over.status === 400 && over.body.error === "occupied_over_units",
    `${over.status} ${JSON.stringify(over.body)}`);
  const frac = await call(env, "/api/properties", { method: "POST", body: { name: "A", units: 10, occupiedUnits: 2.5 } });
  ck("and a fraction", frac.status === 400 && frac.body.error === "bad_occupied_units");
  const ok = await call(env, "/api/properties", { method: "POST", body: { name: "B", units: 10, occupiedUnits: 8 } });
  const row = db.prepare(`SELECT occupied_units FROM properties WHERE id = ?`).get(ok.body.id);
  ck("a good one is stored", ok.status === 201 && row?.occupied_units === 8, JSON.stringify(row));
  const list = await call(env, "/api/properties");
  ck("and read back", list.body.find((p) => p.id === ok.body.id)?.occupiedUnits === 8);
  ck("a building with none reads blank", list.body.find((p) => p.id === "p_pm1")?.occupiedUnits === "");
  const lower = await call(env, `/api/properties/${ok.body.id}`, { method: "PATCH", body: { units: 5 } });
  ck("lowering the units below what is occupied is refused too",
    lower.status === 400 && lower.body.error === "occupied_over_units", `${lower.status} ${JSON.stringify(lower.body)}`);
  const clear = await call(env, `/api/properties/${ok.body.id}`, { method: "PATCH", body: { occupiedUnits: "" } });
  ck("clearing it stores NULL", clear.status === 200
    && db.prepare(`SELECT occupied_units FROM properties WHERE id = ?`).get(ok.body.id).occupied_units === null);
  const bothDown = await call(env, `/api/properties/${ok.body.id}`, { method: "PATCH", body: { units: 4, occupiedUnits: 4 } });
  ck("lowering both together is fine", bothDown.status === 200, JSON.stringify(bothDown.body));

  const old = seed({ migrated: false }); const envOld = ENV(old);
  const r = await call(envOld, "/api/properties", { method: "POST", body: { name: "C", units: 10, occupiedUnits: 8 } });
  ck("a database without 084 still adds the building, and says the count was not kept",
    r.status === 201 && r.body.occupiedRecorded === false && r.body.migration === "084_unit_pricing",
    `${r.status} ${JSON.stringify(r.body)}`);
  const lst = await call(envOld, "/api/properties");
  ck("and the list still reads", lst.status === 200 && lst.body.some((p) => p.name === "C"));
  const bill = await call(envOld, "/api/billing");
  ck("and the billing read counts every unit as occupied", bill.status === 200 && bill.body.units?.migrated === false,
    JSON.stringify(bill.body.units));
}

// ---- what the billing panel reads -----------------------------------------
{
  console.log("\n-- the billing read --");
  const db = seed(); const env = ENV(db);
  const r = await call(env, "/api/billing", { seat: ["u_new", "acc_new"] });
  const u = r.body.units;
  ck("a portfolio past 80 is per unit, with its own numbers",
    u?.applies && u.total === 100 && u.occupied === 90 && u.monthlyCents === 11250 && u.setupCents === 25000
    && u.annualAllowed === false && u.setupCharged === null, JSON.stringify(u));
  const small = await call(env, "/api/billing");
  ck("one at 60 units is eligible and flat", small.body.units?.eligible && !small.body.units.applies
    && small.body.units.monthlyCents === 9900, JSON.stringify(small.body.units));
  const gc = await call(env, "/api/billing", { seat: ["u_gc", "acc_gc"] });
  ck("a general contractor gets no units object, however many units it holds", gc.body.units === null);
}

// ---- checkout -------------------------------------------------------------
{
  console.log("\n-- checkout --");
  const db = seed(); const env = ENV(db);
  const yr = await call(env, "/api/billing/checkout", { method: "POST", seat: ["u_new", "acc_new"], body: { cycle: "annual" } });
  ck("yearly is refused past 80 units", yr.status === 409 && yr.body.error === "annual_not_available",
    `${yr.status} ${JSON.stringify(yr.body)}`);
  ck("and Stripe is not asked", !calls.some((c) => /checkout\/sessions/.test(c.url)));
  calls = [];
  const mo = await call(env, "/api/billing/checkout", { method: "POST", seat: ["u_new", "acc_new"], body: { cycle: "monthly" } });
  const cs = calls.find((c) => /checkout\/sessions/.test(c.url))?.body || {};
  ck("monthly goes", mo.status === 200 && !!mo.body.url, `${mo.status} ${JSON.stringify(mo.body)}`);
  ck("the month is $1.25 x occupied, on the Scale product",
    cs["line_items[0][price_data][unit_amount]"] === "125" && cs["line_items[0][quantity]"] === "90"
    && cs["line_items[0][price_data][product]"] === "prod_scale"
    && cs["line_items[0][price_data][recurring][interval]"] === "month" && !cs["line_items[0][price]"],
    JSON.stringify(cs));
  ck("the setup fee is a one-time line on the first invoice",
    cs["line_items[1][price_data][unit_amount]"] === "25000" && !cs["line_items[1][price_data][recurring][interval]"]
    && /setup/i.test(cs["line_items[1][price_data][product_data][name]"] || ""), JSON.stringify(cs));
  ck("and it rides on the subscription's metadata too",
    cs["subscription_data[metadata][setup_cents]"] === "25000" && cs["metadata[setup_cents]"] === "25000");

  calls = [];
  db.exec(`UPDATE properties SET units = 70, occupied_units = 70 WHERE id = 'p_new1'`);
  await call(env, "/api/billing/checkout", { method: "POST", seat: ["u_new", "acc_new"], body: { cycle: "annual" } });
  const flat = calls.find((c) => /checkout\/sessions/.test(c.url))?.body || {};
  ck("at 80 or fewer, yearly is refused too: one price, monthly", !flat["line_items[0][price]"], JSON.stringify(flat));
  calls = [];
  await call(env, "/api/billing/checkout", { method: "POST", seat: ["u_new", "acc_new"], body: { cycle: "monthly" } });
  const flatMo = calls.find((c) => /checkout\/sessions/.test(c.url))?.body || {};
  ck("and monthly is the flat $99 price, no setup line",
    flatMo["line_items[0][price]"] === "price_monthly" && !flatMo["line_items[1][quantity]"] && !flatMo["metadata[setup_cents]"],
    JSON.stringify(flatMo));
  const pa = await call(env, "/api/account", { method: "PATCH", seat: ["u_new", "acc_new"], body: { billing: "annual" } });
  ck("the account cannot be switched to yearly either", pa.status === 409 && pa.body.error === "annual_not_available",
    `${pa.status} ${JSON.stringify(pa.body)}`);
  db.exec(`UPDATE accounts SET billing = 'annual', plan = 'scale', stripe_subscription_id = NULL WHERE id = 'acc_new'`);
  const ga = await call(env, "/api/account", { seat: ["u_new", "acc_new"] });
  ck("a stored year with no yearly subscription reads as monthly", ga.body.billing === "monthly", JSON.stringify(ga.body.billing));
  db.exec(`UPDATE accounts SET stripe_subscription_id = 'sub_year' WHERE id = 'acc_new'`);
  const gy = await call(env, "/api/account", { seat: ["u_new", "acc_new"] });
  ck("a yearly subscription really running is still yearly", gy.body.billing === "annual", JSON.stringify(gy.body.billing));
  db.exec(`UPDATE accounts SET billing = 'monthly', plan = 'basic', stripe_subscription_id = NULL WHERE id = 'acc_new'`);

  calls = [];
  await call(env, "/api/billing/checkout", { method: "POST", seat: ["u_gc", "acc_gc"], body: { cycle: "monthly" } });
  const g = calls.find((c) => /checkout\/sessions/.test(c.url))?.body || {};
  ck("a general contractor with 500 units is the flat price", g["line_items[0][price]"] === "price_monthly"
    && !g["line_items[1][quantity]"], JSON.stringify(g));
}

// ---- the webhook records a fee paid at checkout ----------------------------
{
  console.log("\n-- the checkout webhook --");
  const db = seed(); const env = ENV(db);
  subState.sub_new = { customer: "cus_new", metadata: { setup_cents: "25000" },
    item: { priceId: null, unitAmount: 125, quantity: 90 } };
  const st = await hook(env, { id: "evt_1", type: "checkout.session.completed", data: { object: {
    id: "cs_9", client_reference_id: "acc_new", customer: "cus_new", subscription: "sub_new",
    metadata: { account_id: "acc_new", setup_cents: "25000", setup_tier: "81–250 units", setup_units: "100" } } } });
  const row = db.prepare(`SELECT * FROM account_setup_fees WHERE account_id = 'acc_new'`).get();
  ck("the setup fee is recorded as paid at checkout", st === 200 && row?.status === "paid_at_checkout"
    && row.amount_cents === 25000 && row.stripe_ref === "cs_9", `${st} ${JSON.stringify(row)}`);
  const ev = db.prepare(`SELECT mrr_delta_cents FROM subscription_events WHERE account_id = 'acc_new' AND kind = 'upgraded'`).get();
  ck("and the upgrade's MRR is what the item charges, not a flat $99", ev?.mrr_delta_cents === 11250, JSON.stringify(ev));
  invoiceItems = 0;
  await call(env, "/api/cron/unit-billing", { bearer: "cron_x" });
  ck("so the nightly sync charges nothing more", invoiceItems === 0, String(invoiceItems));
}

// ---- an existing subscriber crosses 80 -------------------------------------
{
  console.log("\n-- crossing 80 on an existing subscription --");
  const db = seed(); const env = ENV(db);
  const add = await call(env, "/api/properties", { method: "POST", body: { name: "Fremont", units: 40, occupiedUnits: 30 } });
  const upd = calls.find((c) => /subscription_items\/si_sub_pm/.test(c.url))?.body || {};
  ck("the building saves", add.status === 201);
  ck("the subscription moves to $1.25 x occupied (60 blank-as-full + 30 = 90), with no proration",
    upd["price_data[unit_amount]"] === "125" && upd.quantity === "90" && upd.proration_behavior === "none"
    && upd["price_data[product]"] === "prod_scale", JSON.stringify(upd));
  const ii = calls.filter((c) => /invoiceitems/.test(c.url));
  ck("the setup fee goes on the next bill once, keyed by the account",
    ii.length === 1 && ii[0].body.amount === "25000" && ii[0].key === "setup-fee:acc_pm", JSON.stringify(ii));
  const fee = db.prepare(`SELECT status, stripe_ref FROM account_setup_fees WHERE account_id = 'acc_pm'`).get();
  ck("and is recorded as invoiced", fee?.status === "invoiced" && fee.stripe_ref === "ii_1", JSON.stringify(fee));
  const ev = db.prepare(`SELECT kind, mrr_delta_cents FROM subscription_events WHERE account_id = 'acc_pm'`).all();
  ck("the console sees it as expansion", ev.some((e) => e.kind === "cycle" && e.mrr_delta_cents === 11250 - 9900),
    JSON.stringify(ev));
  const act = db.prepare(`SELECT text FROM activity WHERE account_id = 'acc_pm' AND text LIKE '%per occupied unit%'`).get();
  ck("and the account is told", !!act, JSON.stringify(act));

  calls = [];
  await call(env, `/api/properties/p_pm1`, { method: "PATCH", body: { occupiedUnits: 50 } });
  const upd2 = calls.find((c) => /subscription_items/.test(c.url))?.body || {};
  ck("occupancy moving changes the quantity", upd2.quantity === "80", JSON.stringify(upd2));
  ck("and charges no second setup fee", !calls.some((c) => /invoiceitems/.test(c.url)));

  calls = [];
  await call(env, "/api/cron/unit-billing", { bearer: "cron_x" });
  ck("a sync with nothing changed asks Stripe to change nothing",
    !calls.some((c) => /subscription_items|invoiceitems/.test(c.url)), JSON.stringify(calls.map((c) => c.url)));

  calls = [];
  const del = await call(env, "/api/properties/p_pm1", { method: "DELETE" });
  const back = calls.find((c) => /subscription_items/.test(c.url))?.body || {};
  ck("dropping back under 80 goes back to the flat price", del.status === 200
    && back.price === "price_monthly" && back.quantity === "1", JSON.stringify(back));
}

// ---- a building saved before the checkout webhook --------------------------
{
  console.log("\n-- the race with checkout --");
  const db = seed(); const env = ENV(db);
  db.exec(`UPDATE accounts SET plan = 'scale', stripe_customer_id = 'cus_new', stripe_subscription_id = 'sub_new',
           subscription_status = 'active' WHERE id = 'acc_new'`);
  subState.sub_new = { customer: "cus_new", metadata: { setup_cents: "25000", setup_tier: "81–250 units", setup_units: "100" },
    item: { priceId: null, unitAmount: 125, quantity: 90 } };
  await call(env, "/api/properties/p_new1", { method: "PATCH", seat: ["u_new", "acc_new"], body: { occupiedUnits: 91 } });
  const row = db.prepare(`SELECT status FROM account_setup_fees WHERE account_id = 'acc_new'`).get();
  ck("a subscription that carried the fee at checkout is not charged it again",
    !calls.some((c) => /invoiceitems/.test(c.url)) && row?.status === "paid_at_checkout", JSON.stringify(row));
}

// ---- yearly is left alone --------------------------------------------------
{
  console.log("\n-- a yearly subscriber --");
  const db = seed(); const env = ENV(db);
  await call(env, "/api/properties/p_yr1", { method: "PATCH", seat: ["u_yr", "acc_yr"], body: { occupiedUnits: 200 } });
  ck("is not moved mid-year", !calls.some((c) => /subscription_items|invoiceitems/.test(c.url)),
    JSON.stringify(calls.map((c) => c.url)));
  const cron = await call(env, "/api/cron/unit-billing", { bearer: "nope" });
  ck("and the manual sweep needs the cron secret", cron.status === 403);
}

// ---- the invariant, against a real row -------------------------------------
{
  console.log("\n-- CHECK.sql --");
  const db = seed();
  ck("a clean database reads 0", runCheck(db).m084_inv_occupied_over_units === 0);
  // A column check answers how many of its columns are there.
  ck("and both did-I-run-it checks find every column",
    runCheck(db).m084_occupied_units === 1 && runCheck(db).m084_account_setup_fees === 7,
    `${runCheck(db).m084_occupied_units} ${runCheck(db).m084_account_setup_fees}`);
  db.exec(`UPDATE properties SET occupied_units = 61 WHERE id = 'p_pm1'`);
  ck("an occupied count over the units reads 1", runCheck(db).m084_inv_occupied_over_units === 1);
  const old = seed({ migrated: false });
  const first = Object.fromEntries(old.prepare(checkStatements()[0]).all().map((r) => [r.name, r]));
  ck("and an unmigrated database says NOT RUN on both",
    first.m084_occupied_units?.value === 0 && first.m084_account_setup_fees?.value === 0
    && first.m084_occupied_units?.verdict !== "ok", JSON.stringify(first.m084_occupied_units));
}

console.log(`\nunit-pricing-test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
