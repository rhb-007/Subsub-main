// A second business on one login (099).
//
// A general contractor that also manages buildings runs two accounts, one of
// each kind, with the same person as admin on both. These are the properties
// that hold it:
//
//   Only the OTHER side can be added: construction to management or the
//   reverse, never two of one kind. One pair per account.
//
//   The second account copies the trades, colors and mark, starts on Basic,
//   and the management side is connected to the construction side's company
//   with an active engagement and the construction team seated as contractors.
//
//   The cheaper of the two is 50% off, only while BOTH pay, by the one
//   coupon. Stripe is told only when the answer changes, the discount moves
//   when the price moves, and the checkout of the cheaper one carries it.
//
//   node --no-warnings scripts/linked-business-test.mjs

import { readFileSync } from "node:fs";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";
import { runCheck } from "./lib/check-sql.mjs";
import { secondKinds, linkRefusal, discountTarget, LINKED_DISCOUNT_PERCENT, LINKED_COUPON_ID,
  discountedCents } from "../shared/linked.js";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");
const SCHEMA = readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8");

{
  console.log("\n-- the rule --");
  ck("a general contractor may add a management business",
    JSON.stringify(secondKinds("general_contractor")) === JSON.stringify(["property_manager", "portfolio_manager", "building_owner"]));
  ck("a property manager may add a construction business",
    JSON.stringify(secondKinds("property_manager")) === JSON.stringify(["general_contractor", "subcontractor"]));
  ck("never two of one side", linkRefusal("general_contractor", "subcontractor") === "same_side"
    && linkRefusal("property_manager", "building_owner") === "same_side");
  ck("an unknown kind links nothing", linkRefusal("mystery", "general_contractor") === "not_linkable");
  const gc = { id: "g", kind: "general_contractor", paying: true, monthlyCents: 9900, second: false };
  const pm = { id: "p", kind: "property_manager", paying: true, monthlyCents: 18625, second: true };
  ck("the cheaper one is discounted", discountTarget(gc, pm) === "g");
  ck("only while both pay", discountTarget({ ...gc }, { ...pm, paying: false }) === null
    && discountTarget({ ...gc, paying: false }, pm) === null);
  ck("a tie goes to the side that is not unit-priced",
    discountTarget({ ...gc, second: true }, { ...pm, second: false, monthlyCents: 9900 }) === "g"
    && discountTarget({ ...pm, monthlyCents: 9900, second: false }, { ...gc, second: true }) === "g");
  ck("a real price gap outranks the kind", discountTarget({ ...gc, monthlyCents: 20000 }, pm) === "p");
  ck("half off, in whole cents", LINKED_DISCOUNT_PERCENT === 50 && discountedCents(9900) === 4950);
}

// ---- a stubbed Stripe ----------------------------------------------------
const realFetch = globalThis.fetch;
let calls = [];
let coupons = {};
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json" } });
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (!u.includes("stripe")) return realFetch(url, init);
  const method = init.method || "POST";
  const body = init.body || "";
  calls.push({ url: u, method, body });
  let m = u.match(/\/coupons\/([^/?]+)$/);
  if (m && method === "GET") return coupons[m[1]] ? json(coupons[m[1]]) : json({ error: { message: "No such coupon" } }, 404);
  if (/\/coupons$/.test(u)) {
    const p = Object.fromEntries(new URLSearchParams(body));
    coupons[p.id] = { id: p.id, percent_off: Number(p.percent_off), duration: p.duration };
    return json(coupons[p.id]);
  }
  m = u.match(/\/subscriptions\/(sub_[a-z0-9_]+)$/);
  if (m && method === "POST") return json({ id: m[1] });
  if (/\/prices\/price_monthly$/.test(u)) return json({ id: "price_monthly", product: "prod_scale" });
  if (/\/checkout\/sessions$/.test(u)) return json({ id: "cs_1", url: "https://checkout.stripe.test/cs_1" });
  return json({ error: { message: "stub has no route for " + u } }, 404);
};

