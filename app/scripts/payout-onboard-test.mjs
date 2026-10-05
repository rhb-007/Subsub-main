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
const { PAYOUT_ACCOUNT, payoutAccountKey, STRIPE_V2_VERSION } = pay;
// `ownCompanyId` in the Worker: the subcontractor account's own company row.
const BAY_COMPANY = "cmp_own_acc_sub";
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
// When set, `failNext` waits for a request whose URL matches -- so a test can
// refuse the one call it is about rather than whichever call happens first.
let failMatch = null;

// ACCOUNTS V2. The tests below describe an account in the v1 shape they were
// written in -- `payouts_enabled`, `capabilities.transfers`,
// `requirements.currently_due` -- and the stub answers a v2 request with the
// same account in v2's shape, field names as Stripe's own SDK types give them.
// So every assertion about what a state MEANS is unchanged, and what changed
// is only the wire, which is the half the new assertions pin.
const DESCRIPTIONS = {
  "individual.verification.document": "Provide a government-issued photo ID",
  "external_account": "Add a bank account to receive payouts",
  "company.tax_id": "Provide the company's tax ID",
};
const toV2 = (st, id = "acct_bay1") => {
  const transfers = st.capabilities?.transfers || "inactive";
  const rejected = /^rejected\./.test(st.requirements?.disabled_reason || "");
  const code = rejected ? "rejected_" + st.requirements.disabled_reason.split(".")[1] : null;
  const cap = (status) => ({ status: rejected ? "rejected" : status,
    status_details: rejected ? [{ code, resolution: "contact_stripe" }] : [] });
  const entry = (k, deadline) => ({ awaiting_action_from: "user", description: DESCRIPTIONS[k] || k,
    errors: [], impact: {}, minimum_deadline: { status: deadline }, requested_reasons: [] });
  return {
    object: "v2.core.account", id,
    configuration: { recipient: { applied: true, capabilities: { stripe_balance: {
      stripe_transfers: cap(transfers === "active" ? "active" : transfers === "inactive" ? "restricted" : "pending"),
      payouts: cap(st.payouts_enabled ? "active" : "pending"),
    } } } },
    requirements: { entries: [
      ...(st.requirements?.past_due || []).map((k) => entry(k, "past_due")),
      ...(st.requirements?.currently_due || []).map((k) => entry(k, "currently_due")),
      ...(st.requirements?.eventually_due || []).map((k) => entry(k, "eventually_due")),
    ] },
  };
};

globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (!u.includes("stripe")) return realFetch(url, init);
  const isJson = /json/.test((init.headers || {})["Content-Type"] || "");
  const body = isJson ? JSON.parse(init.body || "{}") : Object.fromEntries(new URLSearchParams(init.body || ""));
  calls.push({ url: u, method: init.method || "POST", headers: init.headers || {}, body });

  // A Response, or a function returning one -- the latter so a test can make
  // something happen at the moment Stripe refuses, which is the only way to
  // stage a race against a concurrent press.
  if (failNext && (!failMatch || failMatch.test(u))) {
    const f = failNext; failNext = null; failMatch = null;
    return typeof f === "function" ? await f() : f;
  }

  const json = (o, status = 200) =>
    new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });

  if (/\/v2\/core\/accounts$/.test(u) && (init.method || "POST") === "POST") return json(toV2(acctState));
  // An account minted under v1, before the move: v2 does not answer for it
  // here, and the old GET does.
  const v2get = u.match(/\/v2\/core\/accounts\/(acct_\w+)/);
  if (v2get) return v2get[1].startsWith("acct_old")
    ? json({ error: { message: "No such account" } }, 404)
    : json(toV2(acctState, v2get[1]));
  if (/\/v2\/core\/account_links$/.test(u)) {
    return json({ object: "v2.core.account_link",
      url: `https://connect.stripe.com/setup/e/${Math.random().toString(16).slice(2)}` });
  }
  if (/\/accounts$/.test(u) && (init.method || "POST") === "POST") {
    return json({ id: "acct_bay1", ...acctState });
  }
  if (/\/accounts\/acct_\w+$/.test(u)) return json({ id: u.split("/").pop(), ...acctState });
  if (/\/account_sessions$/.test(u)) {
    return json({ object: "account_session", account: "acct_bay1",
      client_secret: "acct_sess_secret_abc" });
  }
  if (/\/account_links$/.test(u)) {
    return json({ url: `https://connect.stripe.com/setup/e/${Math.random().toString(16).slice(2)}` });
  }
  return json({ error: { message: "stub has no route for " + u } }, 404);
};

