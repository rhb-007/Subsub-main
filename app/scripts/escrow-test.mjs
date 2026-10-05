// Money in, money out, and the handful of ways that goes badly wrong.
//
// 033 wrote this ledger for a processor that did not exist, and 051 is the
// processor. What has to hold:
//
//   THE AMOUNT IS THE RELEASE'S, NEVER THE CALLER'S. A figure taken from the
//   body is a figure somebody chooses.
//
//   FUNDING IS READ BACK FROM STRIPE. A route that believed "it succeeded"
//   from the browser would let anybody mark a work order funded without
//   paying, and every gate below reads that figure. The AMOUNT too: a caller
//   who could name it could pay a dollar and claim five thousand.
//
//   MONEY IS NEVER LENT. A transfer larger than what has been funded is
//   SubSub advancing money on a general contractor's promise, which is credit
//   and a different company.
//
//   ONE TRANSFER PER RELEASE, AND A FAILED ONE IS RETRYABLE. Those pull
//   against each other, which is why the index is partial -- a plain unique
//   index leaves somebody unpayable because a card bounced once, and no index
//   at all pays the same milestone twice under a race. Both are asserted.
//
//   /pay IS NOT A DOOR ROUND THE GATES. Everything `settle` refuses, this
//   refuses, with the same two overrides.
//
//   A REVERSAL REOPENS THE RELEASE. Money that comes back weeks later must
//   not leave a roster saying somebody was paid.
//
//   NO DESTINATION CHARGE. `transfer_data` or `on_behalf_of` on the funding
//   intent would settle it straight into somebody else's balance -- money
//   that arrives already spent, which cannot be held against a milestone.
//   Asserted on the request Stripe actually receives.
//
// Stripe is stubbed at `fetch`, which is the boundary billing.js uses, so the
// request shape is assertable.
//
//   node --no-warnings scripts/escrow-test.mjs

import { readFileSync } from "node:fs";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";
import { fundingState, canPay, payRefusalText, fundSuggestion,
         FUND_STATES, TRANSFER_STATES,
         MIN_FUND_CENTS, MAX_FUND_CENTS } from "../shared/escrow.js";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");
const SCHEMA = readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8");
const M051 = readFileSync(new URL("../worker/migrations/051_escrow.sql", import.meta.url), "utf8");

// ---------------------------------------------------------------------------
// The arithmetic, on its own
// ---------------------------------------------------------------------------
console.log("\n-- what is available, owed and short --");
{
  const s = fundingState({ fundedCents: 500000, transferredCents: 100000, dueCents: 300000 });
  ck("available is in minus out", s.availableCents === 400000, String(s.availableCents));
  ck("nothing short when it covers what is owed", s.shortfallCents === 0, String(s.shortfallCents));
  const t = fundingState({ fundedCents: 150000, dueCents: 400000 });
  ck("short names the gap, not a boolean", t.shortfallCents === 250000, String(t.shortfallCents));
  const r = fundingState({ fundedCents: 500000, refundedCents: 200000, dueCents: 100000 });
  ck("a refund comes off what is in hand", r.availableCents === 300000, String(r.availableCents));
  // Retainage is owed, not unspent. Offering it back is refunding your way out
  // of a holdback.
  ck("refundable excludes what is owed", r.refundableCents === 200000, String(r.refundableCents));
  ck("and never goes negative",
    fundingState({ fundedCents: 100, dueCents: 900000 }).refundableCents === 0);
  // The fee, both halves. One already taken is no longer the account's; one
  // still due has to stay on hand, or refunding it leaves that release
  // unpayable through SubSub.
  const fz = fundingState({ fundedCents: 500000, transferredCents: 200000, feesTakenCents: 1000,
    dueCents: 100000, feesDueCents: 500 });
  ck("a fee already taken is not available", fz.availableCents === 299000, String(fz.availableCents));
  ck("owed is the net AND the fee", fz.owedCents === 100500, String(fz.owedCents));
  ck("and a fee still due is not refundable", fz.refundableCents === 198500, String(fz.refundableCents));
}

console.log("\n-- the state lists match the migration's own CHECK clauses --");
{
  // Two records of one fact, so they are compared. A list in the module that
  // nothing checks against the schema is a comment pretending to be code -- and
  // the failure it hides is a row the route writes and the database refuses.
  const M = readFileSync(new URL("../worker/migrations/051_escrow.sql", import.meta.url), "utf8");
  const clause = (table) => {
    const t = M.slice(M.indexOf(`CREATE TABLE IF NOT EXISTS ${table}`));
    const m = t.match(/status\s+TEXT NOT NULL DEFAULT '[a-z]+'\s*\n\s*CHECK \(status IN \(([^)]*)\)\)/);
    return m ? m[1].split(",").map((x) => x.trim().replace(/^'|'$/g, "")) : null;
  };
  const f = clause("wo_funding");
  const t = clause("wo_transfers");
  ck("the migration's funding states were found", Array.isArray(f) && f.length === 4, JSON.stringify(f));
  ck("and they are FUND_STATES", f && f.join(",") === FUND_STATES.join(","),
    `${f} vs ${FUND_STATES}`);
  ck("the migration's transfer states were found", Array.isArray(t) && t.length === 4, JSON.stringify(t));
  ck("and they are TRANSFER_STATES", t && t.join(",") === TRANSFER_STATES.join(","),
    `${t} vs ${TRANSFER_STATES}`);
  // And the partial index is on exactly the retryable one.
  ck("the live-transfer index excludes precisely the retryable state",
    /ux_wo_transfer_live[\s\S]{0,120}WHERE status <> 'failed'/.test(M)
      && TRANSFER_STATES.includes("failed"));
}