const seed = ({ migrated = true } = {}) => {
  const db = freshDb({ base: SCHEMA, migrations: [] });
  if (!migrated) db.exec(`DROP TABLE business_links;`);
  db.exec(`
    INSERT INTO accounts(id,name,subdomain,kind,plan,billing,trades,theme,use_default_mark)
      VALUES ('acc_gc','Rudd Development','rudddev','general_contractor','basic','monthly','["roofing","painting"]','{"accent":"#123456","signInTitle":"Rudd-Development-Sign-in","applyTitle":"Rudd-Development-Sign-up"}',0),
             ('acc_pm2','Other PM','otherpm','property_manager','basic','monthly',NULL,NULL,1);
    INSERT INTO users(id,name,email,phone) VALUES ('u_marc','Marc Rudd','marc@rudd.test','2065550100'),
      ('u_pmx','Pat','pat@rudd.test',NULL),('u_ten','Ten','ten@x.test',NULL),('u_o','Ollie','o@x.test',NULL);
    INSERT INTO memberships(id,user_id,account_id,role) VALUES
      ('m1','u_marc','acc_gc','admin'),('m2','u_pmx','acc_gc','pm'),('m3','u_o','acc_pm2','admin');
  `);
  calls = []; coupons = {};
  return db;
};
const ENV = (db) => ({ DB: makeD1(db), STRIPE_SECRET_KEY: "sk_test_x", STRIPE_PRICE_SCALE_MONTHLY: "price_monthly",
  STRIPE_PRICE_SCALE_ANNUAL: "price_annual", STRIPE_WEBHOOK_SECRET: "whsec_x", CRON_SECRET: "cron_x" });
