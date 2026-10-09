// 075. REFERRALS, through the real Worker.
//
// What is pinned is what a later pass would undo, or get wrong quietly:
//
//   LAST TOUCH WINS. A code typed at signup beats the cookie a link left; a
//   cookie naming a code that does not exist falls back rather than to nothing.
//
//   A REWARD IS EARNED BY MONEY. Signing up earns nothing; the referred
//   account's first PAID invoice earns the rewards, once, however many paid
//   invoices follow. An invoice the account's own credit covered is not paying.
//
//   A SUB EARNS $100 PENDING AND THE BADGE; A HIRING ACCOUNT EARNS A MONTH FREE
//   FOR BOTH, handed to Stripe as a NEGATIVE customer-balance transaction with
//   an idempotency key -- or kept pending, said, until there is a customer.
//
//   THE LEDGER MOVES BY HAND, with finance access: approve, then pay with a
//   reference; void with a reason; never void money that has moved.
//
//   INVITES never answer "already on SubSub", and SubSub never texts anybody.
//
//   node --no-warnings scripts/referral-test.mjs

import { readFileSync } from "node:fs";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";
import { runCheck } from "./lib/check-sql.mjs";
import { normalizeCode, mintCode, CODE_ALPHABET, refCookieValue, parseRefCookie, lastTouch,
  rewardsFor, rewardMove, isPreferredSub, monthCreditCents, SCALE_MONTH_CENTS, weekStart,
  acquisitionByWeek, metroOf, referralLink, inviteText, smsHref, referrerKindForAccount } from "../shared/referral.js";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");
const SCHEMA = readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8");
const WORKER = readFileSync(new URL("../worker/index.js", import.meta.url), "utf8");

const sent = { mail: [], stripe: [] };
let stripeRefuse = false;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const body = init.body ? String(init.body) : "";
  const ok = (j, status = 200) => new Response(JSON.stringify(j), { status, headers: { "Content-Type": "application/json" } });
  if (u.includes("resend")) { sent.mail.push(JSON.parse(body)); return ok({ id: "em_1" }); }
  if (u.includes("stripe.test")) {
    sent.stripe.push({ url: u, body: Object.fromEntries(new URLSearchParams(body)),
      idem: init.headers?.["Idempotency-Key"] || null });
    if (stripeRefuse) return ok({ error: { message: "No such customer" } }, 400);
    return ok({ id: `cbtxn_${sent.stripe.length}`, object: "customer_balance_transaction" });
  }
  if (u.endsWith("/auth/v1/settings")) return ok({ external: { email: true, phone: false } });
  if (u.endsWith("/auth/v1/otp")) return ok({});
  if (u.endsWith("/auth/v1/verify")) {
    const b = JSON.parse(body);
    if (b.token !== "123456") return ok({ msg: "bad" }, 403);
    return ok({ access_token: "acc_tok", refresh_token: "ref_tok", expires_in: 3600,
      user: { id: "auth_newroof", email: "nora@newroof.test" } });
  }
  if (u.endsWith("/auth/v1/user")) {
    const who = String(init.headers?.Authorization || "").replace("Bearer ", "");
    if (who === "staff") return ok({ id: "auth_staff", email: "staff@subsub.test" });
    if (who === "support") return ok({ id: "auth_support", email: "support@subsub.test" });
    return ok({ msg: "bad token" }, 401);
  }
  return ok({});
};

