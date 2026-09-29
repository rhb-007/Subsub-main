// Connecting a Stripe account, which is how a subcontractor becomes payable.
//
// Onboarding only -- no funding, no transfers, no payouts. What this covers
// is the handful of properties that are easy to destroy by accident and that
// no screen can report:
//
//   RETURNING FROM STRIPE IS NOT FINISHING. Stripe sends somebody back to
//   `return_url` whether they completed the form or abandoned it on the
//   second screen, so nothing may read the return as success.
//
//   PAYABLE NEEDS BOTH CAPABILITIES. `transfers` active is money reaching
//   their Stripe balance; `payouts_enabled` is money leaving it for their
//   bank. One without the other looks paid from our side and unpaid from
//   theirs, and the two are asserted separately because either alone
//   passing would hide exactly that.
//
//   IT IS NOT A LATCH. Stripe asks for more as volume grows, so an account
//   that was payable last month can stop being.
//
//   ONE CONNECTED ACCOUNT PER COMPANY. Two is two places the money could go
//   with nothing saying which.
//
// Stripe is stubbed at `fetch`, which is the boundary `billing.js` actually
// uses -- so the request shape is assertable, including the idempotency key
// and which calls carry `Stripe-Account`.
//
//   node --no-warnings scripts/payout-onboard-test.mjs

import { readFileSync } from "node:fs";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");
const pay = await import("../shared/pay.js");
const SCHEMA = readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8");
const M050 = readFileSync(new URL("../worker/migrations/050_payout_accounts.sql", import.meta.url), "utf8");

const seed = () => {
  const db = freshDb({ base: SCHEMA, migrations: [M050] });
  db.exec(`
    INSERT INTO accounts(id,name,subdomain,kind,plan) VALUES
      ('acc_sub','Bay Roofing','bay','subcontractor','basic'),
      ('acc_gc','Outerhome','outerhome','general_contractor','scale'),
      ('acc_pm','Cascade Management','cascade','property_manager','scale');
    INSERT INTO users(id,name,email) VALUES
      ('u_ad','Rae','rae@bay.test'), ('u_pm','Sam','sam@bay.test'),
      ('u_pmadmin','Jo','jo@cascade.test');
    INSERT INTO memberships(id,user_id,account_id,role) VALUES
      ('m_ad','u_ad','acc_sub','admin'),
      ('m_pm','u_pm','acc_sub','pm'),
      ('m_pmadmin','u_pmadmin','acc_pm','admin');
  `);
  return db;
};

// ---- the Stripe stub ------------------------------------------------------
//
// Records every call so the request shape can be asserted, and answers with
// whatever the current test wants the account to look like.
const realFetch = globalThis.fetch;
let calls = [];
let acctState = {};
let failNext = null;

globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (!u.includes("stripe")) return realFetch(url, init);
  const body = Object.fromEntries(new URLSearchParams(init.body || ""));
  calls.push({ url: u, method: init.method || "POST", headers: init.headers || {}, body });

  if (failNext) { const f = failNext; failNext = null; return f; }

  const json = (o, status = 200) =>
    new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });

  if (/\/accounts$/.test(u) && (init.method || "POST") === "POST") {
    return json({ id: "acct_bay1", ...acctState });
  }
  if (/\/accounts\/acct_\w+$/.test(u)) return json({ id: "acct_bay1", ...acctState });
  if (/\/account_links$/.test(u)) {
    return json({ url: `https://connect.stripe.com/setup/e/${Math.random().toString(16).slice(2)}` });
  }
  return json({ error: { message: "stub has no route for " + u } }, 404);
};

const ENV = (db) => ({ DB: makeD1(db), STRIPE_SECRET_KEY: "sk_test_x",
  STRIPE_CONNECT_WEBHOOK_SECRET: "whsec_connect" });