const ENV = (db) => ({ DB: makeD1(db), STRIPE_SECRET_KEY: "sk_test_x",
  STRIPE_CONNECT_WEBHOOK_SECRET: "whsec_connect" });

const call = async (env, path, { method = "GET", seat = { u: "u_ad", a: "acc_sub" }, body, imp } = {}) => {
  const res = await worker.fetch(new Request(`https://api.subsub.work${path}`, {
    method,
    headers: imp
      // Staff stand in through a real `impersonation_sessions` row, never a
      // header: the caller names a TOKEN and the row says who is really
      // there, so there is nothing a customer can send to claim it.
      ? { "X-Impersonation-Token": imp, "Content-Type": "application/json" }
      : { "X-User-Id": seat.u, "X-Account-Id": seat.a, "Content-Type": "application/json" },
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

// ---- and v2's shape reads the same way ---------------------------------------
{
  console.log("\n-- an Accounts v2 reply means what a v1 one meant --");
  const v2 = (o) => pay.rowFromStripe(o);
  const ready = v2(toV2(READY));
  ck("transfers and payouts both active is verified",
    ready.kycStatus === "verified" && ready.transfersActive === 1 && ready.payoutsEnabled === 1, JSON.stringify(ready));
  const half = v2(toV2({ payouts_enabled: false, capabilities: { transfers: "active" } }));
  ck("transfers active with payouts pending is NOT payable -- both halves, as before",
    half.kycStatus === "pending" && half.transfersActive === 1 && half.payoutsEnabled === 0, JSON.stringify(half));
  const rej = v2(toV2({ requirements: { disabled_reason: "rejected.fraud" } }));
  ck("a rejected capability reads rejected, with the reason carried",
    rej.kycStatus === "rejected" && rej.disabledReason === "rejected.fraud", JSON.stringify(rej));
  const due = JSON.parse(v2(toV2({ capabilities: { transfers: "pending" }, requirements: {
    past_due: ["individual.verification.document"], currently_due: ["external_account"],
    eventually_due: ["company.tax_id"] } })).requirements);
  ck("what is due now is listed in Stripe's own words",
    due.length === 2 && due.includes("Provide a government-issued photo ID"), JSON.stringify(due));
  ck("and eventually-due is left out, as it is for v1", !due.includes("Provide the company's tax ID"));
  const waiting = toV2({ capabilities: { transfers: "pending" }, requirements: { currently_due: ["external_account"] } });
  waiting.requirements.entries[0].awaiting_action_from = "stripe";
  ck("and a thing Stripe is doing is not put in front of the subcontractor",
    JSON.parse(v2(waiting).requirements).length === 0);
  ck("a sentence is shown as written rather than tidied like a field key",
    pay.requirementLabel("Provide a government-issued photo ID.") === "Provide a government-issued photo ID.");
  ck("and a v1 account still reads exactly as it did",
    JSON.stringify(v2(READY)) === JSON.stringify(pay.rowFromStripe({ ...READY })) && v2(READY).kycStatus === "verified");
  // Payouts not reported at all is not payouts refused.
  const noPayouts = toV2(READY);
  delete noPayouts.configuration.recipient.capabilities.stripe_balance.payouts;
  ck("a payouts capability Stripe has not reported follows transfers rather than reading refused",
    v2(noPayouts).kycStatus === "verified", JSON.stringify(v2(noPayouts)));
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
  ck("through Accounts v2, because v1 creation is closed to live platforms",
    /\/v2\/core\/accounts$/.test(made[0]?.url || ""), made[0]?.url);
  ck("as JSON with the API version Stripe's SDK pins for these field names",
    made[0]?.headers["Stripe-Version"] === STRIPE_V2_VERSION
    && /json/.test(made[0]?.headers["Content-Type"] || ""),
    JSON.stringify(made[0]?.headers["Stripe-Version"]));
  ck("asking only to receive transfers, never anything merchant-shaped",
    made[0]?.body?.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers?.requested === true
    && !("merchant" in (made[0]?.body?.configuration || {})),
    JSON.stringify(made[0]?.body?.configuration));
  ck("and the reply carries what the row is written from",
    JSON.stringify(made[0]?.body?.include) === JSON.stringify(["configuration.recipient", "requirements"]),
    JSON.stringify(made[0]?.body?.include));

  // THE COMBINATION IS WHAT STRIPE VALIDATES, NOT THE FIELDS ONE AT A TIME.
  //
  // `requirement_collection` and `stripe_dashboard` were each pinned here and
  // `losses.payments` was not -- so the one field Stripe refuses was the one
  // field nothing asserted, and the panel shipped dead behind a green suite:
  //
  //   "When stripe_dashboard[type]=none and requirement_collection=stripe,
  //    Stripe must be liable for negative balances or refunds and chargebacks."
  //
  // Asserted as the RULE rather than as three separate values, because that is
  // the shape of the thing that can be wrong.
  ck("Stripe carries the negative balances, refunds and chargebacks",
    made[0]?.body?.defaults?.responsibilities?.losses_collector === "stripe",
    made[0]?.body?.defaults?.responsibilities?.losses_collector);
  ck("and SubSub still pays Stripe's fee -- the two are separate questions",
    made[0]?.body?.defaults?.responsibilities?.fees_collector === "application",
    made[0]?.body?.defaults?.responsibilities?.fees_collector);
  {
    const c0 = made[0]?.body || {};
    const noDash = c0.dashboard === "none";
    const stripeLoss = c0.defaults?.responsibilities?.losses_collector === "stripe";
    ck("the combination is one Stripe actually accepts -- no dashboard means Stripe carries the loss",
      !noDash || stripeLoss, JSON.stringify({ noDash, stripeLoss }));
  }
  ck("and registered as a US account",
    made[0]?.body?.identity?.country === "us", JSON.stringify(made[0]?.body?.identity));
  // THE KEY CARRIES THE CONTROLLER'S SHAPE, and that is not decoration.
  //
  // Stripe saves the status and body of the first request made under a key
  // and replays them for 24 hours -- a refusal as faithfully as a success.
  // The controller above shipped wrong once; it was corrected and deployed,
  // and the panel then drew the identical refusal, because Stripe was
  // answering the superseded request. A key that is only the company id
  // cannot be got past, and on screen a replay and a live refusal are the
  // same sentence.
  //
  // `/^payout-acct:/` was the assertion here and it passed either way, which
  // is why the property below is asserted against `payoutAccountKey` itself
  // rather than against a prefix.
  {
    const key = made[0]?.headers["Idempotency-Key"] || "";
    ck("the idempotency key is the one shared/pay.js derives, not a second opinion",
      key === payoutAccountKey(BAY_COMPANY), key);
    ck("it is keyed on the company, so a double press cannot mint two",
      key === payoutAccountKey(BAY_COMPANY) && key.includes(BAY_COMPANY), key);
    ck("and on the shape, so a corrected shape is not answered by the old refusal",
      key !== payoutAccountKey(BAY_COMPANY, { ...PAYOUT_ACCOUNT,
        defaults: { ...PAYOUT_ACCOUNT.defaults, responsibilities: { fees_collector: "application", losses_collector: "application" } } }),
      key);
    // Stripe's limit. A company id is not short and neither is the shape.
    ck("and it fits in an idempotency key, even a long company id with the retry suffix on it",
      key.length > 0 && (payoutAccountKey("cmp_own_" + "x".repeat(60)) + ":r" + Date.now()).length <= 255, key.length);
  }
  // Two properties of the derivation itself, because the integration check
  // above holds for a key that is constant per company however it was built.
  ck("the same company and the same controller give the same key",
    payoutAccountKey("cmp_x") === payoutAccountKey("cmp_x"));
  ck("two companies never share one",
    payoutAccountKey("cmp_x") !== payoutAccountKey("cmp_y"));
  ck("and reordering the shape is not a change",
    payoutAccountKey("cmp_x", PAYOUT_ACCOUNT)
      === payoutAccountKey("cmp_x", Object.fromEntries(Object.entries(PAYOUT_ACCOUNT).reverse())));
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

  const link = calls.find((x) => /\/v2\/core\/account_links$/.test(x.url));
  const onb = link?.body?.use_case?.account_onboarding || {};
  ck("the link is a v2 onboarding link for that account",
    link?.body?.account === "acct_bay1" && link?.body?.use_case?.type === "account_onboarding",
    JSON.stringify(link?.body));
  ck("the return comes back into the app", /\/\?payouts=return$/.test(onb.return_url || ""), onb.return_url);
  ck("and a stale link lands somewhere that mints another",
    /\/\?payouts=refresh$/.test(onb.refresh_url || ""), onb.refresh_url);
}

// ---- the embedded door, which is the one people use ------------------------
//
// Nobody connects anything. The account is minted the first time the screen
// is opened and what is left for the subcontractor is the part only they can
// answer -- who they are and where the money goes -- asked inside SubSub.
{
  console.log("\n-- the embedded session --");
  const db = seed(); const env = ENV(db);
  acctState = { payouts_enabled: false, capabilities: { transfers: "pending" },
    requirements: { currently_due: ["external_account"] } };
  calls = [];

  const first = await call(env, "/api/payouts/session", { method: "POST" });
  t2(first);
  function t2(r) {
    ck("it hands back a client secret to render with",
      r.status === 200 && typeof r.body.clientSecret === "string" && r.body.clientSecret.length > 0,
      `${r.status} ${r.body.clientSecret || r.body.error}`);
  }
  ck("and the account was minted without anybody pressing connect",
    calls.filter((x) => /\/accounts$/.test(x.url)).length === 1,
    String(calls.filter((x) => /\/accounts$/.test(x.url)).length));

  // The one that decides whether this feels like Stripe at all. `express`
  // gives the subcontractor a Stripe-branded website to be sent to; `none`
  // means SubSub is the only surface they ever see.
  const made = calls.find((x) => /\/accounts$/.test(x.url));
  ck("and they get no Stripe dashboard to be sent to",
    made?.body?.dashboard === "none", made?.body?.dashboard);

  const sess = calls.find((x) => /\/account_sessions$/.test(x.url));
  ck("the session is scoped to that one account",
    sess?.body.account === "acct_bay1", sess?.body.account);
  ck("and asks for onboarding",
    sess?.body["components[account_onboarding][enabled]"] === "true");
  // With no Stripe dashboard there is nowhere else these can be seen, so
  // leaving them out would strand somebody with money owed and no screen.
  ck("and for what Stripe still wants afterwards",
    sess?.body["components[account_management][enabled]"] === "true"
    && sess?.body["components[notification_banner][enabled]"] === "true");
  ck("and for what has been paid out",
    sess?.body["components[payouts][enabled]"] === "true");

  ck("it carries the current status, so the panel draws one answer",
    first.body.status === "pending" && first.body.ready === false,
    `${first.body.status} ready=${first.body.ready}`);

  // Two tabs on the same screen, or a reload.
  calls = [];
  const again = await call(env, "/api/payouts/session", { method: "POST" });
  ck("opening it again does not mint a second account",
    calls.filter((x) => /\/accounts$/.test(x.url)).length === 0);
  ck("but does mint a fresh session", !!again.body.clientSecret);
  ck("still one row", db.prepare(`SELECT COUNT(*) AS n FROM payout_accounts`).get().n === 1);

  // The two doors must not mint accounts with different settings -- that
  // would be two populations of subcontractor with different experiences,
  // decided by which door happened to work.
  const db2 = seed(); const env2 = ENV(db2);
  calls = [];
  await call(env2, "/api/payouts/connect", { method: "POST" });
  const viaLink = calls.find((x) => /\/accounts$/.test(x.url));
  ck("and the fallback door mints the same kind of account",
    JSON.stringify(viaLink?.body?.defaults) === JSON.stringify(made?.body?.defaults)
    && viaLink?.body?.dashboard === "none", viaLink?.body?.dashboard);
}

{
  console.log("\n-- and the session refuses where the link does --");
  const db = seed(); const env = ENV(db);
  acctState = { payouts_enabled: false, capabilities: { transfers: "inactive" },
    requirements: { disabled_reason: "rejected.fraud" } };
  await call(env, "/api/payouts/session", { method: "POST" });
  await call(env, "/api/payouts/refresh", { method: "POST" });
  const again = await call(env, "/api/payouts/session", { method: "POST" });
  ck("a rejected account is not handed another form to fill in",
    again.status === 409 && again.body.error === "rejected", `${again.status} ${again.body.error}`);

  const mgr = await call(env, "/api/payouts/session",
    { method: "POST", seat: { u: "u_pmadmin", a: "acc_pm" } });
  ck("and an account nobody can hire is told why",
    mgr.status === 409 && mgr.body.error === "not_hireable", `${mgr.status} ${mgr.body.error}`);

  const pm = await call(env, "/api/payouts/session",
    { method: "POST", seat: { u: "u_pm", a: "acc_sub" } });
  ck("a project manager cannot open one", pm.status === 403, String(pm.status));
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
  ck("and it says what Stripe is waiting for, in Stripe's own words",
    (gaveUp.body.requirements || [])[0]?.label === "Provide a government-issued photo ID",
    JSON.stringify(gaveUp.body.requirements));
  ck("read through v2, which is how the account was made",
    calls.some((x) => /\/v2\/core\/accounts\/acct_bay1\?include\[0\]=configuration\.recipient&include\[1\]=requirements$/.test(x.url)),
    calls.map((x) => x.url).filter((x) => /accounts\//.test(x)).join(" | "));

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

// ---- a v2 account's changes arrive thin ----------------------------------
{
  console.log("\n-- a v2 thin event is read back from Stripe --");
  const db = seed(); const env = ENV(db);
  acctState = { payouts_enabled: false, capabilities: { transfers: "pending" }, requirements: {} };
  await call(env, "/api/payouts/connect", { method: "POST" });
  acctState = READY;
  calls = [];
  const thin = { id: "evt_v2_1", object: "v2.core.event",
    type: "v2.core.account[configuration.recipient].capability_status_updated",
    related_object: { id: "acct_bay1", type: "v2.core.account", url: "/v2/core/accounts/acct_bay1" } };
  const r = await hook(env, thin);
  ck("a thin event is accepted", r.status === 200, String(r.status));
  ck("and the account is read back rather than trusted from the payload",
    calls.some((x) => /\/v2\/core\/accounts\/acct_bay1/.test(x.url) && x.method === "GET"));
  ck("so the row moves without anybody pressing anything",
    db.prepare(`SELECT kyc_status FROM payout_accounts`).get().kyc_status === "verified");
}
{
  console.log("\n-- an account minted under v1 still refreshes --");
  const db = seed(); const env = ENV(db);
  db.exec(`INSERT OR IGNORE INTO companies(id,company) VALUES ('cmp_own_acc_sub','Bay Roofing')`);
  db.prepare(`INSERT INTO payout_accounts
    (id, company_id, processor, processor_account_id, kyc_status, payouts_enabled,
     transfers_active, requirements, disabled_reason)
    VALUES ('pa_old', ?, 'stripe', 'acct_old1', 'pending', 0, 0, '[]', NULL)`).run("cmp_own_acc_sub");
  acctState = READY; calls = [];
  const r = await call(env, "/api/payouts/refresh", { method: "POST" });
  ck("v2 not answering for it falls back to the v1 read",
    calls.some((x) => /\/v1\/accounts\/acct_old1$/.test(x.url)), calls.map((x) => x.url).join(" | "));
  ck("and it reads verified exactly as before", r.body.status === "verified", r.body.status);
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

  // ---- a replayed refusal is never the final answer ----------------------
  //
  // Stripe saves the status and body of the first request under an idempotency
  // key and replays them for 24 hours -- a refusal as faithfully as a success.
  // Half of what can refuse this call is not ours: an account setting, an API
  // policy, a capability. After fixing one of those, the next press is still
  // answered by the refusal from before the fix, which is a day-long dead end
  // on the one screen a subcontractor cannot get paid without. It happened
  // twice in two days.
  //
  // The retry is safe BECAUSE the replayed answer was a refusal: a 4xx means
  // Stripe created nothing under that key, so a fresh key cannot duplicate an
  // account. A replayed SUCCESS is a 200 and never reaches the retry at all --
  // which is the double press the key exists to absorb, asserted separately
  // below so the retry cannot quietly start firing on it.
  console.log("\n-- a replayed refusal is asked again under a fresh key --");
  {
    const db = seed();
    const env = ENV(db);
    calls = []; acctState = {};
    // What Stripe answers a key it has already refused once.
    failNext = new Response(
      JSON.stringify({ error: { message: "Accounts v1 is not available for new integrations." } }),
      { status: 400, headers: { "Content-Type": "application/json", "Idempotent-Replayed": "true" } });

    const r = await call(env, "/api/payouts/session", { method: "POST" });
    const mints = calls.filter((x) => /\/accounts$/.test(x.url) && x.method === "POST");
    ck("a replayed refusal does not end the press", r.status === 200, String(r.status));
    ck("it asks Stripe again", mints.length === 2, String(mints.length));
    ck("under a DIFFERENT key, or Stripe replays the same refusal forever",
      mints[0]?.headers["Idempotency-Key"] !== mints[1]?.headers["Idempotency-Key"],
      mints[1]?.headers["Idempotency-Key"]);
    ck("and the retry still carries the same shape, not a relaxed one",
      JSON.stringify(mints[1]?.body?.defaults) === JSON.stringify(mints[0]?.body?.defaults)
        && mints[1]?.body?.dashboard === "none",
      JSON.stringify(mints[1]?.body?.defaults));
    ck("the account it did mint is the one recorded",
      db.prepare(`SELECT processor_account_id FROM payout_accounts`).all()
        .map((x) => x.processor_account_id).join(",") === "acct_bay1");
  }
  {
    // A refusal Stripe is answering FRESH created nothing either, but it is
    // this attempt's own answer -- asking again would be two live creates for
    // one press, which is the duplication the key exists to prevent.
    const db = seed();
    calls = []; acctState = {};
    failNext = new Response(
      JSON.stringify({ error: { message: "Something Stripe just decided." } }),
      { status: 400, headers: { "Content-Type": "application/json" } });
    const r = await call(ENV(db), "/api/payouts/session", { method: "POST" });
    const mints = calls.filter((x) => /\/accounts$/.test(x.url) && x.method === "POST");
    ck("a FRESH refusal is not retried -- only a replayed one is",
      mints.length === 1, String(mints.length));
    // THIS ASSERTION USED TO PIN `stripe_failed` WITH STRIPE'S SENTENCE ON IT,
    // and it was rewritten to the new rule rather than loosened -- a test can
    // pin the old answer as firmly as the right one.
    //
    // What changed, and why it is not a relaxation: a refusal HERE is a
    // refusal at mint time, when Stripe has been told nothing about this
    // company beyond an email. There is no identity to reject and no document
    // outstanding, so it is about OUR request or OUR platform settings by
    // construction. It reached the screen verbatim once -- "enable Accounts v1
    // support in the Dashboard: https://dashboard.stripe.com/settings/..." --
    // in front of somebody who runs a roofing company, under a heading reading
    // "A few details before we can pay you".
    ck("a mint refusal is reported as OURS rather than as theirs",
      r.status === 502 && r.body.error === "platform_not_ready",
      `${r.status} ${r.body.error}`);
    // The half that matters on the screen: Stripe's words name our dashboard
    // and our endpoint choice, so handing them to a customer is an instruction
    // they cannot carry out about an account they cannot open.
    ck("and Stripe's words are withheld from somebody who cannot act on them",
      !r.body.detail, JSON.stringify(r.body.detail || null));
    ck("and says it was not a replay, so the screen does not blame a cache",
      r.body.replayed === false, JSON.stringify(r.body.replayed));
  }
  {
    // AND STAFF STANDING IN GET THE SENTENCE, because they ARE the party who
    // can go and change it -- withholding it there would hide the one message
    // that says what to do. `impersonatedBy` comes off the session ROW, so a
    // customer cannot claim it by sending a header.
    const db = seed();
    calls = []; acctState = {};
    // `staff_user_id` is a real `users` row -- the column is a foreign key,
    // because a session whose actor cannot be named is the one thing that
    // table exists to prevent.
    db.exec(`INSERT INTO users(id,name,email) VALUES ('u_staff','Pat','pat@subsub.work')`);
    db.prepare(`INSERT INTO impersonation_sessions
      (token, account_id, act_as_user_id, staff_user_id, ended_at, expires_at)
      VALUES (?, ?, ?, ?, NULL, datetime('now', '+1 hour'))`)
      .run("imp_tok", "acc_sub", "u_ad", "u_staff");
    failNext = new Response(
      JSON.stringify({ error: { message: "Enable Accounts v1 in the Dashboard." } }),
      { status: 400, headers: { "Content-Type": "application/json" } });
    const r = await call(ENV(db), "/api/payouts/session", { method: "POST", imp: "imp_tok" });
    ck("staff see it as ours too", r.body.error === "platform_not_ready", String(r.body.error));
    ck("but with Stripe's own words on it",
      /Enable Accounts v1/.test(r.body.detail || ""), JSON.stringify(r.body.detail || null));
  }
  {
    // AND THE OTHER HALF, IN THE SAME PLACE. A refusal once the connected
    // account EXISTS may well be about them -- a document Stripe would not
    // take, an address it refused -- so Stripe's words still lead, which is
    // what that branch was written for. A "fix" that routed every Stripe
    // refusal through `platform_not_ready` would pass every assertion above
    // and silence the one class of message the reader can act on: the
    // diagonal coverage that left `hiresLabel` half-wired.
    const db = seed();
    db.exec(`INSERT OR IGNORE INTO companies(id,company) VALUES ('cmp_own_acc_sub','Bay Roofing')`);
    db.prepare(`INSERT INTO payout_accounts
      (id, company_id, processor, processor_account_id, kyc_status, payouts_enabled,
       transfers_active, requirements, disabled_reason)
      VALUES ('pa_1', ?, 'stripe', 'acct_bay1', 'pending', 0, 0, '[]', NULL)`)
      .run("cmp_own_acc_sub");
    calls = []; acctState = {};
    failMatch = /account_sessions/;
    failNext = new Response(
      JSON.stringify({ error: { message: "We could not read that photo ID." } }),
      { status: 400, headers: { "Content-Type": "application/json" } });
    const r = await call(ENV(db), "/api/payouts/session", { method: "POST" });
    ck("a refusal after the account exists is still reported as Stripe's",
      r.body.error === "stripe_failed", String(r.body.error));
    ck("and carries its words, because the reader can act on those",
      /photo ID/.test(r.body.detail || ""), JSON.stringify(r.body.detail || null));
    ck("and no second account was minted to get there",
      calls.filter((x) => /\/accounts$/.test(x.url) && x.method === "POST").length === 0,
      String(calls.filter((x) => /\/accounts$/.test(x.url)).length));
  }
  {
    // The race the retry has to survive: the press that got the refusal
    // replayed to it was racing one that SUCCEEDED, so a row lands while this
    // one is in flight. Asking Stripe again would mint a second connected
    // account for one company, which is two places the money could go.
    //
    // Staged where it actually happens -- the row appears as the refusal is
    // answered, so the retry's re-read is the only thing that can catch it.
    const db = seed();
    db.exec(`INSERT INTO companies(id,company) VALUES ('cmp_own_acc_sub','Bay Roofing')`);
    calls = []; acctState = {};
    failNext = () => {
      db.exec(`INSERT INTO payout_accounts(id,company_id,processor,processor_account_id,kyc_status)
               VALUES ('po_raced','cmp_own_acc_sub','stripe','acct_raced','pending')`);
      return new Response(JSON.stringify({ error: { message: "Replayed." } }),
        { status: 400, headers: { "Content-Type": "application/json", "Idempotent-Replayed": "true" } });
    };
    const r = await call(ENV(db), "/api/payouts/session", { method: "POST" });
    const mints = calls.filter((x) => /\/accounts$/.test(x.url) && x.method === "POST");
    ck("a row that appeared meanwhile is used rather than a second account minted",
      mints.length === 1 && r.status === 200, `${mints.length} mints, ${r.status}`);
    ck("and the company still has exactly one",
      db.prepare(`SELECT COUNT(*) n FROM payout_accounts WHERE company_id='cmp_own_acc_sub'`).get().n === 1);
    ck("the one the race won, not a second",
      db.prepare(`SELECT processor_account_id p FROM payout_accounts`).get().p === "acct_raced");
  }

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