const seed = () => {
  const db = freshDb({ base: SCHEMA, migrations: [] });
  db.exec(`
    INSERT INTO accounts(id,name,subdomain,kind,plan,billing,stripe_customer_id,created_at) VALUES
      ('acc_gc','Outerhome','outerhome','general_contractor','scale','monthly','cus_gc','2026-01-05'),
      ('acc_sub','Bay Roofing','bayroof','subcontractor','basic','monthly',NULL,'2026-01-06'),
      ('acc_basic','Cedar Builders','cedar','general_contractor','basic','annual',NULL,'2026-01-07');
    INSERT INTO companies(id,company,contact,email,city,state) VALUES
      ('cmp_bay','Bay Roofing','Rae Bay','rae@bay.test','Tacoma','WA'),
      ('cmp_gc','Outerhome','Dana Ruiz','dana@outerhome.test','Seattle','WA'),
      ('cmp_pac','Pacific Maintenance','Juan','juan@pac.test','Tacoma','WA');
    UPDATE accounts SET company_id = 'cmp_bay' WHERE id = 'acc_sub';
    UPDATE accounts SET company_id = 'cmp_gc' WHERE id = 'acc_gc';
    INSERT INTO engagements(id,account_id,company_id,status) VALUES
      ('en_bay','acc_gc','cmp_bay','active'),
      ('en_pac','acc_gc','cmp_pac','active');
    INSERT INTO users(id,name,email,auth_id) VALUES
      ('u_gc','Dana Ruiz','dana@outerhome.test',NULL),
      ('u_sub','Rae Bay','rae@bay.test',NULL),
      ('u_juan','Juan Soto','juan@pac.test',NULL),
      ('u_ten','Tia Tenant','tia@flat.test',NULL),
      ('u_basic','Cy Cedar','cy@cedar.test',NULL),
      ('u_staff','Staff','staff@subsub.test','auth_staff'),
      ('u_support','Support','support@subsub.test','auth_support');
    INSERT INTO memberships(id,user_id,account_id,role,company_id) VALUES
      ('m_gc','u_gc','acc_gc','admin',NULL),
      ('m_sub','u_sub','acc_sub','admin',NULL),
      ('m_juan','u_juan','acc_gc','contractor','cmp_pac'),
      ('m_ten','u_ten','acc_gc','tenant',NULL),
      ('m_basic','u_basic','acc_basic','admin',NULL);
    INSERT INTO superadmins(user_id,role,finance,impersonate) VALUES
      ('u_staff','superadmin',1,1), ('u_support','standard',0,0);
  `);
  const env = { DB: makeD1(db), FILES: { put: async () => {}, get: async () => null },
    RESEND_API_KEY: "re_x", MAIL_FROM: "SubSub <hi@subsub.work>", RESEND_API_BASE: "https://resend.test",
    STRIPE_SECRET_KEY: "sk_test_x", STRIPE_WEBHOOK_SECRET: "whsec_main", STRIPE_API_BASE: "https://stripe.test/v1" };
  // Two views of one database: customers sign in through the dev header stub,
  // and staff need Supabase configured to be told who a bearer token is.
  env.__live = { ...env, SUPABASE_URL: "http://supa.test", SUPABASE_ANON_KEY: "stub", STAFF_ALLOW_PASSWORD: "1" };
  return { db, env };
};

const call = (env0, path, { method = "GET", body, who = "u_gc", acct = "acc_gc", bearer, ip } = {}) =>
  worker.fetch(new Request(`https://api.subsub.work${path}`, {
    method, body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "Content-Type": "application/json", ...(ip ? { "CF-Connecting-IP": ip } : {}),
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : (who ? { "X-User-Id": who, "X-Account-Id": acct } : {})) },
  }), bearer && env0.__live ? env0.__live : env0);
const json = async (r) => [r.status, await r.json().catch(() => ({}))];