const call = async (env, path, { method = "GET", seat = { u: "u_ad", a: "acc_sub" }, body } = {}) => {
  const res = await worker.fetch(new Request(`https://api.subsub.work${path}`, {
    method,
    headers: { "X-User-Id": seat.u, "X-Account-Id": seat.a, "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }), env);
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

// Stripe's own signature scheme: HMAC-SHA256 over `<timestamp>.<raw body>`.
async function signed(secret, payload, tsOffset = 0) {
  const raw = JSON.stringify(payload);
  const t = Math.floor(Date.now() / 1000) + tsOffset;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${raw}`));
  const hex = Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
  return { raw, header: `t=${t},v1=${hex}` };
}

const hook = async (env, payload, { secret = "whsec_connect", tsOffset = 0, header } = {}) => {
  const s = await signed(secret, payload, tsOffset);
  const res = await worker.fetch(new Request("https://api.subsub.work/api/stripe/connect-webhook", {
    method: "POST",
    headers: { "stripe-signature": header ?? s.header, "Content-Type": "application/json" },
    body: s.raw,
  }), env);
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

const READY = { payouts_enabled: true, capabilities: { transfers: "active" }, requirements: {} };

// ---- the rules module, on its own -----------------------------------------
{
  console.log("\n-- payable needs both halves --");
  ck("both active is payable", pay.payoutsReady(READY));
  ck("payouts enabled with transfers pending is NOT",
    !pay.payoutsReady({ payouts_enabled: true, capabilities: { transfers: "pending" } }));
  ck("transfers active with payouts disabled is NOT",
    !pay.payoutsReady({ payouts_enabled: false, capabilities: { transfers: "active" } }));
  ck("and the status follows", pay.payoutStatus(READY) === "verified", pay.payoutStatus(READY));
  ck("a rejected account is rejected, not pending",
    pay.payoutStatus({ payouts_enabled: false, requirements: { disabled_reason: "rejected.fraud" } }) === "rejected");
  ck("and rejection outranks being otherwise ready",
    pay.payoutStatus({ ...READY, requirements: { disabled_reason: "rejected.other" } }) === "rejected");
  ck("a merely restricted account is pending",
    pay.payoutStatus({ payouts_enabled: false, requirements: { disabled_reason: "requirements.past_due" } }) === "pending");

  console.log("\n-- and what Stripe is waiting for is readable --");
  const due = pay.requirementsDue({ requirements: {
    past_due: ["individual.verification.document"],
    currently_due: ["individual.verification.document", "external_account"],
    eventually_due: ["company.tax_id"],
  } });
  ck("past due and currently due, deduplicated", due.length === 2, JSON.stringify(due));
  ck("and eventually-due is left out", !due.includes("company.tax_id"));
  ck("a machine key is given words",
    pay.requirementLabel("individual.verification.document") === "A photo ID");
  ck("an unknown key is still readable rather than dropped",
    pay.requirementLabel("individual.political_exposure") === "Individual political exposure",
    pay.requirementLabel("individual.political_exposure"));
}

// ---- who may ask ----------------------------------------------------------
{
  console.log("\n-- who may connect one --");
  const env = ENV(seed());
  const none = await call(env, "/api/payouts/status");
  ck("a hireable account with nothing connected reads none",
    none.status === 200 && none.body.status === "none" && none.body.ready === false,
    `${none.status} ${JSON.stringify(none.body)}`);

  const pm = await call(env, "/api/payouts/status", { seat: { u: "u_pm", a: "acc_sub" } });
  ck("a project manager cannot reach it", pm.status === 403, String(pm.status));

  const mgr = await call(env, "/api/payouts/status", { seat: { u: "u_pmadmin", a: "acc_pm" } });
  ck("and an account nobody can hire is told why, not forbidden",
    mgr.status === 409 && mgr.body.error === "not_hireable",
    `${mgr.status} ${mgr.body.error}`);
}

// ---- connecting -----------------------------------------------------------
{
  console.log("\n-- connecting --");
  const db = seed(); const env = ENV(db);
  acctState = { payouts_enabled: false, capabilities: { transfers: "pending" },
    requirements: { currently_due: ["external_account"] } };
  calls = [];

  const first = await call(env, "/api/payouts/connect", { method: "POST" });
  ck("it hands back a link", first.status === 200 && /^https:\/\/connect\.stripe\.com\//.test(first.body.url || ""),
    `${first.status} ${first.body.url || first.body.error}`);

  const made = calls.filter((x) => /\/accounts$/.test(x.url));
  ck("one connected account was created", made.length === 1, String(made.length));
  ck("asking only for transfers, never card payments",
    made[0]?.body["capabilities[transfers][requested]"] === "true"
    && !Object.keys(made[0]?.body || {}).some((k) => k.startsWith("capabilities[card_payments]")));
  ck("with Stripe collecting the identity data",
    made[0]?.body["controller[requirement_collection]"] === "stripe");
  ck("and an idempotency key keyed on the company, so a double press cannot mint two",
    /^payout-acct:/.test(made[0]?.headers["Idempotency-Key"] || ""),
    made[0]?.headers["Idempotency-Key"]);
  ck("creating the account is the platform's own call, not one made AS them",
    !("Stripe-Account" in (made[0]?.headers || {})));

  const stored = db.prepare(`SELECT * FROM payout_accounts`).all();
  ck("the row records which Stripe account is theirs",
    stored.length === 1 && stored[0].processor_account_id === "acct_bay1",
    JSON.stringify(stored.map((r) => r.processor_account_id)));
  ck("and it is pending, because Stripe has not cleared them",
    stored[0]?.kyc_status === "pending", stored[0]?.kyc_status);

  // The link is minted fresh and never kept: it is single-use and expires in
  // minutes, so a stored one is a dead button with nothing saying why.
  calls = [];
  const second = await call(env, "/api/payouts/connect", { method: "POST" });
  ck("pressing again does NOT create a second connected account",
    calls.filter((x) => /\/accounts$/.test(x.url)).length === 0);
  ck("but does mint a fresh link", second.body.url && second.body.url !== first.body.url,
    `${String(second.body.url).slice(-8)} vs ${String(first.body.url).slice(-8)}`);
  ck("and no link is stored anywhere on the row",
    !JSON.stringify(db.prepare(`SELECT * FROM payout_accounts`).all()).includes("connect.stripe.com"));
  ck("still one row", db.prepare(`SELECT COUNT(*) AS n FROM payout_accounts`).get().n === 1);

  const link = calls.find((x) => /\/account_links$/.test(x.url));
  ck("the return comes back into the app", /\/\?payouts=return$/.test(link?.body.return_url || ""),
    link?.body.return_url);
  ck("and a stale link lands somewhere that mints another",
    /\/\?payouts=refresh$/.test(link?.body.refresh_url || ""), link?.body.refresh_url);
}

// ---- coming back ----------------------------------------------------------
{
  console.log("\n-- coming back from Stripe proves nothing on its own --");
  const db = seed(); const env = ENV(db);
  acctState = { payouts_enabled: false, capabilities: { transfers: "pending" },
    requirements: { currently_due: ["individual.verification.document"] } };
  await call(env, "/api/payouts/connect", { method: "POST" });

  // Somebody who abandoned the form is sent to return_url exactly as somebody
  // who finished it is. The only honest answer is to go and ask.
  const gaveUp = await call(env, "/api/payouts/refresh", { method: "POST" });
  ck("an abandoned onboarding still reads pending",
    gaveUp.status === 200 && gaveUp.body.status === "pending" && gaveUp.body.ready === false,
    `${gaveUp.status} ${gaveUp.body.status}`);
  ck("and it says what Stripe is waiting for, in words",
    (gaveUp.body.requirements || [])[0]?.label === "A photo ID",
    JSON.stringify(gaveUp.body.requirements));

  acctState = READY;
  const done = await call(env, "/api/payouts/refresh", { method: "POST" });
  ck("finishing it reads verified", done.body.status === "verified" && done.body.ready === true,
    `${done.body.status} ready=${done.body.ready}`);

  // Not a latch.
  acctState = { payouts_enabled: false, capabilities: { transfers: "active" },
    requirements: { currently_due: ["company.tax_id"] } };
  const back = await call(env, "/api/payouts/refresh", { method: "POST" });
  ck("and Stripe taking it away takes it away here too",
    back.body.status === "pending" && back.body.ready === false, back.body.status);
  ck("the stored row agrees rather than keeping the old answer",
    db.prepare(`SELECT kyc_status FROM payout_accounts`).get().kyc_status === "pending");

  const never = await call(ENV(seed()), "/api/payouts/refresh", { method: "POST" });
  ck("refreshing before anything was connected says so",
    never.status === 409 && never.body.error === "not_started", `${never.status} ${never.body.error}`);
}

// ---- rejection ------------------------------------------------------------
{
  console.log("\n-- a rejected account is not sent round the form again --");
  const db = seed(); const env = ENV(db);
  acctState = { payouts_enabled: false, capabilities: { transfers: "inactive" },
    requirements: { disabled_reason: "rejected.fraud" } };
  await call(env, "/api/payouts/connect", { method: "POST" });
  await call(env, "/api/payouts/refresh", { method: "POST" });
  ck("the row says rejected",
    db.prepare(`SELECT kyc_status FROM payout_accounts`).get().kyc_status === "rejected");
  const again = await call(env, "/api/payouts/connect", { method: "POST" });
  ck("and connecting again is refused rather than handed a useless link",
    again.status === 409 && again.body.error === "rejected", `${again.status} ${again.body.error}`);
}

// ---- the webhook ----------------------------------------------------------
{
  console.log("\n-- the Connect webhook --");
  const db = seed(); const env = ENV(db);
  acctState = { payouts_enabled: false, capabilities: { transfers: "pending" }, requirements: {} };
  await call(env, "/api/payouts/connect", { method: "POST" });

  const evt = (id, obj) => ({ id, type: "account.updated", data: { object: obj } });

  const bad = await hook(env, evt("evt_1", { id: "acct_bay1", ...READY }), { secret: "whsec_wrong" });
  ck("a wrong signature is refused", bad.status === 400 && bad.body.error === "bad_signature",
    `${bad.status} ${bad.body.error}`);
  ck("and nothing was written",
    db.prepare(`SELECT kyc_status FROM payout_accounts`).get().kyc_status === "pending");

  const stale = await hook(env, evt("evt_2", { id: "acct_bay1", ...READY }), { tsOffset: -3600 });
  ck("a replayed old one is refused too", stale.status === 400, String(stale.status));

  const ok = await hook(env, evt("evt_3", { id: "acct_bay1", ...READY }));
  ck("a good one is accepted", ok.status === 200 && ok.body.ok === true, String(ok.status));
  ck("and it updates the row without anybody pressing anything",
    db.prepare(`SELECT kyc_status FROM payout_accounts`).get().kyc_status === "verified");

  // Stripe delivers the same event twice on its own.
  acctState = {};
  const dupe = await hook(env, evt("evt_3", { id: "acct_bay1",
    payouts_enabled: false, capabilities: {}, requirements: {} }));
  ck("the same event id is not applied twice",
    dupe.status === 200 && dupe.body.duplicate === true, JSON.stringify(dupe.body));
  ck("so a redelivery cannot undo what it already did",
    db.prepare(`SELECT kyc_status FROM payout_accounts`).get().kyc_status === "verified");

  // Stripe sends account.updated for every connected account on the platform.
  const unknown = await hook(env, evt("evt_4", { id: "acct_somebody_else", ...READY }));
  ck("an account we hold no row for is accepted quietly", unknown.status === 200, String(unknown.status));
  ck("and no row is invented for it",
    db.prepare(`SELECT COUNT(*) AS n FROM payout_accounts`).get().n === 1);
}

// ---- when the pieces are not there ---------------------------------------
{
  console.log("\n-- and when something is not configured --");
  const noKey = { DB: makeD1(seed()), STRIPE_CONNECT_WEBHOOK_SECRET: "whsec_connect" };
  const r = await call(noKey, "/api/payouts/connect", { method: "POST" });
  ck("no Stripe key is 501, not a crash",
    r.status === 501 && r.body.error === "billing_not_configured", `${r.status} ${r.body.error}`);

  const noHook = { DB: makeD1(seed()), STRIPE_SECRET_KEY: "sk_test_x" };
  const h = await hook(noHook, { id: "evt_x", type: "account.updated", data: { object: {} } });
  ck("and no Connect signing secret is 501", h.status === 501, String(h.status));

  // A database that has not had 050 pasted in.
  const old = freshDb({ base: SCHEMA, migrations: [] });
  old.exec(`
    INSERT INTO accounts(id,name,subdomain,kind,plan) VALUES ('acc_sub','Bay','bay','subcontractor','basic');
    INSERT INTO users(id,name,email) VALUES ('u_ad','Rae','rae@bay.test');
    INSERT INTO memberships(id,user_id,account_id,role) VALUES ('m_ad','u_ad','acc_sub','admin');
    DROP TABLE IF EXISTS payout_accounts;
  `);
  const pre = await call(ENV(old), "/api/payouts/status");
  ck("a database without 050 is told which migration, not 500",
    pre.status === 503 && pre.body.migration === "050_payout_accounts",
    `${pre.status} ${pre.body.migration || pre.body.error}`);
}

globalThis.fetch = realFetch;
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
