// Per-unit pricing at signup (086).
//
// A property manager, a portfolio manager and a building owner are priced per
// occupied unit past 80 units -- but signing up, they have no buildings in
// SubSub yet. So the form asks how many units on Scale, quotes the price as
// they type, and the account is billed on that answer until a building carries
// a unit count. These are the properties that hold it:
//
//   THE SERVER STORES THE ANSWER AND PRICES FROM IT. /api/billing and the
//   checkout read the signup units while no building has any, and the
//   buildings once one does. Yearly is refused past 80 on the server too.
//
//   ONLY THE THREE KINDS. A general contractor's units are ignored, and wrong
//   numbers are refused by name rather than stored.
//
//   THE FORM QUOTES WHAT THE BILL WOULD. Driven in a browser: the units are
//   asked only on Scale and only for the three kinds, the price and the setup
//   fee match unitPricing(), the plan pill follows, a yearly choice gives way
//   past 80 and comes back under it, and what is posted is what was quoted.
//
//   node --no-warnings scripts/signup-units-test.mjs

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";
import { launch, tally, wait } from "./lib/stub-stack.mjs";
import { unitPricing, validEstimate, pricingRows, UNIT_THRESHOLD, UNIT_PRICE_CENTS,
  MIN_MONTHLY_CENTS, SETUP_TIERS } from "../shared/unitpricing.js";

const t = tally();
const { default: worker } = await import("../worker/index.js");
const SCHEMA = readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8");
const root = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const PAGE = join(root, "get-started.html");
const PRICING = join(root, "pricing.html");
const html = readFileSync(PAGE, "utf8");

// ---- the rule ---------------------------------------------------------------
console.log("\n-- the rule --");
t.ck("blank is no estimate", validEstimate(undefined).estimate === null && validEstimate({ total: "" }).estimate === null);
t.ck("whole numbers are kept", JSON.stringify(validEstimate({ total: 300, occupied: 250 }).estimate) === '{"total":300,"occupied":250}');
t.ck("strings of digits are numbers", validEstimate({ total: "300", occupied: "" }).estimate?.total === 300
  && validEstimate({ total: "300", occupied: "" }).estimate?.occupied === null);
t.ck("a fraction is refused", validEstimate({ total: 2.5 }).error === "invalid_units");
t.ck("a negative is refused", validEstimate({ total: -1 }).error === "invalid_units");
t.ck("more occupied than units is refused by name", validEstimate({ total: 10, occupied: 11 }).error === "occupied_over_units");
const rowsNone = pricingRows([], { total: 300, occupied: 250 });
t.ck("no buildings: the estimate prices it", rowsNone.fromEstimate && rowsNone.rows[0].units === 300);
const rowsZero = pricingRows([{ units: 0 }, { units: null }], { total: 300, occupied: 250 });
t.ck("buildings with no unit count still leave the estimate in charge", rowsZero.fromEstimate);
const rowsTyped = pricingRows([{ units: 40, occupiedUnits: 40 }], { total: 300, occupied: 250 });
t.ck("one building with units and the buildings decide", !rowsTyped.fromEstimate && rowsTyped.rows.length === 1);

// ---- the server ---------------------------------------------------------------
const realFetch = globalThis.fetch;
let checkoutBodies = [];
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json" } });
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (!u.includes("stripe")) return realFetch(url, init);
  const body = Object.fromEntries(new URLSearchParams(init.body || ""));
  if (/\/prices\/price_monthly$/.test(u)) return json({ id: "price_monthly", product: "prod_scale" });
  if (/\/checkout\/sessions$/.test(u)) { checkoutBodies.push(body); return json({ id: "cs_1", url: "https://checkout.stripe.test/cs_1" }); }
  return json({ error: { message: "stub has no route for " + u } }, 404);
};
const seed = ({ migrated = true } = {}) => {
  const db = freshDb({ base: SCHEMA, migrations: [] });
  if (!migrated) db.exec(`DROP TABLE portfolio_estimates;`);
  return db;
};
const ENV = (db) => ({ DB: makeD1(db), STRIPE_SECRET_KEY: "sk_test_x", STRIPE_PRICE_SCALE_MONTHLY: "price_monthly",
  STRIPE_PRICE_SCALE_ANNUAL: "price_annual" });