async function hook(env, payload) {
  const raw = JSON.stringify(payload);
  const t = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("whsec_main"),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${raw}`));
  const hex = Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
  return worker.fetch(new Request("https://api.subsub.work/api/stripe/webhook", {
    method: "POST", headers: { "stripe-signature": `t=${t},v1=${hex}`, "Content-Type": "application/json" }, body: raw,
  }), env);
}
let evtN = 0;
const paid = (env, customer, amountPaid = 9900, id = `in_${++evtN}`) => hook(env, {
  id: `evt_${++evtN}`, type: "invoice.paid",
  data: { object: { id, customer, status: "paid", amount_due: amountPaid, amount_paid: amountPaid,
    period_start: 1767225600, period_end: 1769904000, status_transitions: { paid_at: 1767225600 } } },
});

let n = 0;
const signup = (env, extra = {}) => {
  n++;
  return call(env, "/api/signup", { method: "POST", who: null, ip: `10.0.0.${n}`, body: {
    kind: "general_contractor", company: `Newco ${n}`, name: `Person ${n}`, email: `p${n}@newco.test`,
    subdomain: `newco${n}x`, plan: "scale", billing: "monthly", city: "Tacoma", state: "WA", ...extra } });
};
const attrOf = (db, accountId) => db.prepare(
  `SELECT * FROM referral_attributions WHERE subject_kind = 'account' AND subject_id = ?`).get(accountId);
const rewardsOf = (db, accountId) => db.prepare(
  `SELECT * FROM referral_rewards WHERE referred_account_id = ? ORDER BY kind, beneficiary`).all(accountId);

try {
  console.log("\n-- the rules --");
  {
    const code = mintCode(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 29]));
    ck("a minted code is eight characters from the alphabet", normalizeCode(code) === code && code.length === 8);
    ck("the alphabet has nothing that reads two ways", !/[01ILOU]/.test(CODE_ALPHABET));
    ck("a code is tidied, not translated",
      normalizeCode(" abcd-efgh ") === "ABCDEFGH" && normalizeCode("ABCD0FGH") === null && normalizeCode("ABCDEFG") === null);
    const v = refCookieValue({ code: "ABCDEFGH", channel: "link", at: Date.parse("2026-05-01T10:00:00Z") });
    const back = parseRefCookie(v);
    ck("the cookie round-trips", back?.code === "ABCDEFGH" && back?.channel === "link" && back?.at === "2026-05-01T10:00:00.000Z", v);
    ck("a cookie of the wrong shape is nothing", parseRefCookie("ABCDEFGH.spam.1") === null && parseRefCookie("") === null);
    ck("last touch wins", lastTouch([{ code: "AAAAAAAA", channel: "link", at: "2026-03-01" },
      { code: "BBBBBBBB", channel: "passport", at: "2026-05-01" }]).code === "BBBBBBBB");
    ck("a sub's code earns the sub $100 when a hiring account pays",
      JSON.stringify(rewardsFor({ codeKind: "sub", referredKind: "general_contractor" }))
        === JSON.stringify([{ kind: "sub_cash", beneficiary: "referrer", amountCents: 10000 }]));
    const gc = rewardsFor({ codeKind: "gc", referredKind: "property_manager", referredBilling: "annual", referrerBilling: "monthly" });
    ck("a hiring account's code earns a month free for both, each at their own cycle",
      gc.length === 2 && gc.find((r) => r.beneficiary === "referred").amountCents === 8250
        && gc.find((r) => r.beneficiary === "referrer").amountCents === 9900, JSON.stringify(gc));
    ck("a subcontractor account paying nothing earns nobody anything",
      rewardsFor({ codeKind: "gc", referredKind: "subcontractor" }).length === 0);
    // The credit is a month of what billing charges -- read off the Worker's
    // own figure, so the two cannot drift into a credit worth more than the month.
    ck("a month's credit is the month billing charges",
      /monthly = cycle === "annual" \? 8250 : 9900/.test(WORKER) && monthCreditCents("annual") === SCALE_MONTH_CENTS.annual
        && monthCreditCents("monthly") === 9900);
    ck("cash is approved, then paid", rewardMove({ kind: "sub_cash", status: "pending" }, "approve").to === "approved"
      && rewardMove({ kind: "sub_cash", status: "approved" }, "pay").to === "paid");
    ck("never paid straight from pending", rewardMove({ kind: "sub_cash", status: "pending" }, "pay").ok === false);
    ck("and money that has moved is never voided",
      rewardMove({ kind: "sub_cash", status: "paid" }, "void").error === "money_has_moved"
        && rewardMove({ kind: "gc_credit", status: "applied" }, "void").error === "money_has_moved");
    ck("a credit is applied, never approved", rewardMove({ kind: "gc_credit", status: "pending" }, "approve").ok === false);
    ck("the badge is a cash reward nobody voided",
      isPreferredSub([{ kind: "sub_cash", status: "pending" }]) && !isPreferredSub([{ kind: "sub_cash", status: "void" }])
        && !isPreferredSub([{ kind: "gc_credit", status: "applied" }]));
    ck("weeks start on Monday", weekStart("2026-10-09") === "2026-10-05" && weekStart("2026-10-05") === "2026-10-05");
    ck("a metro is the town and state, or says Unknown",
      metroOf({ city: "tacoma", state: "wa" }) === "Tacoma, WA" && metroOf({}) === "Unknown");
    ck("both kinds of link land on the hiring-side page", referralLink("ABCDEFGH") === "https://subsub.work/gc?ref=ABCDEFGH");
    ck("the invite text carries the link and the sender", /Bay Roofing/.test(inviteText({ company: "Bay Roofing", link: "L" })) && /L$/.test(inviteText({ company: "x", link: "L" })));
    ck("a text opens the sender's own messages app", smsHref("(253) 555-0100", "hi there").startsWith("sms:2535550100?&body=hi%20there"));
    ck("a subcontractor refers as a sub, a manager as the hiring side",
      referrerKindForAccount("subcontractor") === "sub" && referrerKindForAccount("property_manager") === "gc");
    const a = acquisitionByWeek({ today: "2026-10-09", weeks: 2, accounts: [
      { id: "a1", kind: "general_contractor", createdAt: "2026-09-01", city: "Tacoma", state: "WA" },
      { id: "a2", kind: "general_contractor", createdAt: "2026-09-02", city: "Tacoma", state: "WA" },
      { id: "a3", kind: "general_contractor", createdAt: "2026-10-06", city: "Tacoma", state: "WA" },
      { id: "a4", kind: "subcontractor", createdAt: "2026-10-06", city: "Tacoma", state: "WA" },
    ], attributions: { a3: "gc" } });
    const wk = a.overall.find((r) => r.week === "2026-10-05");
    ck("new hiring accounts per existing one, this week",
      wk.existing === 2 && wk.newGc === 1 && wk.referredByGc === 1 && wk.perExisting === 0.5, JSON.stringify(wk));
    ck("a subcontractor signup is not a GC acquired", a.overall.every((r) => r.newGc <= 1));
    ck("and by metro", a.byMetro[0]?.metro === "Tacoma, WA" && a.byMetro[0].newInRange === 1, JSON.stringify(a.byMetro[0]));
  }

  console.log("\n-- everybody who can refer has a code --");
  const S = seed();
  {
    const [st, me] = await json(await call(S.env, "/api/referrals/mine"));
    ck("a hiring account's admin refers as the hiring side", st === 200 && me.kind === "gc" && normalizeCode(me.code), JSON.stringify(me));
    ck("with a link to the hiring-side page", me.link === `https://subsub.work/gc?ref=${me.code}`);
    const [, again] = await json(await call(S.env, "/api/referrals/mine"));
    ck("and the same code every time", again.code === me.code);
    const [, sub] = await json(await call(S.env, "/api/referrals/mine", { who: "u_sub", acct: "acc_sub" }));
    ck("a subcontractor account refers as a sub", sub.kind === "sub" && sub.code && sub.code !== me.code);
    const [, seat] = await json(await call(S.env, "/api/referrals/mine", { who: "u_juan", acct: "acc_gc" }));
    ck("a contractor seat refers as its company", seat.kind === "sub"
      && S.db.prepare(`SELECT company_id FROM referral_codes WHERE code = ?`).get(seat.code)?.company_id === "cmp_pac");
    const [tst] = await json(await call(S.env, "/api/referrals/mine", { who: "u_ten", acct: "acc_gc" }));
    ck("a tenant refers nobody", tst === 403);
  }

  console.log("\n-- a link opened --");
  const gcCode = S.db.prepare(`SELECT code FROM referral_codes WHERE account_id = 'acc_gc'`).get().code;
  const subCode = S.db.prepare(`SELECT code FROM referral_codes WHERE company_id = 'cmp_bay'`).get().code;
  {
    const [st, t] = await json(await call(S.env, "/api/referrals/touch", { method: "POST", who: null, body: { code: subCode, channel: "link" } }));
    ck("the landing page is told whose code it is", st === 200 && t.ok && t.from === "Bay Roofing" && t.kind === "sub", JSON.stringify(t));
    ck("and the arrival is counted, with nothing about the visitor",
      S.db.prepare(`SELECT COUNT(*) AS n FROM referral_touches WHERE code = ?`).get(subCode).n === 1);
    const [st2, t2] = await json(await call(S.env, "/api/referrals/touch", { method: "POST", who: null, body: { code: "ZZZZZZZZ" } }));
    ck("an unknown code is a plain no, not a 404", st2 === 200 && t2.ok === false && !t2.from);
    const [, t3] = await json(await call(S.env, "/api/referrals/touch", { method: "POST", who: null, body: { code: subCode, channel: "code" } }));
    ck("a touch cannot claim to be a typed code", S.db.prepare(
      `SELECT channel FROM referral_touches WHERE code = ? ORDER BY rowid DESC LIMIT 1`).get(subCode).channel === "link" && t3.ok);
  }

  console.log("\n-- signing up, last touch wins --");
  let viaSub, viaGc, viaTyped;
  {
    const [st, r] = await json(await signup(S.env, { referral: { code: subCode, channel: "link", at: new Date(Date.now() - 86400000).toISOString() } }));
    viaSub = r.accountId;
    ck("a signup carrying a sub's link is credited to the sub", st === 201 && attrOf(S.db, viaSub)?.code === subCode
      && attrOf(S.db, viaSub)?.channel === "link", JSON.stringify(r));
    const [, r2] = await json(await signup(S.env, { referral: { code: gcCode, channel: "passport", at: new Date().toISOString() } }));
    viaGc = r2.accountId;
    ck("and one carrying a hiring account's to them", attrOf(S.db, viaGc)?.code === gcCode && attrOf(S.db, viaGc)?.channel === "passport");
    const [, r3] = await json(await signup(S.env, { refCode: gcCode.toLowerCase(),
      referral: { code: subCode, channel: "link", at: new Date().toISOString() } }));
    viaTyped = r3.accountId;
    ck("a code typed on the form beats the cookie", attrOf(S.db, viaTyped)?.code === gcCode && attrOf(S.db, viaTyped)?.channel === "code");
    ck("and the typed code is counted as a touch",
      S.db.prepare(`SELECT COUNT(*) AS n FROM referral_touches WHERE code = ? AND channel = 'code'`).get(gcCode).n === 1);
    const [, r4] = await json(await signup(S.env, { refCode: "ZZZZZZZZ",
      referral: { code: subCode, channel: "link", at: new Date().toISOString() } }));
    ck("a typed code that is not one falls back to the cookie", attrOf(S.db, r4.accountId)?.code === subCode);
    const [, r5] = await json(await signup(S.env, { referral: { code: subCode, channel: "link", at: "2020-01-01T00:00:00Z" } }));
    ck("a cookie older than its life is ignored", !attrOf(S.db, r5.accountId));
    const [st6, r6] = await json(await signup(S.env, {}));
    ck("and no referral is no row, not a failure", st6 === 201 && !attrOf(S.db, r6.accountId));
  }

  console.log("\n-- the first paid invoice --");
  {
    S.db.prepare(`UPDATE accounts SET stripe_customer_id = 'cus_viasub' WHERE id = ?`).run(viaSub);
    const before = sent.mail.length;
    await paid(S.env, "cus_viasub", 0);
    ck("an invoice the account did not pay for earns nothing", rewardsOf(S.db, viaSub).length === 0);
    const res = await paid(S.env, "cus_viasub", 9900);
    ck("the webhook answers", res.status === 200);
    const r = rewardsOf(S.db, viaSub);
    ck("a sub's referral paying earns the sub $100, pending",
      r.length === 1 && r[0].kind === "sub_cash" && r[0].amount_cents === 10000 && r[0].status === "pending"
        && r[0].beneficiary_company_id === "cmp_bay", JSON.stringify(r));
    const mail = sent.mail.slice(before).find((m) => /\$100/.test(m.subject));
    ck("and the sub is told, at the company's address", mail && (mail.to === "rae@bay.test" || mail.to?.[0] === "rae@bay.test")
      && /checked by a person/.test(mail.text), JSON.stringify(mail?.to));
    await paid(S.env, "cus_viasub", 9900);
    ck("a second paid invoice earns nothing more", rewardsOf(S.db, viaSub).length === 1);
    const [, subs] = await json(await call(S.env, "/api/subs"));
    ck("the roster carries the badge", subs.find((x) => x.id === "cmp_bay")?.preferredSub === true
      && subs.find((x) => x.id === "cmp_pac")?.preferredSub === false, JSON.stringify(subs.map((x) => [x.id, x.preferredSub])));
    const [, mine] = await json(await call(S.env, "/api/referrals/mine", { who: "u_sub", acct: "acc_sub" }));
    ck("and the sub's own screen says Preferred Sub and lists who paid", mine.preferredSub === true
      && mine.referred.some((x) => x.paying && x.reward?.status === "pending"), JSON.stringify(mine.referred));
  }
  {
    S.db.prepare(`UPDATE accounts SET stripe_customer_id = 'cus_viagc' WHERE id = ?`).run(viaGc);
    sent.stripe.length = 0;
    await paid(S.env, "cus_viagc", 9900);
    const r = rewardsOf(S.db, viaGc);
    ck("a hiring account's referral paying earns two credits", r.length === 2 && r.every((x) => x.kind === "gc_credit"), JSON.stringify(r));
    ck("both applied", r.every((x) => x.status === "applied" && x.processor_ref), JSON.stringify(r.map((x) => [x.beneficiary, x.status, x.error])));
    const calls = sent.stripe.filter((x) => /balance_transactions/.test(x.url));
    ck("as negative customer-balance transactions, one per side",
      calls.length === 2 && calls.every((x) => Number(x.body.amount) === -9900 && x.body.currency === "usd"),
      JSON.stringify(calls.map((x) => [x.url, x.body.amount])));
    ck("on the right two customers", calls.some((x) => /cus_viagc/.test(x.url)) && calls.some((x) => /cus_gc/.test(x.url)));
    ck("each under the reward's own idempotency key", calls.every((x) => /^ref-credit:/.test(x.idem || "")));
  }
  {
    // The typed-code signup was credited to Outerhome too; this time the
    // REFERRER is on Basic with no customer, so its half waits.
    await json(await call(S.env, "/api/referrals/mine", { who: "u_basic", acct: "acc_basic" }));
    S.db.prepare(`UPDATE referral_attributions SET code = (SELECT code FROM referral_codes WHERE account_id = 'acc_basic') WHERE subject_id = ?`).run(viaTyped);
    S.db.prepare(`UPDATE accounts SET stripe_customer_id = 'cus_typed' WHERE id = ?`).run(viaTyped);
    await paid(S.env, "cus_typed", 9900);
    const r = rewardsOf(S.db, viaTyped);
    const theirs = r.find((x) => x.beneficiary === "referrer");
    ck("a referrer with no billing yet keeps the credit pending, and says why",
      theirs?.status === "pending" && theirs.error === "no_billing_yet" && theirs.amount_cents === 8250, JSON.stringify(theirs));
    ck("the referred side's half is applied regardless", r.find((x) => x.beneficiary === "referred")?.status === "applied");
    const [, mine] = await json(await call(S.env, "/api/referrals/mine", { who: "u_basic", acct: "acc_basic" }));
    ck("their screen says it is waiting on billing", mine.rewards.some((x) => x.waiting === true));
    S.db.prepare(`UPDATE accounts SET stripe_customer_id = 'cus_cedar' WHERE id = 'acc_basic'`).run();
    const [, sw] = await json(await worker.fetch(new Request("https://api.subsub.work/api/cron/referrals",
      { headers: { Authorization: "Bearer cron" } }), { ...S.env, CRON_SECRET: "cron" }));
    ck("the nightly sweep applies it the day they have a customer",
      sw.applied === 1 && rewardsOf(S.db, viaTyped).find((x) => x.beneficiary === "referrer").status === "applied", JSON.stringify(sw));
  }
  {
    // A webhook that never arrived: the sweep is the safety net.
    const [, r] = await json(await signup(S.env, { referral: { code: subCode, channel: "link", at: new Date().toISOString() } }));
    S.db.prepare(`INSERT INTO invoices (id, account_id, amount_cents, status, period_start, period_end) VALUES ('in_lost', ?, 9900, 'paid', '2026-01-01', '2026-02-01')`).run(r.accountId);
    await json(await worker.fetch(new Request("https://api.subsub.work/api/cron/referrals",
      { headers: { Authorization: "Bearer cron" } }), { ...S.env, CRON_SECRET: "cron" }));
    ck("a paid invoice the webhook missed still earns, from the sweep", rewardsOf(S.db, r.accountId).length === 1);
  }

  console.log("\n-- the ledger, by hand --");
  const subReward = rewardsOf(S.db, viaSub)[0];
  {
    const act = (body, bearer = "staff") => call(S.env, `/api/platform/referrals/rewards/${subReward.id}`, { method: "POST", bearer, who: null, body });
    const [stS] = await json(await act({ action: "approve" }, "support"));
    ck("staff without finance access cannot move money", stS === 403);
    const [stP, p0] = await json(await act({ action: "pay", reference: "chk 1" }));
    ck("nobody is paid before they are approved", stP === 409 && p0.error === "wrong_status");
    const [stA, a] = await json(await act({ action: "approve" }));
    ck("approve", stA === 200 && a.status === "approved");
    const [stR, r0] = await json(await act({ action: "pay" }));
    ck("paying needs a reference", stR === 400 && r0.error === "reference_required");
    const [stY, y] = await json(await act({ action: "pay", reference: "Check 1043" }));
    const row = S.db.prepare(`SELECT * FROM referral_rewards WHERE id = ?`).get(subReward.id);
    ck("then mark paid, with who and how", stY === 200 && y.status === "paid" && row.reference === "Check 1043" && row.paid_by === "u_staff");
    const [stV, v] = await json(await act({ action: "void", note: "oops" }));
    ck("and paid money is never voided", stV === 409 && v.error === "money_has_moved");
    ck("every move is on the platform log",
      S.db.prepare(`SELECT COUNT(*) AS n FROM events WHERE kind LIKE 'referral.reward_%' AND actor_id = 'u_staff'`).get().n >= 2);
    const [, list] = await json(await call(S.env, "/api/platform/referrals", { bearer: "staff", who: null }));
    ck("the console lists the ledger with who earned it", list.rewards.some((x) => x.id === subReward.id && x.to === "Bay Roofing" && x.status === "paid"));
    ck("and the referrers bringing accounts in", list.referrers.some((x) => x.code === subCode && x.referred >= 2));
    const [, acq] = await json(await call(S.env, "/api/platform/referrals/acquisition?weeks=4", { bearer: "staff", who: null }));
    const thisWeek = acq.overall[acq.overall.length - 1];
    ck("and new hiring accounts per existing one, this week", thisWeek.newGc >= 5 && thisWeek.existing === 2
      && thisWeek.referredByGc >= 1 && thisWeek.referredBySub >= 1, JSON.stringify(thisWeek));
    ck("by metro", acq.byMetro.some((m) => m.metro === "Tacoma, WA"), JSON.stringify(acq.byMetro.map((m) => m.metro)));
    const [stC] = await json(await call(S.env.__live, "/api/platform/referrals"));
    ck("and none of it is a customer screen", stC === 401 || stC === 403);
  }
  console.log("\n-- invites --");
  {
    const before = sent.mail.length;
    const [st, r] = await json(await call(S.env, "/api/referrals/invites", { method: "POST", who: "u_sub", acct: "acc_sub",
      body: { emails: ["boss@builder.test", "nope", "dana@outerhome.test"], sms: 2 } }));
    ck("emails go, a bad address is named", st === 200 && r.sent === 2 && r.texted === 2
      && r.skipped.length === 1 && r.skipped[0].reason === "invalid", JSON.stringify(r));
    const out = sent.mail.slice(before);
    ck("the invite goes under the sender's name, with their address to reply to",
      out.length === 1 && /Bay Roofing invited you/.test(out[0].subject) && (out[0].reply_to === "rae@bay.test" || out[0].reply_to?.[0] === "rae@bay.test"),
      JSON.stringify(out.map((m) => [m.to, m.reply_to])));
    ck("an address already on SubSub is not emailed, and the reply does not say so",
      !out.some((m) => JSON.stringify(m.to).includes("dana@outerhome.test")) && !JSON.stringify(r).includes("already"));
    ck("SubSub sends no text -- they are only counted",
      S.db.prepare(`SELECT COUNT(*) AS n FROM referral_invites WHERE channel = 'sms' AND to_email IS NULL`).get().n === 2);
    const [, r2] = await json(await call(S.env, "/api/referrals/invites", { method: "POST", who: "u_sub", acct: "acc_sub",
      body: { emails: ["boss@builder.test"] } }));
    ck("the same address twice in a month is not emailed twice", r2.sent === 0 && r2.skipped[0]?.reason === "recent");
    const many = Array.from({ length: 30 }, (_, i) => `g${i}@builder.test`);
    const [, r3] = await json(await call(S.env, "/api/referrals/invites", { method: "POST", who: "u_sub", acct: "acc_sub",
      body: { emails: many } }));
    ck("and there is a daily ceiling", r3.sent + 4 <= 25 && r3.skipped.some((x) => x.reason === "limit"), JSON.stringify({ sent: r3.sent, left: r3.left }));
  }


  console.log("\n-- a sub claiming a work order is credited to the account that sent it --");
  {
    const C = seed();
    const DOCS = `1,1,1,1,'{"insurance":"coi.pdf","bond":"bond.pdf","contract":"agr.pdf","w9":"w9.pdf"}'`;
    const VERIFIED = '{"insurance":{"status":"verified"},"bond":{"status":"verified"},"contract":{"status":"verified"},"w9":{"status":"verified"}}';
    C.db.exec(`
      INSERT INTO companies(id,company,contact,email,license,insurance,bond,contract,w9,doc_files) VALUES
        ('cmp_new','New Roof Co','Nora','nora@newroof.test','NEWRC*1',${DOCS});
      INSERT INTO engagements(id,account_id,company_id,status,categories,doc_review) VALUES
        ('en_new','acc_gc','cmp_new','active','["roofing"]','${VERIFIED}');
      INSERT INTO jobs(id,account_id,title,address,zip,date,trades,status) VALUES
        ('j1','acc_gc','Reroof','12 Elm St','98101','2026-11-20','["roofing"]','active');
    `);
    const [sa, a] = await json(await call(C.env, "/api/jobs/j1/assign", { method: "POST", body: { trade: "roofing", companyId: "cmp_new", value: 1200 } }));
    const tok = C.db.prepare(`SELECT token FROM wo_claim_links`).get()?.token;
    ck("the work order went out with a claim link", sa < 300 && !!tok, JSON.stringify(a).slice(0, 200));
    await call(C.env.__live, `/api/claim/${tok}/code`, { method: "POST", who: null, body: { email: "nora@newroof.test" } });
    const [sv, v] = await json(await call(C.env.__live, `/api/claim/${tok}/verify`, { method: "POST", who: null,
      body: { email: "nora@newroof.test", code: "123456" } }));
    const attr = C.db.prepare(`SELECT ra.*, rc.account_id FROM referral_attributions ra JOIN referral_codes rc ON rc.code = ra.code
      WHERE ra.subject_kind = 'company' AND ra.subject_id = 'cmp_new'`).get();
    ck("the claim is credited to the sending account's code, as a claim",
      sv === 200 && v.attributed && attr?.account_id === "acc_gc" && attr?.channel === "claim", JSON.stringify({ sv, v: v.error, attr }));
    ck("and counted as a touch", C.db.prepare(`SELECT COUNT(*) AS n FROM referral_touches WHERE channel = 'claim'`).get().n === 1);
  }
  console.log("\n-- the invariants, against real rows --");
  {
    let row = runCheck(S.db);
    ck("every referral invariant reads zero on a working ledger",
      row.m075_inv_reward_unattributed === 0 && row.m075_inv_paid_unreferenced === 0 && row.m075_inv_credit_unrecorded === 0,
      JSON.stringify([row.m075_inv_reward_unattributed, row.m075_inv_paid_unreferenced, row.m075_inv_credit_unrecorded]));
    ck("and the did-I-run-it checks see the tables", row.m075_referral_rewards >= 1 && row.m076_leads >= 1);
    S.db.prepare(`UPDATE referral_rewards SET reference = NULL WHERE id = ?`).run(subReward.id);
    S.db.prepare(`UPDATE referral_rewards SET processor_ref = NULL WHERE status = 'applied' AND rowid = (SELECT MIN(rowid) FROM referral_rewards WHERE status = 'applied')`).run();
    S.db.prepare(`DELETE FROM referral_attributions WHERE subject_id = ?`).run(viaGc);
    row = runCheck(S.db);
    ck("and each counts the row it exists to catch",
      row.m075_inv_paid_unreferenced === 1 && row.m075_inv_credit_unrecorded === 1 && row.m075_inv_reward_unattributed === 2,
      JSON.stringify([row.m075_inv_reward_unattributed, row.m075_inv_paid_unreferenced, row.m075_inv_credit_unrecorded]));
  }

  console.log("\n-- a database behind the code --");
  {
    const B = seed();
    B.db.exec(`DROP TABLE referral_invites; DROP TABLE referral_rewards; DROP TABLE referral_attributions; DROP TABLE referral_touches; DROP TABLE referral_codes;`);
    const [st, r] = await json(await call(B.env, "/api/referrals/mine"));
    ck("the screen names the migration", st === 503 && r.migration === "075_referrals", JSON.stringify(r));
    const [st2] = await json(await signup(B.env, { refCode: "ABCDEFGH" }));
    ck("and a signup still goes", st2 === 201);
    const res = await paid(B.env, "cus_gc", 9900);
    ck("and the paid-invoice webhook still answers", res.status === 200);
  }
} catch (err) {
  console.error(err);
  fail++;
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