console.log("\n-- may this be paid --");
{
  const funded = fundingState({ fundedCents: 500000 });
  // The fee rides with the transfer, so it has to be funded too.
  const tight = canPay({ release: { status: "due", netCents: 500000, feeCents: 2500 }, funding: funded, payable: true });
  ck("net exactly funded but the fee not: no", !tight.ok && tight.reason === "not_funded", JSON.stringify(tight));
  ck("and the words name both halves",
    /\$5,000\.00 to them and SubSub's \$25\.00 fee/.test(payRefusalText(tight)) && /Add \$25\.00/.test(payRefusalText(tight)),
    payRefusalText(tight));
  ck("funded, payable, due: yes",
    canPay({ release: { status: "due", netCents: 400000 }, funding: funded, payable: true }).ok);
  const short = canPay({ release: { status: "due", netCents: 600000 }, funding: funded, payable: true });
  ck("more owed than funded: no", !short.ok && short.reason === "not_funded", JSON.stringify(short));
  ck("and the words say what to add",
    /Add \$1,000\.00/.test(payRefusalText(short)), payRefusalText(short));
  const noPayee = canPay({ release: { status: "due", netCents: 400000 }, funding: funded, payable: false });
  ck("an unverified payee: no", !noPayee.ok && noPayee.reason === "payee_not_ready");
  // Not overridable by anybody, which is the point of it being here rather
  // than with the two gates that are.
  ck("already paid: no",
    canPay({ release: { status: "paid", netCents: 1 }, funding: funded, payable: true }).reason === "already_paid");
  ck("void: no",
    canPay({ release: { status: "void", netCents: 1 }, funding: funded, payable: true }).reason === "void");
  const tiny = canPay({ release: { status: "due", netCents: 10 }, funding: funded, payable: true });
  ck("under Stripe's floor is named, not reported as a Stripe refusal",
    tiny.reason === "below_minimum", JSON.stringify(tiny));
  ck("and it says to record it instead", /Record it as paid/.test(payRefusalText(tiny)), payRefusalText(tiny));
}