let ip = 0;
const signup = async (env, body) => {
  ip += 1;
  const res = await worker.fetch(new Request("https://api.subsub.work/api/signup", {
    method: "POST", headers: { "Content-Type": "application/json", "CF-Connecting-IP": `10.0.0.${ip}` },
    body: JSON.stringify({ name: "Rae Park", company: `Co ${ip}`, subdomain: `co${ip}x`, email: `rae${ip}@co.test`,
      trades: [], ...body }),
  }), env);
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
const call = async (env, path, seat, { method = "GET", body } = {}) => {
  const res = await worker.fetch(new Request(`https://api.subsub.work${path}`, {
    method, headers: { "Content-Type": "application/json", "X-User-Id": seat.userId, "X-Account-Id": seat.accountId },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }), env);
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

console.log("\n-- signup stores the units and prices from them --");
{
  const db = seed(); const env = ENV(db);
  const r = await signup(env, { kind: "property_manager", plan: "scale", billing: "annual", units: { total: 300, occupied: 250 } });
  t.ck("a property manager signs up", r.status === 201, `${r.status} ${JSON.stringify(r.body)}`);
  const want = unitPricing("property_manager", [{ units: 300, occupiedUnits: 250 }]);
  t.ck("the reply quotes the price from the units", r.body.units?.applies && r.body.units.monthlyCents === want.monthlyCents
    && r.body.units.setupCents === want.setupCents && r.body.units.recorded === true, JSON.stringify(r.body.units));
  const acc = db.prepare(`SELECT billing FROM accounts WHERE id = ?`).get(r.body.accountId);
  t.ck("yearly is stored as monthly past 80 units", acc?.billing === "monthly" && r.body.billing === "monthly", JSON.stringify(acc));
  const est = db.prepare(`SELECT total_units, occupied_units, source FROM portfolio_estimates WHERE account_id = ?`).get(r.body.accountId);
  t.ck("the units are stored", est?.total_units === 300 && est?.occupied_units === 250 && est?.source === "signup", JSON.stringify(est));
  const ev = db.prepare(`SELECT payload AS meta FROM events WHERE subject_id = ? AND kind = 'account.created'`).get(r.body.accountId);
  t.ck("and recorded on the signup event", /"total":300/.test(String(ev?.meta || "")), String(ev?.meta));

  const seat = { userId: r.body.userId, accountId: r.body.accountId };
  const bill = await call(env, "/api/billing", seat);
  t.ck("the billing read prices it per unit from the signup units",
    bill.body.units?.applies && bill.body.units.fromEstimate === true && bill.body.units.total === 300
      && bill.body.units.occupied === 250 && bill.body.units.monthlyCents === 250 * UNIT_PRICE_CENTS,
    JSON.stringify(bill.body.units));

  const yr = await call(env, "/api/billing/checkout", seat, { method: "POST", body: { cycle: "annual" } });
  t.ck("the checkout refuses yearly", yr.status === 409 && yr.body.error === "annual_not_available", `${yr.status} ${JSON.stringify(yr.body)}`);
  checkoutBodies = [];
  const mo = await call(env, "/api/billing/checkout", seat, { method: "POST", body: { cycle: "monthly" } });
  const cb = checkoutBodies[0] || {};
  t.ck("and charges per occupied unit with the setup fee, monthly",
    mo.status === 200 && cb["line_items[0][quantity]"] === "250"
      && cb["line_items[0][price_data][unit_amount]"] === String(UNIT_PRICE_CENTS)
      && cb["line_items[1][price_data][unit_amount]"] === String(want.setupCents),
    `${mo.status} ${JSON.stringify(cb)}`);

  // The first building with a unit count takes over.
  db.prepare(`INSERT INTO properties (id, account_id, owner_account_id, name, units) VALUES ('p1', ?, ?, 'Ballard', 40)`)
    .run(r.body.accountId, r.body.accountId);
  const after = await call(env, "/api/billing", seat);
  t.ck("once a building has units, the buildings decide",
    after.body.units?.fromEstimate === false && after.body.units.total === 40 && !after.body.units.applies,
    JSON.stringify(after.body.units));
}

console.log("\n-- only the three kinds, and wrong numbers are refused --");
{
  const db = seed(); const env = ENV(db);
  const gc = await signup(env, { kind: "general_contractor", plan: "scale", billing: "annual", units: { total: 900, occupied: 900 } });
  const gcAcc = db.prepare(`SELECT billing FROM accounts WHERE id = ?`).get(gc.body.accountId);
  const gcEst = db.prepare(`SELECT COUNT(*) n FROM portfolio_estimates WHERE account_id = ?`).get(gc.body.accountId);
  t.ck("a general contractor's units are ignored, and yearly stands",
    gc.status === 201 && gcAcc?.billing === "annual" && gcEst.n === 0 && gc.body.units === null, JSON.stringify({ gcAcc, gcEst, u: gc.body.units }));
  const bad = await signup(env, { kind: "building_owner", plan: "scale", units: { total: 10, occupied: 20 } });
  t.ck("more occupied than units is refused by name", bad.status === 400 && bad.body.error === "occupied_over_units",
    `${bad.status} ${JSON.stringify(bad.body)}`);
  const frac = await signup(env, { kind: "portfolio_manager", plan: "scale", units: { total: "12.5" } });
  t.ck("and a fraction", frac.status === 400 && frac.body.error === "invalid_units");
  const small = await signup(env, { kind: "portfolio_manager", plan: "scale", billing: "annual", units: { total: 60 } });
  const smallAcc = db.prepare(`SELECT billing FROM accounts WHERE id = ?`).get(small.body.accountId);
  t.ck("80 or fewer keeps yearly", small.status === 201 && smallAcc?.billing === "annual" && small.body.units?.applies === false,
    JSON.stringify(small.body));
  const none = await signup(env, { kind: "property_manager", plan: "scale" });
  t.ck("no units given is fine", none.status === 201 && none.body.units === null);
}

console.log("\n-- a database without 086 still signs people up --");
{
  const db = seed({ migrated: false }); const env = ENV(db);
  const r = await signup(env, { kind: "property_manager", plan: "scale", units: { total: 300, occupied: 250 } });
  t.ck("signup works and says the units were not kept", r.status === 201 && r.body.units?.recorded === false,
    `${r.status} ${JSON.stringify(r.body)}`);
  const bill = await call(env, "/api/billing", { userId: r.body.userId, accountId: r.body.accountId });
  t.ck("and billing reads the buildings, as before", bill.status === 200 && bill.body.units?.fromEstimate === false,
    JSON.stringify(bill.body.units));
}
globalThis.fetch = realFetch;

// ---- the page's figures are the module's --------------------------------------
console.log("\n-- the form's figures are the module's --");
const attr = (n) => (html.match(new RegExp(`id="unitsAsk"[^>]*?${n}="([^"]*)"`, "s")) || [])[1];
t.ck("the threshold", Number(attr("data-threshold")) === UNIT_THRESHOLD, attr("data-threshold"));
t.ck("the unit price", Number(attr("data-unit-cents")) === UNIT_PRICE_CENTS);
t.ck("the minimum", Number(attr("data-min-cents")) === MIN_MONTHLY_CENTS);
const steps = String(attr("data-setup") || "").split(",").map((p) => p.split(":").map(Number)).map(([u, c]) => [u || Infinity, c]);
t.ck("every setup step", steps.length === SETUP_TIERS.length
  && SETUP_TIERS.every((s, i) => steps[i][0] === s.upTo && steps[i][1] === s.cents), attr("data-setup"));

// ---- the form, in a browser -----------------------------------------------------
const browser = await launch();
const usd = (c) => "$" + (c / 100).toLocaleString("en-US", { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 });
try {
  const open = async (qs, vw = 1100) => {
    const page = await browser.newPage();
    await page.setViewport({ width: vw, height: 1400 });
    const errs = [];
    page.on("pageerror", (e) => errs.push(e.message));
    await page.goto(pathToFileURL(PAGE).href + (qs || ""), { waitUntil: "domcontentloaded" });
    await wait(300);
    return { page, errs };
  };
  const read = (page) => page.evaluate(() => ({
    role: document.querySelector('input[name="role"]:checked')?.value,
    shown: !document.getElementById("unitsAsk").classList.contains("hide"),
    units: document.getElementById("units").value, occ: document.getElementById("occupied").value,
    quote: document.getElementById("unitQuote").innerText.replace(/\s+/g, " ").trim(),
    pill: document.getElementById("planPrice").textContent.trim(),
  }));
  const set = async (page, id, v) => {
    await page.evaluate((i, val) => { const el = document.getElementById(i); el.value = String(val);
      el.dispatchEvent(new Event("input", { bubbles: true })); }, id, v);
    await wait(30);
  };
  const pick = async (page, v) => {
    await page.evaluate((val) => { const r = [...document.querySelectorAll('input[name="role"]')].find((x) => x.value === val);
      r.checked = true; r.dispatchEvent(new Event("change", { bubbles: true })); }, v);
    await wait(30);
  };

  console.log("\n-- arriving from the calculator --");
  {
    const { page, errs } = await open("?plan=scale&billing=annual&units=300&occupied=250");
    const r = await read(page);
    const want = unitPricing("property_manager", [{ units: 300, occupiedUnits: 250 }]);
    t.ck("it opens on property manager with the units filled in", r.role === "Property manager" && r.shown
      && r.units === "300" && r.occ === "250", JSON.stringify(r));
    t.ck("the quote is the bill's: month and setup", r.quote.includes(usd(want.monthlyCents)) && r.quote.includes(usd(want.setupCents)), r.quote);
    t.ck("the plan pill says the same month", r.pill.startsWith(usd(want.monthlyCents) + "/mo"), r.pill);
    t.ck("and says yearly gives way past 80", /billed monthly, so this replaces the yearly price/.test(r.quote), r.quote);

    await set(page, "units", 60); await set(page, "occupied", 60);
    const under = await read(page);
    t.ck("under 80 the price is the flat one, with no setup fee", /\$99/.test(under.quote) && /No setup fee/.test(under.quote), under.quote);
    t.ck("and a yearly choice comes back", /\$990\/yr/.test(under.pill), under.pill);

    await set(page, "units", 10); await set(page, "occupied", 20);
    const over = await read(page);
    t.ck("more occupied than units is said, with no price", /More units are occupied/.test(over.quote), over.quote);

    await pick(page, "General contractor");
    const gc = await read(page);
    t.ck("a general contractor is not asked", !gc.shown && /\$990\/yr/.test(gc.pill), JSON.stringify(gc));
    for (const k of ["Building owner", "Commercial portfolio manager"]) {
      await pick(page, k);
      t.ck(`a ${k.toLowerCase()} is`, (await read(page)).shown);
    }
    t.ck("no script error", errs.length === 0, errs.join(" | "));
    await page.close();
  }

  console.log("\n-- only on Scale --");
  {
    const { page } = await open("?plan=basic&as=property%20manager");
    t.ck("on Basic the units are not asked", !(await read(page)).shown);
    await page.close();
  }

  console.log("\n-- occupied follows the units until somebody types in it --");
  {
    const { page } = await open("?plan=scale&as=property%20manager");
    const blank = await read(page);
    t.ck("blank says what it will cost until then", blank.shown && /Enter your units/.test(blank.quote) && /\$99/.test(blank.quote), blank.quote);
    await set(page, "units", 400);
    t.ck("follows", (await read(page)).occ === "400");
    await set(page, "occupied", 350); await set(page, "units", 500);
    t.ck("and stops", (await read(page)).occ === "350");
    await page.close();
  }

  console.log("\n-- what is posted is what was quoted --");
  {
    const { page, errs } = await open("?plan=scale&billing=annual&units=300&occupied=250");
    const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS" };
    let posted = null;
    await page.setRequestInterception(true);
    page.on("request", (r) => {
      if (!/\/api\/signup$/.test(r.url())) return r.continue();
      if (r.method() === "OPTIONS") return r.respond({ status: 204, headers: CORS });
      posted = JSON.parse(r.postData() || "{}");
      return r.respond({ status: 201, contentType: "application/json", headers: CORS,
        body: JSON.stringify({ ok: true, accountId: "a", userId: "u", subdomain: "x", kind: "property_manager",
          signInUrl: "https://app.subsub.work", needsConfirmation: true, billing: "monthly",
          units: { recorded: true, applies: true, monthlyCents: 31250, setupCents: 50000, total: 300, occupied: 250 } }) });
    });
    // Step 1 refuses more occupied than units before anything is sent.
    await set(page, "occupied", 400);
    await page.evaluate(() => {
      document.getElementById("name").value = "Rae Park";
      document.getElementById("email").value = "rae@sound.test";
      document.querySelector("#f1 button[type=submit]").click();
    });
    await wait(200);
    const stuck = await page.evaluate(() => ({ step: [...document.querySelectorAll(".step")].find((x) => x.hasAttribute("data-on"))?.dataset.step,
      err: document.querySelector("#occupied[aria-invalid=true]") ? document.querySelector("#unitsAsk .field-err")?.textContent : null }));
    t.ck("step 1 will not go on with more occupied than units", stuck.step === "1" && /occupied/.test(stuck.err || ""), JSON.stringify(stuck));
    await set(page, "occupied", 250);
    await page.evaluate(() => document.querySelector("#f1 button[type=submit]").click());
    await wait(400);
    await page.evaluate(() => {
      document.getElementById("company").value = "Sound Property";
      document.querySelector("#trades button[data-trade]").click();
      document.querySelector("#f2 button[type=submit]").click();
    });
    await wait(400);
    await page.evaluate(() => document.getElementById("skipInv")?.click());
    for (let n = 0; n < 30 && !posted; n++) await wait(100);
    await wait(300);
    t.ck("the units are posted as quoted, and the billing as monthly",
      posted?.units?.total === 300 && posted?.units?.occupied === 250 && posted?.billing === "monthly"
        && posted?.kind === "property_manager", JSON.stringify(posted && { units: posted.units, billing: posted.billing, kind: posted.kind }));
    const done = await page.evaluate(() => document.getElementById("doneLine")?.textContent || "");
    t.ck("the last screen says the price", /\$312\.50 a month/.test(done) && /\$500 setup fee/.test(done), done);
    t.ck("no script error", errs.length === 0, errs.join(" | "));
    await page.close();
  }

  console.log("\n-- the pricing page sends people here rather than pricing them itself --");
  {
    const ph = readFileSync(PRICING, "utf8").replace(/<!--[\s\S]*?-->/g, "");
    t.ck("the pricing page has no calculator", !/unitsCalc|Work out your price/.test(ph));
    const href = (ph.match(/id="unitsGoBtn"[^>]*href="([^"]+)"/) || [])[1] || "";
    t.ck("and links into signup as a property manager on Scale, monthly",
      href === "get-started.html?plan=scale&amp;billing=monthly&amp;as=property%20manager", href);
    const { page } = await open("?plan=scale&billing=monthly&as=property%20manager");
    const s = await read(page);
    t.ck("which opens on Property manager with the units asked", s.role === "Property manager" && s.shown, JSON.stringify(s));
    await page.close();
  }

  console.log("\n-- at phone width --");
  {
    const { page } = await open("?plan=scale&units=300&occupied=250", 390);
    const fit = await page.evaluate(() => ({ r: document.getElementById("unitsAsk").getBoundingClientRect().right,
      vw: innerWidth, sw: document.documentElement.scrollWidth }));
    t.ck("the units box fits with nothing sideways", fit.r <= fit.vw + 0.5 && fit.sw <= fit.vw + 1, JSON.stringify(fit));
    await page.close();
  }
} finally {
  await browser.close();
}
t.done();