const call = async (env, path, { method = "GET", seat = ["u_marc", "acc_gc"], body } = {}) => {
  const res = await worker.fetch(new Request(`https://api.subsub.work${path}`, {
    method, headers: { "Content-Type": "application/json", "X-User-Id": seat[0], "X-Account-Id": seat[1] },
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
const subEvent = (accountId, subId, status, n) => ({ id: `evt_${n}`, type: "customer.subscription.updated",
  data: { object: { id: subId, status, customer: `cus_${accountId}`, metadata: { account_id: accountId },
    items: { data: [{ price: { id: "price_monthly", unit_amount: 9900, recurring: { interval: "month" } }, quantity: 1 }] } } } });
const subCalls = () => calls.filter((c) => /\/subscriptions\/sub_/.test(c.url) && c.method === "POST");

let pmId;
{
  console.log("\n-- adding the second business --");
  const db = seed(); const env = ENV(db);
  const asPm = await call(env, "/api/account/second-business", { method: "POST", seat: ["u_pmx", "acc_gc"],
    body: { name: "Rudd PM", subdomain: "ruddpm", kind: "property_manager" } });
  ck("a project manager cannot", asPm.status === 403, String(asPm.status));
  const same = await call(env, "/api/account/second-business", { method: "POST",
    body: { name: "Rudd Two", subdomain: "ruddtwo", kind: "subcontractor" } });
  ck("the same side is refused, naming what is allowed", same.status === 400 && same.body.error === "same_side"
    && same.body.allowed?.includes("property_manager"), JSON.stringify(same.body));
  const taken = await call(env, "/api/account/second-business", { method: "POST",
    body: { name: "Rudd PM", subdomain: "otherpm", kind: "property_manager" } });
  ck("a taken address is refused", taken.status === 409 && taken.body.error === "subdomain_taken");

  const r = await call(env, "/api/account/second-business", { method: "POST",
    body: { name: "Rudd Property Management", subdomain: "ruddpm", kind: "property_manager" } });
  ck("created", r.status === 201 && r.body.kind === "property_manager" && r.body.connected, `${r.status} ${JSON.stringify(r.body)}`);
  pmId = r.body.id;
  const a = db.prepare(`SELECT * FROM accounts WHERE id = ?`).get(pmId);
  ck("on Basic, monthly, with the trades, colors and mark copied",
    a?.plan === "basic" && a.billing === "monthly" && a.trades === '["roofing","painting"]'
    && JSON.parse(a.theme || "{}").accent === "#123456" && a.use_default_mark === 0, JSON.stringify(a));
  // The titles name the first business, so copied they put its name in the
  // second one's tabs. Left off, the pages build them from its own name.
  const t2 = JSON.parse(a?.theme || "{}");
  ck("but not the first business's page titles", !("signInTitle" in t2) && !("applyTitle" in t2), a?.theme);
  const seat = db.prepare(`SELECT role FROM memberships WHERE user_id = 'u_marc' AND account_id = ?`).get(pmId);
  ck("the same person is its admin", seat?.role === "admin");
  ck("and nobody else was moved", !db.prepare(`SELECT 1 FROM memberships WHERE user_id = 'u_pmx' AND account_id = ? AND role <> 'contractor'`).get(pmId));
  const gcCo = db.prepare(`SELECT company_id FROM accounts WHERE id = 'acc_gc'`).get().company_id;
  ck("a management account is not given a company row", !a.company_id && !!gcCo, `${a.company_id} ${gcCo}`);
  const en = db.prepare(`SELECT status, categories FROM engagements WHERE account_id = ? AND company_id = ?`).get(pmId, gcCo);
  ck("the management side hires the construction side, active, under its trades",
    en?.status === "active" && en.categories === '["roofing","painting"]', JSON.stringify(en));
  const crew = db.prepare(`SELECT user_id FROM memberships WHERE account_id = ? AND role = 'contractor' ORDER BY user_id`).all(pmId)
    .map((x) => x.user_id);
  // The owner is already its admin, and a person holds one seat per account:
  // the construction side's work reaches them at home, as client work.
  ck("the rest of the construction team is seated there as contractors", JSON.stringify(crew) === JSON.stringify(["u_pmx"]),
    JSON.stringify(crew));
  const link = db.prepare(`SELECT * FROM business_links`).all();
  ck("one link row, construction first", link.length === 1 && link[0].account_a === "acc_gc" && link[0].account_b === pmId);
  const again = await call(env, "/api/account/second-business", { method: "POST",
    body: { name: "Third", subdomain: "ruddthree", kind: "building_owner" } });
  ck("a second pair is refused", again.status === 409 && again.body.error === "already_linked");
  const fromOther = await call(env, "/api/account/second-business", { method: "POST", seat: ["u_marc", pmId],
    body: { name: "Third", subdomain: "ruddthree", kind: "general_contractor" } });
  ck("from either side", fromOther.status === 409 && fromOther.body.error === "already_linked");
  const view = await call(env, "/api/account/second-business");
  ck("the account reads the pair", view.status === 200 && view.body.linked?.other?.id === pmId
    && view.body.linked.cheaper === "this" && view.body.linked.discountOn === null, JSON.stringify(view.body));
  ck("the invariant reads zero", runCheck(db).m099_inv_bad_link === 0);
  db.exec(`INSERT INTO business_links(id,account_a,account_b) VALUES ('bad','acc_pm2','acc_pm2')`);
  ck("and counts an account paired with itself", runCheck(db).m099_inv_bad_link >= 1);
  db.exec(`DELETE FROM business_links WHERE id = 'bad'`);

  console.log("\n-- the discount --");
  db.exec(`UPDATE accounts SET plan = 'scale', stripe_subscription_id = 'sub_gc', stripe_customer_id = 'cus_acc_gc', subscription_status = 'active' WHERE id = 'acc_gc'`);
  calls = [];
  ck("one paying: webhook ok", await hook(env, subEvent("acc_gc", "sub_gc", "active", 1)) === 200);
  ck("nothing is discounted while only one pays", subCalls().length === 0
    && db.prepare(`SELECT discount_on FROM business_links`).get().discount_on === null);

  db.exec(`UPDATE accounts SET stripe_subscription_id = 'sub_pm', stripe_customer_id = 'cus_${pmId}' WHERE id = '${pmId}'`);
  await hook(env, subEvent(pmId, "sub_pm", "active", 2));
  const on = subCalls();
  ck("both paying: the cheaper (construction) one gets the coupon",
    on.length === 1 && /sub_gc$/.test(on[0].url) && decodeURIComponent(on[0].body) === `discounts[0][coupon]=${LINKED_COUPON_ID}`,
    JSON.stringify(on));
  ck("the coupon is made once, 50% forever", coupons[LINKED_COUPON_ID]?.percent_off === 50
    && coupons[LINKED_COUPON_ID].duration === "forever");
  ck("and recorded", db.prepare(`SELECT discount_on FROM business_links`).get().discount_on === "acc_gc");
  calls = [];
  await hook(env, subEvent(pmId, "sub_pm", "active", 3));
  ck("an unchanged answer tells Stripe nothing", subCalls().length === 0);

  const plat = (await call(env, "/api/billing")).body;
  ck("the billing read says this one is discounted", plat.linked?.discountOn === "this", JSON.stringify(plat.linked));

  // The management side canceled: the discount comes off.
  calls = [];
  await hook(env, subEvent(pmId, "sub_pm", "canceled", 4));
  const off = subCalls();
  ck("one stops paying: the discount comes off", off.length === 1 && /sub_gc$/.test(off[0].url)
    && off[0].body === "discounts=" && db.prepare(`SELECT discount_on FROM business_links`).get().discount_on === null,
    JSON.stringify(off));

  console.log("\n-- the checkout of the cheaper one carries it --");
  db.exec(`UPDATE accounts SET plan = 'basic', stripe_subscription_id = NULL, subscription_status = NULL WHERE id = 'acc_gc';
           UPDATE accounts SET plan = 'scale', stripe_subscription_id = 'sub_pm', subscription_status = 'active' WHERE id = '${pmId}';`);
  calls = [];
  const co = await call(env, "/api/billing/checkout", { method: "POST", body: { cycle: "monthly" } });
  const sess = calls.find((c) => /checkout\/sessions$/.test(c.url));
  const sb = decodeURIComponent(sess?.body || "");
  ck("checkout ok", co.status === 200, JSON.stringify(co.body));
  ck("with the coupon on, and no promotion code box", sb.includes(`discounts[0][coupon]=${LINKED_COUPON_ID}`)
    && !sb.includes("allow_promotion_codes"), sb.slice(0, 300));
  calls = [];
  await call(env, "/api/billing/checkout", { method: "POST", seat: ["u_marc", pmId], body: { cycle: "monthly" } });
  const sb2 = decodeURIComponent(calls.find((c) => /checkout\/sessions$/.test(c.url))?.body || "");
  ck("the dearer one checks out at full price", !sb2.includes("discounts") && sb2.includes("allow_promotion_codes"));
}

{
  console.log("\n-- the console's door --");
  const db = seed(); const env = ENV(db);
  db.exec(`UPDATE users SET auth_id = 'auth_staff' WHERE id = 'u_o';
           INSERT INTO users(id,name,email,auth_id) VALUES ('u_staff','Staff','staff@subsub.test','auth_staff2');
           INSERT INTO superadmins(user_id,role,finance,impersonate) VALUES ('u_staff','superadmin',1,1);`);
  const staffEnv = { ...env, SUPABASE_URL: "http://supa.test", SUPABASE_ANON_KEY: "anon", STAFF_ALLOW_PASSWORD: "1" };
  const prev = globalThis.fetch;
  globalThis.fetch = async (url, init) => String(url).endsWith("/auth/v1/user")
    ? json({ id: "auth_staff2", email: "staff@subsub.test" }) : prev(url, init);
  const res = await worker.fetch(new Request("https://api.subsub.work/api/platform/accounts/acc_pm2/second-business", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer staff" },
    body: JSON.stringify({ name: "Other Build", subdomain: "otherbuild", kind: "general_contractor" }) }), staffEnv);
  const body = await res.json().catch(() => ({}));
  globalThis.fetch = prev;
  ck("staff add it for the account's admin", res.status === 201, `${res.status} ${JSON.stringify(body)}`);
  ck("who becomes admin of the new one",
    db.prepare(`SELECT role FROM memberships WHERE user_id = 'u_o' AND account_id = ?`).get(body.id)?.role === "admin");
  const co = db.prepare(`SELECT company_id FROM accounts WHERE id = ?`).get(body.id)?.company_id;
  ck("and the existing management account hires the new construction company",
    db.prepare(`SELECT status FROM engagements WHERE account_id = 'acc_pm2' AND company_id = ?`).get(co)?.status === "active");
}

{
  console.log("\n-- a database without 099 --");
  const db = seed({ migrated: false }); const env = ENV(db);
  const r = await call(env, "/api/account/second-business", { method: "POST",
    body: { name: "Rudd PM", subdomain: "ruddpm", kind: "property_manager" } });
  ck("names the file and makes nothing", r.status === 503 && r.body.migration === "099_business_links"
    && !db.prepare(`SELECT 1 FROM accounts WHERE subdomain = 'ruddpm'`).get(), JSON.stringify(r.body));
  ck("and the billing read still answers", (await call(env, "/api/billing")).status === 200);
}

{
  console.log("\n-- 101: a second business made before the titles stopped being copied --");
  const db = seed();
  db.exec(`
    INSERT INTO accounts(id,name,subdomain,kind,plan,billing,theme) VALUES
      ('acc_b1','Sound Maintenance','soundm','general_contractor','basic','monthly',
       '{"accent":"#123456","signInTitle":"Rudd-Development-Sign-in","applyTitle":"Rudd-Development-Sign-up"}'),
      ('acc_b2','Own Titles','owntitles','property_manager','basic','monthly',
       '{"accent":"#123456","signInTitle":"Typed since","applyTitle":"Rudd-Development-Sign-up"}');
    INSERT INTO business_links(id,account_a,account_b) VALUES ('l1','acc_gc','acc_b1');
  `);
  ck("the invariant counts it before the paste", runCheck(db).m101_inv_linked_titles_copied === 1);
  // acc_b2 is in no pair, so its matching title is left exactly as it is.
  db.exec(readFileSync(new URL("../worker/migrations/101_linked_titles.sql", import.meta.url), "utf8"));
  const t1 = JSON.parse(db.prepare(`SELECT theme FROM accounts WHERE id='acc_b1'`).get().theme);
  ck("101 takes the copied titles off and keeps the colors",
    !("signInTitle" in t1) && !("applyTitle" in t1) && t1.accent === "#123456", JSON.stringify(t1));
  const ta = JSON.parse(db.prepare(`SELECT theme FROM accounts WHERE id='acc_gc'`).get().theme);
  ck("and leaves the first business's own titles", ta.signInTitle === "Rudd-Development-Sign-in");
  const t2 = JSON.parse(db.prepare(`SELECT theme FROM accounts WHERE id='acc_b2'`).get().theme);
  ck("and an account in no pair", t2.applyTitle === "Rudd-Development-Sign-up");
  db.exec(`UPDATE accounts SET theme = '{"accent":"#123456","signInTitle":"Typed since"}' WHERE id='acc_b1'`);
  db.exec(readFileSync(new URL("../worker/migrations/101_linked_titles.sql", import.meta.url), "utf8"));
  ck("a title typed since is not a copy and stays",
    JSON.parse(db.prepare(`SELECT theme FROM accounts WHERE id='acc_b1'`).get().theme).signInTitle === "Typed since");
  ck("the invariant reads zero after", runCheck(db).m101_inv_linked_titles_copied === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