console.log("\n-- what to fund, derived from money.js and not reinvented --");
{
  const s = fundSuggestion({ milestones: [{ amountCents: 300000 }, { amountCents: 200000 }],
    retainageBps: 500 });
  ck("funding covers the GROSS, retainage included", s.grossCents === 500000, String(s.grossCents));
  ck("and the net is what would reach them", s.netCents === 475000, String(s.netCents));
  ck("the top-up is net of what is already there, and carries the fee",
    fundSuggestion({ milestones: [{ amountCents: 500000 }], alreadyAvailable: 200000 }).topUpCents === 302500,
    String(fundSuggestion({ milestones: [{ amountCents: 500000 }], alreadyAvailable: 200000 }).topUpCents));
  // The cap is per payment, so two capped draws are two fees. Suggested as one
  // lump it would be one, and the second draw could not be paid.
  const big = fundSuggestion({ milestones: [{ amountCents: 20_000_000 }, { amountCents: 20_000_000 }] });
  ck("two capped draws are two capped fees", big.feeCents === 100000, String(big.feeCents));
  ck("and what is already owed is covered as well as what is to come",
    fundSuggestion({ milestones: [], owedCents: 40000 }).topUpCents === 40000);
  // Milestones already released are not funded twice -- the money for them has
  // already gone.
  const some = fundSuggestion({ milestones: [
    { amountCents: 300000, released: true }, { amountCents: 200000 }] });
  ck("a released milestone is not asked for again", some.grossCents === 200000, String(some.grossCents));
  ck("and nothing left to fund suggests nothing",
    fundSuggestion({ milestones: [{ amountCents: 100, released: true }] }).topUpCents === 0);
  // And the screen reads it rather than summing its own -- a second opinion on
  // what a release nets would put a figure on the fund form that the release
  // then disagrees with by a cent.
  const APP = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  ck("the panel reads fundSuggestion rather than summing its own",
    /suggestCents=\{fundSuggestion\(\{/.test(APP));
  ck("and passes the retainage, or the final draw has nothing behind it",
    /retainageBps: plan\.retainageBps/.test(APP));
  ck("and what is already owed, fee included, or a due release stays short",
    /owedCents: money\?\.owedCents/.test(APP));
  // The fee is said where it is paid, on the paying side only, in the one
  // set of words the module holds -- three screens quoting three fees is how
  // somebody is told 0.5% and charged something else.
  ck("the pay window names the fee before the press",
    /paying && release\.feeCents > 0 && \([\s\S]{0,200}Plus SubSub's fee of \{formatCents\(release\.feeCents\)\} \(\{FEE_TERMS\}\)/.test(APP));
  ck("and the record window says a payment made elsewhere carries none",
    /!paying && release\.feeCents > 0 && \([\s\S]{0,120}No SubSub fee/.test(APP));
  ck("and the fund form says the figure includes it",
    /Includes SubSub's fee on payments sent through SubSub: \{FEE_TERMS\}/.test(APP));
  ck("the pay window's own check carries the fee, as the route's does",
    /netCents: release\.netCents,\s*feeCents: release\.feeCents/.test(APP));
}

// ---------------------------------------------------------------------------
// The Stripe stub
// ---------------------------------------------------------------------------
const realFetch = globalThis.fetch;
let calls = [];
let piState = { status: "succeeded" };
let refuse = null;          // { path: /re/, message }

globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (!u.includes("stripe")) return realFetch(url, init);
  const body = Object.fromEntries(new URLSearchParams(init.body || ""));
  calls.push({ url: u, method: init.method || "POST", headers: init.headers || {}, body });
  const json = (o, status = 200) =>
    new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });
  if (refuse && refuse.path.test(u)) {
    const m = refuse.message; refuse = null;
    return json({ error: { message: m } }, 402);
  }
  if (/\/payment_intents$/.test(u)) {
    // The stub REMEMBERS the amount it was created with. A stub that always
    // answers the same figure back would make "money is never lent" pass
    // whatever the route funded -- a test of its own fixture.
    piState.amount = Number(body.amount);
    return json({ id: "pi_1", client_secret: "pi_1_secret_x", status: "requires_payment_method" });
  }
  if (/\/payment_intents\/pi_\w+/.test(u)) {
    const amt = piState.amount ?? 500000;
    return json({ id: "pi_1", amount: amt, amount_received: piState.amountReceived ?? amt,
      status: piState.status, latest_charge: "ch_1",
      ...(piState.lastError ? { last_payment_error: { message: piState.lastError } } : {}) });
  }
  if (/\/transfers$/.test(u)) return json({ id: "tr_" + (calls.length), object: "transfer" });
  if (/\/refunds$/.test(u)) return json({ id: "re_1", object: "refund" });
  return json({ error: { message: "stub has no route for " + u } }, 404);
};

const ENV = (db) => ({ DB: makeD1(db), STRIPE_SECRET_KEY: "sk_test_x",
  STRIPE_WEBHOOK_SECRET: "whsec_main" });

const call = async (env, path, { method = "GET", seat = { u: "u_ad", a: "acc_gc" }, body } = {}) => {
  const res = await worker.fetch(new Request(`https://api.subsub.work${path}`, {
    method,
    headers: { "X-User-Id": seat.u, "X-Account-Id": seat.a, "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }), env);
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

async function signedHook(secret, payload) {
  const raw = JSON.stringify(payload);
  const t = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${raw}`));
  const hex = Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
  return { raw, header: `t=${t},v1=${hex}` };
}
const hook = async (env, payload) => {
  const s = await signedHook("whsec_main", payload);
  const res = await worker.fetch(new Request("https://api.subsub.work/api/stripe/webhook", {
    method: "POST", headers: { "stripe-signature": s.header, "Content-Type": "application/json" },
    body: s.raw,
  }), env);
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

const JOB_DAY = "2026-03-10";
// A work order with one verified milestone and the release it produced, all
// paperwork in order so the gates are never what refuses. `payable` decides
// whether the subcontractor can be reached by money at all.
function seed({ payable = true, netCents = 400000 } = {}) {
  const db = freshDb({ base: SCHEMA, migrations: [M051] });
  db.exec(`
    INSERT INTO accounts(id,name,subdomain,kind,plan,stripe_customer_id) VALUES
      ('acc_gc','Outerhome','outerhome','general_contractor','scale','cus_1');
    INSERT INTO users(id,name,email) VALUES ('u_ad','Rae','rae@outerhome.test'),('u_pm','Sam','sam@outerhome.test');
    INSERT INTO memberships(id,user_id,account_id,role) VALUES
      ('m_ad','u_ad','acc_gc','admin'), ('m_pm','u_pm','acc_gc','pm');
    INSERT INTO companies(id,company,contact,email) VALUES ('cmp_roof','Cascade Roofworks','Dev','dev@cascade.test');
    INSERT INTO engagements(id,account_id,company_id,status,doc_review) VALUES
      ('en1','acc_gc','cmp_roof','active',
       '{"insurance":{"status":"verified"},"bond":{"status":"verified"},"w9":{"status":"verified"}}');
    INSERT INTO company_docs(id,company_id,kind,file_key,file_name,expires_on) VALUES
      ('cd_i','cmp_roof','insurance','k/i','coi.pdf','2030-01-01'),
      ('cd_b','cmp_roof','bond','k/b','bond.pdf',NULL),
      ('cd_w','cmp_roof','w9','k/w','w9.pdf',NULL);
    INSERT INTO jobs(id,account_id,title,date,trades) VALUES ('job1','acc_gc','Re-roof','${JOB_DAY}','["roofing"]');
    INSERT INTO work_orders(id,wo_number,job_id,trade,company_id,engagement_id,value_cents,status,scope_kind)
      VALUES ('wo1','WO-1001','job1','roofing','cmp_roof','en1',500000,'accepted','labor_only');
    INSERT INTO wo_milestones(id,work_order_id,account_id,seq,label,amount_cents,status)
      VALUES ('ms1','wo1','acc_gc',1,'Complete',500000,'verified');
    INSERT INTO wo_releases(id,work_order_id,account_id,milestone_id,company_id,gross_cents,net_cents,status)
      VALUES ('rel1','wo1','acc_gc','ms1','cmp_roof',500000,${netCents},'due');
    INSERT INTO lien_waivers(id,job_id,release_id,work_order_id,account_id,from_company_id,tier,kind,status,through_date,scope_kind)
      VALUES ('lw1','job1','rel1','wo1','acc_gc','cmp_roof',0,'unconditional_progress','signed','2030-01-01','labor_only');
  `);
  if (payable) {
    db.prepare(`INSERT INTO payout_accounts(id,company_id,processor,processor_account_id,kyc_status,transfers_active,payouts_enabled)
                VALUES ('pa1','cmp_roof','stripe','acct_cascade','verified',1,1)`).run();
  } else {
    db.prepare(`INSERT INTO payout_accounts(id,company_id,processor,processor_account_id,kyc_status,transfers_active,payouts_enabled)
                VALUES ('pa1','cmp_roof','stripe','acct_cascade','pending',1,0)`).run();
  }
  return db;
}

// Fund a work order the way the browser does: start, then confirm.
async function fund(env, amount = 500000) {
  const start = await call(env, "/api/work-orders/wo1/fund", { method: "POST", body: { amountCents: amount } });
  if (start.status !== 200) return start;
  return call(env, "/api/work-orders/wo1/fund/confirm",
    { method: "POST", body: { fundingId: start.body.fundingId } });
}

console.log("\n-- funding, and the charge Stripe is actually asked for --");
{
  const db = seed(); const env = ENV(db);
  calls = []; piState = { status: "succeeded" };
  const start = await call(env, "/api/work-orders/wo1/fund", { method: "POST", body: { amountCents: 500000 } });
  ck("a client secret comes back", start.status === 200 && /^pi_/.test(start.body.clientSecret || ""),
    `${start.status} ${JSON.stringify(start.body)}`);

  const pi = calls.find((x) => /\/payment_intents$/.test(x.url));
  ck("the amount and currency are ours", pi.body.amount === "500000" && pi.body.currency === "usd",
    JSON.stringify(pi.body));
  // The whole legal shape, asserted on the wire.
  ck("NO transfer_data -- this is not a destination charge",
    !Object.keys(pi.body).some((k) => k.startsWith("transfer_data")), Object.keys(pi.body).join(","));
  ck("and NO on_behalf_of", !("on_behalf_of" in pi.body));
  ck("it carries a transfer_group so Stripe can tie the transfers to it",
    pi.body.transfer_group === "wo:wo1", pi.body.transfer_group);
  ck("and the account's own customer, so the card on file is offered",
    pi.body.customer === "cus_1", pi.body.customer);
  ck("two tabs cannot raise two charges",
    /^wo-fund:/.test(pi.headers["Idempotency-Key"] || ""), pi.headers["Idempotency-Key"]);

  ck("nothing is funded until it is confirmed",
    db.prepare(`SELECT status FROM wo_funding WHERE id=?`).get(start.body.fundingId).status === "pending");

  const ok = await call(env, "/api/work-orders/wo1/fund/confirm",
    { method: "POST", body: { fundingId: start.body.fundingId } });
  ck("confirming funds it", ok.status === 200 && ok.body.status === "funded", JSON.stringify(ok.body));
  ck("and the intent was READ BACK from Stripe rather than believed",
    calls.some((x) => /\/payment_intents\/pi_1/.test(x.url) && x.method === "GET"),
    calls.map((x) => x.method + " " + x.url).join(" | "));
  const row = db.prepare(`SELECT * FROM wo_funding WHERE id=?`).get(start.body.fundingId);
  ck("the charge id is stored, because a transfer needs it", row.processor_charge_id === "ch_1", row.processor_charge_id);
  ck("available is what landed", ok.body.availableCents === 500000, String(ok.body.availableCents));
}

console.log("\n-- and the amount is Stripe's, not the caller's --");
{
  const db = seed(); const env = ENV(db);
  // Stripe says a dollar landed against a claim of five thousand.
  piState = { status: "succeeded", amountReceived: 100 };   // Stripe says a dollar landed
  const start = await call(env, "/api/work-orders/wo1/fund", { method: "POST", body: { amountCents: 500000 } });
  await call(env, "/api/work-orders/wo1/fund/confirm", { method: "POST", body: { fundingId: start.body.fundingId } });
  const row = db.prepare(`SELECT amount_cents FROM wo_funding WHERE id=?`).get(start.body.fundingId);
  ck("what is recorded is what Stripe says landed", row.amount_cents === 100, String(row.amount_cents));
  piState = { status: "succeeded" };
}

console.log("\n-- an abandoned payment sheet is not funding --");
{
  const db = seed(); const env = ENV(db);
  piState = { status: "requires_payment_method", lastError: "Your card was declined." };
  const start = await call(env, "/api/work-orders/wo1/fund", { method: "POST", body: { amountCents: 500000 } });
  const r = await call(env, "/api/work-orders/wo1/fund/confirm",
    { method: "POST", body: { fundingId: start.body.fundingId } });
  ck("refused with Stripe's status", r.status === 409 && r.body.ok === false, `${r.status} ${JSON.stringify(r.body)}`);
  ck("and Stripe's own words, not 'something went wrong'",
    /declined/i.test(r.body.detail || ""), r.body.detail);
  ck("nothing is funded",
    db.prepare(`SELECT status FROM wo_funding WHERE id=?`).get(start.body.fundingId).status === "pending");
  const money = await call(env, "/api/work-orders/wo1/funding");
  ck("and the panel says zero available", money.body.availableCents === 0, String(money.body.availableCents));
  piState = { status: "succeeded" };
}

console.log("\n-- a bad amount is refused before Stripe is troubled --");
{
  const db = seed(); const env = ENV(db);
  calls = [];
  const low = await call(env, "/api/work-orders/wo1/fund", { method: "POST", body: { amountCents: 1 } });
  ck("under the floor", low.status === 400 && low.body.error === "bad_amount", JSON.stringify(low.body));
  const high = await call(env, "/api/work-orders/wo1/fund", { method: "POST", body: { amountCents: MAX_FUND_CENTS + 1 } });
  ck("over the ceiling", high.status === 400, JSON.stringify(high.body));
  ck("and Stripe was never called", !calls.some((x) => /payment_intents/.test(x.url)),
    calls.map((x) => x.url).join(","));
  ck("nor was a row written", (db.prepare(`SELECT COUNT(*) n FROM wo_funding`).get().n) === 0);
}

console.log("\n-- money out, and the transfer Stripe is actually asked for --");
{
  const db = seed(); const env = ENV(db);
  await fund(env, 500000);
  calls = [];
  const r = await call(env, "/api/releases/rel1/pay", { method: "POST" });
  ck("paid", r.status === 200 && r.body.ok === true, `${r.status} ${JSON.stringify(r.body)}`);

  // Read through `?.`: a test that cannot survive its own subject going
  // missing reports least when it matters most.
  const tr = calls.find((x) => /\/transfers$/.test(x.url));
  ck("Stripe was asked for a transfer at all", !!tr, calls.map((x) => x.url).join(","));
  ck("the amount is the release's net", tr?.body?.amount === "400000", tr?.body?.amount);
  ck("to their connected account", tr?.body?.destination === "acct_cascade", tr?.body?.destination);
  ck("in the same transfer group as the charge", tr?.body?.transfer_group === "wo:wo1", tr?.body?.transfer_group);
  // Without this the transfer needs a settled platform balance and Stripe
  // refuses with balance_insufficient.
  ck("against the charge that funded it", tr?.body?.source_transaction === "ch_1", tr?.body?.source_transaction);
  ck("with an idempotency key keyed on the release",
    tr?.headers?.["Idempotency-Key"] === "wo-pay:rel1", tr?.headers?.["Idempotency-Key"]);
  // Never Stripe-Account: this is a platform transfer TO them, not an action
  // taken as them.
  ck("and NOT as them -- no Stripe-Account header", !!tr && !("Stripe-Account" in (tr.headers || {})),
    Object.keys(tr?.headers || {}).join(","));

  const rel = db.prepare(`SELECT * FROM wo_releases WHERE id='rel1'`).get();
  ck("the release records the rail through 033's seam", rel.method === "stripe", rel.method);
  ck("and the transfer id as its reference", /^tr_/.test(rel.reference || ""), rel.reference);
  ck("status paid", rel.status === "paid", rel.status);
  const t = db.prepare(`SELECT * FROM wo_transfers WHERE release_id='rel1'`).get();
  ck("the attempt row is paid", t.status === "paid" && t.amount_cents === 400000, JSON.stringify(t));
  ck("and remembers which connected account it went to",
    t.processor_destination === "acct_cascade", t.processor_destination);
  const ev = db.prepare(`SELECT kind FROM wo_events WHERE work_order_id='wo1'`).all().map((e) => e.kind);
  ck("and the ledger has a release.paid line", ev.includes("release.paid"), ev.join(","));
}

console.log("\n-- and the caller cannot name the amount --");
{
  // The body is not a source of figures. Same rule as the draft route refusing
  // `status`: a number taken from the caller here is a number somebody chooses,
  // and the caller is the party who decides what the subcontractor is paid.
  const db = seed(); const env = ENV(db);
  await fund(env, 500000);
  calls = [];
  const r = await call(env, "/api/releases/rel1/pay", { method: "POST",
    body: { amountCents: 1, amount: 1, netCents: 1 } });
  ck("it pays", r.status === 200, `${r.status} ${JSON.stringify(r.body)}`);
  const tr = calls.find((x) => /\/transfers$/.test(x.url));
  ck("at the release's net, not the body's", tr?.body?.amount === "400000", tr?.body?.amount);
  ck("and the row records the release's net",
    db.prepare(`SELECT amount_cents FROM wo_transfers WHERE release_id='rel1'`).get().amount_cents === 400000);
}

console.log("\n-- a transfer against a release somebody else just closed --");
{
  // The race, produced rather than described: the gate passes, a colleague
  // records the release as paid by cheque, and THEN the transfer lands. The
  // money has gone, so this cannot report a failure -- somebody would press it
  // again, and the second press would refuse with `already_paying` while the
  // first press's money was already out. It says so instead, in the reply and
  // in the ledger.
  //
  // Staged by wrapping D1 and closing the release out of band on the way into
  // the route's own UPDATE, which is exactly where the window is.
  const db = seed();
  await fund(ENV(db), 500000);
  const inner = makeD1(db);
  let raced = false;
  const env = { ...ENV(db), DB: {
    ...inner,
    prepare: (sql) => {
      if (!raced && /UPDATE wo_releases SET status = 'paid', method = 'stripe'/.test(sql)) {
        raced = true;
        db.exec(`UPDATE wo_releases SET status='paid', method='check', reference='1099' WHERE id='rel1'`);
      }
      return inner.prepare(sql);
    },
  } };
  calls = [];
  const r = await call(env, "/api/releases/rel1/pay", { method: "POST" });
  ck("the race was staged", raced);
  ck("the transfer still went", calls.some((x) => /\/transfers$/.test(x.url)));
  ck("and it does NOT report a failure -- the money has gone", r.status === 200,
    `${r.status} ${JSON.stringify(r.body)}`);
  ck("but it says the release was already settled",
    r.body.alreadySettled === true, JSON.stringify(r.body));
  const ev = db.prepare(`SELECT payload FROM wo_events WHERE kind='release.paid'`).get();
  ck("and the ledger line says so too", /"orphan":true/.test(ev?.payload || ""), ev?.payload);
  // The release keeps the cheque it was closed with rather than being
  // overwritten -- that record is somebody's, and this transfer did not make it.
  const rel = db.prepare(`SELECT method, reference FROM wo_releases WHERE id='rel1'`).get();
  ck("the release keeps what actually closed it", rel.method === "check" && rel.reference === "1099",
    JSON.stringify(rel));
  // Which is the row CHECK.sql's invariant finds: a transfer marked paid
  // against a release nothing says was paid by it.
  const orphans = db.prepare(`SELECT COUNT(*) n FROM wo_transfers t
    JOIN wo_releases r ON r.id = t.release_id
    WHERE t.status = 'paid' AND r.method <> 'stripe'`).get();
  ck("and it is findable afterwards", orphans.n === 1, String(orphans.n));
}

console.log("\n-- money is never lent --");
{
  const db = seed(); const env = ENV(db);
  await fund(env, 100000);              // $1,000 in, $4,000 owed
  calls = [];
  const r = await call(env, "/api/releases/rel1/pay", { method: "POST" });
  ck("refused", r.status === 409 && r.body.error === "not_funded", `${r.status} ${JSON.stringify(r.body)}`);
  ck("and it says what is there and what is owed",
    r.body.available === 100000 && r.body.net === 400000, JSON.stringify(r.body));
  ck("no transfer was attempted at Stripe", !calls.some((x) => /transfers/.test(x.url)),
    calls.map((x) => x.url).join(","));
  ck("and no attempt row was written", db.prepare(`SELECT COUNT(*) n FROM wo_transfers`).get().n === 0);
  ck("the release is still due",
    db.prepare(`SELECT status FROM wo_releases WHERE id='rel1'`).get().status === "due");
}

console.log("\n-- nowhere to send it --");
{
  const db = seed({ payable: false }); const env = ENV(db);
  await fund(env, 500000);
  calls = [];
  const r = await call(env, "/api/releases/rel1/pay", { method: "POST" });
  ck("an unverified payee is refused", r.status === 409 && r.body.error === "payee_not_ready",
    `${r.status} ${JSON.stringify(r.body)}`);
  ck("and Stripe is not asked to fail for us", !calls.some((x) => /transfers/.test(x.url)));
  // payouts_enabled without transfers_active is the other half, and it fails
  // the same way -- asserted separately because either alone passing would
  // hide exactly that state.
  db.prepare(`UPDATE payout_accounts SET payouts_enabled=1, transfers_active=0 WHERE id='pa1'`).run();
  const half = await call(env, "/api/releases/rel1/pay", { method: "POST" });
  ck("payouts on with transfers pending is also refused",
    half.body.error === "payee_not_ready", JSON.stringify(half.body));
}

console.log("\n-- /pay is not a door round the paperwork gates --");
{
  const db = seed(); const env = ENV(db);
  db.prepare(`DELETE FROM company_docs WHERE kind='insurance'`).run();
  await fund(env, 500000);
  calls = [];
  const r = await call(env, "/api/releases/rel1/pay", { method: "POST" });
  ck("no certificate: refused", r.status === 409 && r.body.error === "cover_outstanding",
    `${r.status} ${JSON.stringify(r.body)}`);
  ck("and no money moved", !calls.some((x) => /transfers/.test(x.url)));
  const bare = await call(env, "/api/releases/rel1/pay", { method: "POST", body: { coverOverride: true } });
  ck("overriding with no reason is refused", bare.status === 400 && bare.body.error === "cover_reason_required",
    JSON.stringify(bare.body));
  const ok = await call(env, "/api/releases/rel1/pay", { method: "POST",
    body: { coverOverride: true, coverOverrideReason: "Owner accepts the exposure" } });
  ck("with a reason it pays", ok.status === 200, `${ok.status} ${JSON.stringify(ok.body)}`);
  const ev = db.prepare(`SELECT kind,payload FROM wo_events WHERE work_order_id='wo1'`).all();
  ck("and the override is on the record",
    ev.some((e) => e.kind === "release.cover_override" && /Owner accepts/.test(e.payload)),
    ev.map((e) => e.kind).join(","));
}

console.log("\n-- one transfer per release --");
{
  const db = seed(); const env = ENV(db);
  await fund(env, 500000);
  const first = await call(env, "/api/releases/rel1/pay", { method: "POST" });
  ck("the first goes", first.status === 200, `${first.status} ${JSON.stringify(first.body)}`);
  calls = [];
  const second = await call(env, "/api/releases/rel1/pay", { method: "POST" });
  ck("the second is refused", second.status === 409, `${second.status} ${JSON.stringify(second.body)}`);
  ck("and Stripe was not asked a second time", !calls.some((x) => /transfers/.test(x.url)),
    calls.map((x) => x.url).join(","));
  ck("one transfer row, not two",
    db.prepare(`SELECT COUNT(*) n FROM wo_transfers WHERE release_id='rel1'`).get().n === 1);

  // The index directly, because a sequential retry test passes with it
  // deleted -- the pre-check catches that one. This is the half that holds
  // when two requests arrive at once.
  let threw = false;
  try {
    db.prepare(`INSERT INTO wo_transfers(id,release_id,work_order_id,account_id,company_id,amount_cents,status)
                VALUES ('t2','rel1','wo1','acc_gc','cmp_roof',400000,'pending')`).run();
  } catch { threw = true; }
  ck("and the unique index refuses a second live one", threw);
  // But a failed one must be retryable, which is why the index is partial.
  db.prepare(`UPDATE wo_transfers SET status='failed' WHERE release_id='rel1'`).run();
  let ok2 = true;
  try {
    db.prepare(`INSERT INTO wo_transfers(id,release_id,work_order_id,account_id,company_id,amount_cents,status)
                VALUES ('t3','rel1','wo1','acc_gc','cmp_roof',400000,'pending')`).run();
  } catch { ok2 = false; }
  ck("while a FAILED one leaves room to try again", ok2);
}

console.log("\n-- a refused transfer is marked failed, not left pending --");
{
  const db = seed(); const env = ENV(db);
  await fund(env, 500000);
  refuse = { path: /\/transfers$/, message: "Insufficient funds in your Stripe balance." };
  const r = await call(env, "/api/releases/rel1/pay", { method: "POST" });
  ck("the route reports it", r.status === 502, `${r.status} ${JSON.stringify(r.body)}`);
  ck("with Stripe's own words", /Insufficient funds/.test(r.body.detail || ""), r.body.detail);
  const t = db.prepare(`SELECT * FROM wo_transfers WHERE release_id='rel1'`).get();
  ck("the attempt is failed", t.status === "failed", t.status);
  ck("carrying why", /Insufficient funds/.test(t.error || ""), t.error);
  ck("the release is still due, not paid",
    db.prepare(`SELECT status FROM wo_releases WHERE id='rel1'`).get().status === "due");
  // And it can be tried again, which is the whole reason for the partial index.
  const again = await call(env, "/api/releases/rel1/pay", { method: "POST" });
  ck("and a retry goes through", again.status === 200, `${again.status} ${JSON.stringify(again.body)}`);
}

console.log("\n-- a reversal reopens the release --");
{
  const db = seed(); const env = ENV(db);
  await fund(env, 500000);
  const paid = await call(env, "/api/releases/rel1/pay", { method: "POST" });
  const ref = paid.body.reference;
  const h = await hook(env, { id: "evt_rev1", type: "transfer.reversed", data: { object: { id: ref } } });
  ck("the webhook is accepted", h.status === 200, `${h.status} ${JSON.stringify(h.body)}`);
  const rel = db.prepare(`SELECT * FROM wo_releases WHERE id='rel1'`).get();
  ck("the release goes back to due", rel.status === "due", rel.status);
  ck("and stops naming a transfer that came back", !rel.reference, String(rel.reference));
  const t = db.prepare(`SELECT status FROM wo_transfers WHERE release_id='rel1'`).get();
  ck("the transfer is reversed", t.status === "reversed", t.status);
  const ev = db.prepare(`SELECT kind FROM wo_events WHERE work_order_id='wo1'`).all().map((e) => e.kind);
  ck("and the reversal is its own line rather than an edit",
    ev.includes("release.paid") && ev.includes("release.reversed"), ev.join(","));
  // A transfer we hold no row for must not 4xx: Stripe would retry for ever.
  const other = await hook(env, { id: "evt_rev2", type: "transfer.reversed", data: { object: { id: "tr_someone_else" } } });
  ck("somebody else's transfer is accepted quietly", other.status === 200, `${other.status}`);
}

console.log("\n-- the webhook funds a work order whose tab was closed --");
{
  const db = seed(); const env = ENV(db);
  const start = await call(env, "/api/work-orders/wo1/fund", { method: "POST", body: { amountCents: 500000 } });
  const h = await hook(env, { id: "evt_pi1", type: "payment_intent.succeeded",
    data: { object: { id: "pi_1", amount: 500000, amount_received: 500000, latest_charge: "ch_1",
      metadata: { work_order_id: "wo1" } } } });
  ck("accepted", h.status === 200, `${h.status} ${JSON.stringify(h.body)}`);
  const row = db.prepare(`SELECT * FROM wo_funding WHERE id=?`).get(start.body.fundingId);
  ck("and the funding landed with nobody watching", row.status === "funded", row.status);
  ck("with the charge id a transfer will need", row.processor_charge_id === "ch_1", row.processor_charge_id);
  // A subscription charge carries no work_order_id and must be left alone.
  const sub = await hook(env, { id: "evt_pi2", type: "payment_intent.succeeded",
    data: { object: { id: "pi_sub", amount: 9900, metadata: {} } } });
  ck("a subscription charge is not mistaken for funding", sub.status === 200);
  ck("and invents no row", db.prepare(`SELECT COUNT(*) n FROM wo_funding`).get().n === 1);
}

console.log("\n-- unspent money comes back, and retainage does not --");
{
  const db = seed({ netCents: 400000 }); const env = ENV(db);
  await fund(env, 500000);
  // $5,000 in, $4,000 owed: $1,000 is unspent.
  const r = await call(env, "/api/work-orders/wo1/refund", { method: "POST" });
  ck("the unspent part comes back", r.status === 200, `${r.status} ${JSON.stringify(r.body)}`);
  ck("and it is the unspent part, not the balance",
    (r.body.refunded || []).reduce((n, x) => n + x.amountCents, 0) === 100000,
    JSON.stringify(r.body.refunded));
  ck("what is owed is still there", r.body.availableCents === 400000, String(r.body.availableCents));
  const again = await call(env, "/api/work-orders/wo1/refund", { method: "POST" });
  ck("and there is nothing more to send back",
    again.status === 409 && again.body.error === "nothing_refundable", JSON.stringify(again.body));
  const over = await call(env, "/api/work-orders/wo1/refund", { method: "POST", body: { amountCents: 400000 } });
  ck("asking for more than is unspent is refused",
    over.status === 409 && over.body.error === "over_refundable", JSON.stringify(over.body));
}

console.log("\n-- who may do any of this --");
{
  const db = seed(); const env = ENV(db);
  // Funding is spending the account's money, so it is admin-only -- the same
  // line the subscription's card sits behind.
  const pmFund = await call(env, "/api/work-orders/wo1/fund",
    { method: "POST", seat: { u: "u_pm", a: "acc_gc" }, body: { amountCents: 500000 } });
  ck("a project manager cannot fund", pmFund.status === 403, `${pmFund.status} ${JSON.stringify(pmFund.body)}`);
  const pmPay = await call(env, "/api/releases/rel1/pay",
    { method: "POST", seat: { u: "u_pm", a: "acc_gc" } });
  ck("nor pay", pmPay.status === 403, `${pmPay.status}`);
  // But reading the money is what the progress panel does, and a PM opens
  // that -- a screen stricter than its route is the same lie as looser.
  await fund(env, 500000);
  const pmRead = await call(env, "/api/work-orders/wo1/funding", { seat: { u: "u_pm", a: "acc_gc" } });
  ck("a project manager may read it", pmRead.status === 200, `${pmRead.status} ${JSON.stringify(pmRead.body)}`);

  // And nobody else's work order at all.
  db.exec(`INSERT INTO accounts(id,name,subdomain,kind,plan) VALUES ('acc_x','Other','other','general_contractor','basic');
           INSERT INTO users(id,name,email) VALUES ('u_x','Pat','pat@other.test');
           INSERT INTO memberships(id,user_id,account_id,role) VALUES ('m_x','u_x','acc_x','admin');`);
  const theirs = await call(env, "/api/work-orders/wo1/funding", { seat: { u: "u_x", a: "acc_x" } });
  ck("somebody else's work order is not found", theirs.status === 404, `${theirs.status}`);
  const theirPay = await call(env, "/api/releases/rel1/pay",
    { method: "POST", seat: { u: "u_x", a: "acc_x" } });
  ck("nor is their release", theirPay.status === 404, `${theirPay.status}`);
}

console.log("\n-- the screen, statically, because the browser harnesses need a stack --");
{
  const APP = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  // One fetch for the money, held by the progress panel and passed down. Two
  // would be two answers about the same balance, at the figure that decides
  // whether money moves.
  ck("the money is fetched once and passed down",
    /<WoFunding woId=\{woId\} money=\{money\}/.test(APP)
      && /<SettleRelease release=\{settling\} mode=\{settleMode\} money=\{money\}/.test(APP));
  // Spending is admin-only on the route, so the buttons are admin-only on the
  // screen -- and the figures are not, because the read route allows a PM.
  ck("spending is gated on canPayOut", /\{canPayOut && \(\s*<div className="wof-acts">/.test(APP));
  ck("and canPayOut is the admin role, not canManage",
    /canPayOut=\{role === "admin"\}/.test(APP));
  // With no Stripe key `Pay` answers 501, so it is absent rather than dead --
  // and `Record payment` stays, because a cheque is a real way to pay somebody.
  ck("Pay is only offered where there is a rail behind it",
    /\{canPayOut && money\?\.configured && \(/.test(APP));
  ck("and Record payment is not gated on it",
    /setSettleMode\("record"\); setSettling\(rel\); \}\}>Record payment/.test(APP));
  // Coming back from Stripe is not success. The server asks Stripe.
  ck("funding is confirmed against the server, not the browser",
    /await api\.woFundConfirm\(woId, fundingId\)/.test(APP));
  ck("and a reply that is not ok is not treated as funded",
    /if \(!r\.ok\) \{ setErr/.test(APP));
  // The panel names the menu it points at, and the menu is called My account.
  ck("the payee-not-ready note names a menu that exists",
    /My account → Company → Getting paid/.test(APP));
}

console.log("\n-- and the panel does not offer a rail that is not there --");
{
  const db = seed();
  const noStripe = { DB: makeD1(db) };
  const r = await call(noStripe, "/api/work-orders/wo1/funding");
  ck("funding reads, and says it is not configured",
    r.status === 200 && r.body.configured === false, `${r.status} ${JSON.stringify(r.body)}`);
  const f = await call(noStripe, "/api/work-orders/wo1/fund", { method: "POST", body: { amountCents: 500000 } });
  ck("and funding is refused rather than half-attempted",
    f.status === 501 && f.body.error === "billing_not_configured", `${f.status} ${JSON.stringify(f.body)}`);
  const p = await call(noStripe, "/api/releases/rel1/pay", { method: "POST" });
  ck("as is paying", p.status === 501, `${p.status}`);
}

console.log("\n-- SubSub's fee: on top, spent by paying through SubSub, nothing on a cheque --");
{
  // The release carries a stamped fee of $20 on a $4,000 net. The account has
  // to fund both; the subcontractor is sent the $4,000 and not a cent less;
  // and the $20 stays, so it is neither available nor refundable afterwards.
  const { runCheck } = await import("./lib/check-sql.mjs");
  const db = seed();
  db.exec(`UPDATE wo_releases SET fee_bps = 50, fee_cents = 2000 WHERE id = 'rel1'`);
  const env = ENV(db);
  await fund(env, 400000);
  calls = [];
  const short = await call(env, "/api/releases/rel1/pay", { method: "POST" });
  ck("funding the net alone does not cover the fee",
    short.status === 409 && short.body.error === "not_funded" && short.body.fee === 2000,
    `${short.status} ${JSON.stringify(short.body)}`);
  ck("and nothing went to Stripe", !calls.some((x) => /\/transfers$/.test(x.url)));
  const m0 = await call(env, "/api/work-orders/wo1/funding");
  ck("the panel says what is owed, fee included",
    m0.body.owedCents === 402000 && m0.body.feesDueCents === 2000 && m0.body.shortfallCents === 2000,
    JSON.stringify(m0.body));

}
{
  // Funded with the fee as well. A fresh database rather than a second
  // funding on the first: the Stripe stub answers one intent id, and two rows
  // cannot share it.
  const { runCheck } = await import("./lib/check-sql.mjs");
  const db = seed();
  db.exec(`UPDATE wo_releases SET fee_bps = 50, fee_cents = 2000 WHERE id = 'rel1'`);
  const env = ENV(db);
  await fund(env, 402000);
  calls = [];
  const ok = await call(env, "/api/releases/rel1/pay", { method: "POST" });
  ck("with the fee funded it pays", ok.status === 200 && ok.body.feeCents === 2000,
    `${ok.status} ${JSON.stringify(ok.body)}`);
  const tr = calls.find((x) => /\/transfers$/.test(x.url));
  ck("the subcontractor is sent the whole net -- the fee is never theirs to pay",
    tr?.body?.amount === "400000", tr?.body?.amount);
  const m1 = await call(env, "/api/work-orders/wo1/funding");
  ck("the fee is spent: nothing left available", m1.body.availableCents === 0, String(m1.body.availableCents));
  ck("and nothing to send back", m1.body.refundableCents === 0, String(m1.body.refundableCents));
  ck("and it is counted as taken", m1.body.feesTakenCents === 2000, String(m1.body.feesTakenCents));
  ck("the fee check reads zero over a fee that was really charged",
    runCheck(db).m033_inv_fee_off_platform === 0, String(runCheck(db).m033_inv_fee_off_platform));
}
{
  // Recorded as paid by cheque: nothing went through SubSub, so nothing is
  // charged, and the money funded for the fee is the account's again.
  const { runCheck } = await import("./lib/check-sql.mjs");
  const db = seed();
  db.exec(`UPDATE wo_releases SET fee_bps = 50, fee_cents = 2000 WHERE id = 'rel1'`);
  const env = ENV(db);
  await fund(env, 402000);
  const r = await call(env, "/api/releases/rel1/settle", { method: "POST", body: { method: "check", reference: "1042" } });
  ck("a cheque is recorded", r.status === 200, `${r.status} ${JSON.stringify(r.body)}`);
  const rel = db.prepare(`SELECT fee_cents, fee_bps FROM wo_releases WHERE id='rel1'`).get();
  ck("and carries no fee", rel.fee_cents === 0, JSON.stringify(rel));
  const m = await call(env, "/api/work-orders/wo1/funding");
  ck("so everything funded is the account's to send back",
    m.body.refundableCents === 402000 && m.body.feesTakenCents === 0, JSON.stringify(m.body));
  ck("the fee check reads zero after a cheque",
    runCheck(db).m033_inv_fee_off_platform === 0, String(runCheck(db).m033_inv_fee_off_platform));
  // And the check itself, against the row it exists to catch -- every
  // invariant reads zero on an empty table, which proves nothing.
  db.exec(`UPDATE wo_releases SET fee_cents = 2000 WHERE id = 'rel1'`);
  ck("and it counts a fee on a release that never went through SubSub",
    runCheck(db).m033_inv_fee_off_platform === 1, String(runCheck(db).m033_inv_fee_off_platform));
}

console.log("\n-- a database behind the code says so --");
{
  const db = freshDb({ base: SCHEMA, migrations: [] });
  db.exec(`DROP TABLE IF EXISTS wo_funding; DROP TABLE IF EXISTS wo_transfers;`);
  db.exec(`
    INSERT INTO accounts(id,name,subdomain,kind,plan) VALUES ('acc_gc','Outerhome','outerhome','general_contractor','scale');
    INSERT INTO users(id,name,email) VALUES ('u_ad','Rae','rae@outerhome.test');
    INSERT INTO memberships(id,user_id,account_id,role) VALUES ('m_ad','u_ad','acc_gc','admin');
    INSERT INTO companies(id,company,contact,email) VALUES ('cmp_roof','Cascade','Dev','dev@cascade.test');
    INSERT INTO engagements(id,account_id,company_id,status) VALUES ('en1','acc_gc','cmp_roof','active');
    INSERT INTO jobs(id,account_id,title,date,trades) VALUES ('job1','acc_gc','Re-roof','${JOB_DAY}','["roofing"]');
    INSERT INTO work_orders(id,wo_number,job_id,trade,company_id,engagement_id,value_cents,status)
      VALUES ('wo1','WO-1001','job1','roofing','cmp_roof','en1',500000,'accepted');
  `);
  const env = ENV(db);
  const r = await call(env, "/api/work-orders/wo1/funding");
  ck("and names the migration rather than 500ing",
    r.status === 503 && r.body.migration === "051_escrow", `${r.status} ${JSON.stringify(r.body)}`);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
