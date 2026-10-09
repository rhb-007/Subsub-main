// "SENT VIA SUBSUB" AND THE FREE LOGIN BEHIND IT, through the real Worker.
//
// Every work order a hiring account sends carries one line saying where it
// came from and a link, /claim/<token>. The sub opens it on a phone, reads the
// work order, and makes a free login with their mobile and a texted code; the
// account that sent it is recorded as the one that brought them in.
//
// What is pinned here is what a later pass would undo:
//
//   THE LINK IS ON EVERYTHING THAT GOES OUT -- the email, the text, and the
//   work order's own read -- and it is the SAME link in all three, because a
//   row per work order is what "sent" counts.
//
//   HOLDING THE LINK IS NOT BEING THE COMPANY. A forwarded link with a mobile
//   on record only claims with THAT mobile, and the check that matters is on
//   the number Supabase verified, not the number in the body.
//
//   A COMPANY ALREADY ON SUBSUB IS A SIGN-IN, NOT A RECRUITMENT. Nothing is
//   credited for it, and the first account to bring a sub in keeps the credit.
//
//   AND THERE IS NO SETTING THAT REMOVES THE FOOTER, on any plan.
//
//   node --no-warnings scripts/claim-test.mjs

import { readFileSync } from "node:fs";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";
import { claimUrl, claimPathToken, footerText, footerSms, claimPhoneProblem, claimState,
  claimFunnel, maskPhone, validClaimToken, claimEmailProblem, maskEmail, cleanEmail } from "../shared/claim.js";
import { runCheck } from "./lib/check-sql.mjs";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");
const SCHEMA = readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8");
const WORKER = readFileSync(new URL("../worker/index.js", import.meta.url), "utf8");
const MAIL = readFileSync(new URL("../worker/mail.js", import.meta.url), "utf8");

const VERIFIED = '{"insurance":{"status":"verified"},"bond":{"status":"verified"},'
  + '"contract":{"status":"verified"},"w9":{"status":"verified"}}';
const DOCS = `1,1,1,1,'{"insurance":"coi.pdf","bond":"bond.pdf","contract":"agr.pdf","w9":"w9.pdf"}'`;

// ---- what leaves: email, text, and Supabase's code and verify -------------
const sent = { mail: [], sms: [], otp: [], verify: [] };
let verifyPhone = "12065550101";
let verifyEmail = "rae@bay.test";
let otpReply = null;
// What Supabase says is switched on. Phone is OFF by default, which is the
// state before an SMS provider exists -- and the page must not offer it then.
let settings = { external: { email: true, phone: false } };
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const body = init.body ? (typeof init.body === "string" ? init.body : String(init.body)) : "";
  const ok = (j, status = 200) => new Response(JSON.stringify(j), { status, headers: { "Content-Type": "application/json" } });
  if (u.includes("resend")) { sent.mail.push(JSON.parse(body)); return ok({ id: "em_1" }); }
  if (u.includes("twilio")) { sent.sms.push(Object.fromEntries(new URLSearchParams(body))); return ok({ sid: "SM1", status: "queued" }); }
  // Who a bearer token is, for the staff console's routes.
  if (u.endsWith("/auth/v1/user")) {
    const who = String(init.headers?.Authorization || "").replace("Bearer ", "");
    if (who === "staff") return ok({ id: "auth_staff", email: "staff@subsub.test" });
    if (who === "juan") return ok({ id: "auth_juan", email: "juan@pac.test" });
    return ok({ msg: "bad token" }, 401);
  }
  if (u.endsWith("/auth/v1/settings")) return settings ? ok(settings) : ok({ msg: "down" }, 500);
  if (u.endsWith("/auth/v1/otp")) {
    sent.otp.push(JSON.parse(body));
    return otpReply ? ok(otpReply.body, otpReply.status) : ok({});
  }
  if (u.endsWith("/auth/v1/verify")) {
    const b = JSON.parse(body);
    sent.verify.push(b);
    if (b.token !== "123456") return ok({ msg: "Token has expired or is invalid" }, 403);
    if (b.type === "email") return ok({ access_token: "acc_tok", refresh_token: "ref_tok", expires_in: 3600,
      user: { id: `auth_${verifyEmail}`, email: verifyEmail } });
    return ok({ access_token: "acc_tok", refresh_token: "ref_tok", expires_in: 3600,
      user: { id: `auth_${verifyPhone}`, phone: verifyPhone } });
  }
  return ok({});
};

const seed = () => {
  const db = freshDb({ base: SCHEMA, migrations: [] });
  db.exec(`
    INSERT INTO accounts(id,name,subdomain,kind,plan) VALUES
      ('acc_gc','Outerhome','outerhome','general_contractor','scale'),
      ('acc_pm','Cascade Management','cascade','property_manager','basic');
    INSERT INTO companies(id,company,contact,email,phone,notify,license,insurance,bond,contract,w9,doc_files) VALUES
      -- Nobody can sign in as this one: the recruitment case.
      ('cmp_new','Bay Roofing','Rae Bay','rae@bay.test','(206)555-0101','{"email":true,"sms":true}','BAYRR*222',${DOCS}),
      -- No mobile on record: nothing to check a number against.
      ('cmp_nop','Quiet Gutters','Quinn','quinn@gut.test',NULL,'{}','QG*1',${DOCS}),
      -- Already on SubSub, through ANOTHER account: a sign-in, not a recruit.
      ('cmp_on','Pacific Maintenance','Juan','juan@pac.test','(206)555-0199','{}','PAC*1',${DOCS});
    INSERT INTO engagements(id,account_id,company_id,status,categories,doc_review) VALUES
      ('en_new','acc_gc','cmp_new','active','["roofing","gutters"]','${VERIFIED}'),
      ('en_nop','acc_gc','cmp_nop','active','["gutters"]','${VERIFIED}'),
      ('en_on','acc_gc','cmp_on','active','["siding"]','${VERIFIED}'),
      ('en_pm','acc_pm','cmp_new','active','["roofing"]','${VERIFIED}');
    INSERT INTO jobs(id,account_id,title,address,zip,date,trades,status,scope) VALUES
      ('j1','acc_gc','Reroof the Lee house','12 Elm St','98101','2026-11-20','["roofing","gutters","siding"]','active','Tear off and reroof'),
      ('j2','acc_pm','Patch the flat roof','9 Pine','98102','2026-11-22','["roofing"]','active',NULL);
    INSERT INTO users(id,name,email,auth_id,phone) VALUES
      ('u_gc','Dana Ruiz','dana@outerhome.test',NULL,NULL),
      ('u_pm','Chris Lane','chris@cascade.test',NULL,NULL),
      ('u_juan','Juan Soto','juan@pac.test','auth_juan','(206)555-0199'),
      ('u_staff','Staff','staff@subsub.test','auth_staff',NULL);
    INSERT INTO memberships(id,user_id,account_id,role,company_id) VALUES
      ('m_gc','u_gc','acc_gc','admin',NULL),
      ('m_pm','u_pm','acc_pm','admin',NULL),
      ('m_juan','u_juan','acc_pm','contractor','cmp_on');
    INSERT INTO superadmins(user_id,role,finance,impersonate) VALUES ('u_staff','superadmin',1,1);
  `);
  const base = { DB: makeD1(db), FILES: { put: async () => {}, get: async () => null },
    RESEND_API_KEY: "re_x", MAIL_FROM: "SubSub <hi@subsub.work>", RESEND_API_BASE: "https://resend.test",
    TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "t", TWILIO_FROM: "+12065550000",
    TWILIO_API_BASE: "https://twilio.test" };
  // Two views of one database: the hiring side signs in through the dev
  // header stub, and the claim page needs Supabase configured to send a code.
  return { db, env: base,
    live: { ...base, SUPABASE_URL: "http://supa.test", SUPABASE_ANON_KEY: "stub", STAFF_ALLOW_PASSWORD: "1" } };
};

const call = (env, path, { method = "GET", body, who = "u_gc", acct = "acc_gc", bearer } = {}) =>
  worker.fetch(new Request(`https://api.subsub.work${path}`, {
    method, body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "Content-Type": "application/json",
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : { "X-User-Id": who, "X-Account-Id": acct }) },
  }), env);
const json = async (r) => [r.status, await r.json().catch(() => ({}))];
const issue = async (env, jobId, trade, companyId, who = "u_gc", acct = "acc_gc") =>
  json(await call(env, `/api/jobs/${jobId}/assign`, { method: "POST", who, acct,
    body: { trade, companyId, value: 1200 } }));
const tokenOf = (db, woId) => db.prepare(`SELECT token FROM wo_claim_links WHERE work_order_id = ?`).get(woId)?.token;

try {
  console.log("\n-- the rules, before anything is driven --");
  {
    const tok = "a".repeat(64);
    ck("the link is SubSub's own front door", claimUrl(tok) === `https://app.subsub.work/claim/${tok}`);
    ck("and a token of the wrong shape makes no link", claimUrl("abc") === null && !validClaimToken("A".repeat(64)));
    ck("the page reads its token off the path, slash or not",
      claimPathToken(`/claim/${tok}`) === tok && claimPathToken(`/claim/${tok}/`) === tok);
    ck("and nothing else is a claim page", claimPathToken(`/claim/${tok}/x`) === null && claimPathToken("/") === null);
    ck("the footer says how it was sent and that it is free",
      /Sent via SubSub/.test(footerText(null)) && /free for subcontractors, forever/.test(footerText(null)));
    ck("and carries the link when there is one", footerText(claimUrl(tok)).includes(claimUrl(tok)));
    ck("the text-message line does too, in one line",
      footerSms(claimUrl(tok)).includes(claimUrl(tok)) && !footerSms(claimUrl(tok)).includes("\n"));
    ck("a number on record must be the number used",
      claimPhoneProblem({ entered: "206-555-0102", onRecord: "(206)555-0101" }) === "phone_mismatch");
    ck("written any way at all",
      claimPhoneProblem({ entered: "+1 (206) 555 0101", onRecord: "(206)555-0101" }) === null);
    ck("with nothing on record any real number will do",
      claimPhoneProblem({ entered: "4255550123", onRecord: null }) === null);
    ck("and a number that is not one is refused", claimPhoneProblem({ entered: "12", onRecord: null }) === "bad_phone");
    ck("the hint is the last four and never the number",
      maskPhone("(206)555-0101") === "(•••) •••-0101");
    ck("a used link reads claimed even with a login behind it",
      claimState({ claimedAt: "x", companyHasLogin: true }) === "claimed");
    ck("a company with a login reads on SubSub",
      claimState({ claimedAt: null, companyHasLogin: true }) === "on_subsub");
    ck("an email on record must be the email used",
      claimEmailProblem({ entered: "other@bay.test", onRecord: "rae@bay.test" }) === "email_mismatch");
    ck("in any case, with spaces round it",
      claimEmailProblem({ entered: " RAE@Bay.test ", onRecord: "rae@bay.test" }) === null);
    ck("with none on record any real address will do",
      claimEmailProblem({ entered: "x@y.test", onRecord: null }) === null);
    ck("the product's own no-address placeholder is not an address",
      cleanEmail("u1@no-email.invalid") === null && claimEmailProblem({ entered: "nope", onRecord: null }) === "bad_email");
    ck("the email hint keeps one letter and the domain", maskEmail("rae@bay.test") === "r•••@bay.test");
    const f = claimFunnel({ sent: 4, opened: 2, claimed: 1 });
    ck("the funnel's rates", f.openRate === 50 && f.claimRate === 50, JSON.stringify(f));
    ck("and no rate over nothing", claimFunnel({}).openRate === null && claimFunnel({}).claimRate === null);
  }

  console.log("\n-- the link goes out on everything --");
  const { db, env, live } = seed();
  const [s, out] = await issue(env, "j1", "roofing", "cmp_new");
  const woId = out?.workOrder?.id || out?.id || db.prepare(`SELECT id FROM work_orders WHERE company_id='cmp_new' AND job_id='j1'`).get()?.id;
  ck("the work order is issued", s === 201 || s === 200, `${s} ${JSON.stringify(out).slice(0, 200)}`);
  const tok = tokenOf(db, woId);
  const url = claimUrl(tok);
  ck("and a claim link was minted for it, stamped with who sent it to whom", !!tok
    && db.prepare(`SELECT account_id, company_id FROM wo_claim_links WHERE token = ?`).get(tok)?.account_id === "acc_gc"
    && db.prepare(`SELECT company_id FROM wo_claim_links WHERE token = ?`).get(tok)?.company_id === "cmp_new");
  const mail = sent.mail.find((m) => /Bay|roof/i.test(JSON.stringify(m)));
  ck("the email's text carries the footer and the link",
    !!mail && mail.text.includes("Sent via SubSub") && mail.text.includes(url), mail?.text?.slice(-300));
  ck("and its HTML links it", !!mail && mail.html.includes(`href="${url}"`));
  const sms = sent.sms[0];
  ck("the text message carries it too", !!sms && sms.Body.includes(url), sms?.Body);
  const [sl, linkOut] = await json(await call(env, `/api/work-orders/${woId}/claim-link`));
  ck("the work order's own read hands back the same link", sl === 200 && linkOut.url === url, JSON.stringify(linkOut));
  ck("and only one row exists for it however often it is asked",
    db.prepare(`SELECT COUNT(*) AS n FROM wo_claim_links WHERE work_order_id = ?`).get(woId).n === 1);
  // A contractor on another account must not be handed this account's link.
  const [sx] = await json(await call(env, `/api/work-orders/${woId}/claim-link`, { who: "u_juan", acct: "acc_pm" }));
  ck("somebody with no claim on the work order gets nothing", sx === 404 || sx === 403, String(sx));

  console.log("\n-- the page --");
  {
    const [s1, page] = await json(await call(live, `/api/claim/${tok}`));
    ck("the link opens with no sign-in at all", s1 === 200, `${s1} ${JSON.stringify(page)}`);
    ck("and offers to make a login by email", page.state === "claimable" && page.emailLogin === true);
    ck("never by text while Supabase has no phone sign-in", page.phoneLogin === false, String(page.phoneLogin));
    ck("with the email hint and never the whole address",
      page.emailHint === "r•••@bay.test" && !JSON.stringify(page).includes("rae@bay.test"), page.emailHint);
    settings = { external: { email: true, phone: true } };
    const [, pOn] = await json(await call(live, `/api/claim/${tok}`));
    ck("text is offered once Supabase says phone is on", pOn.phoneLogin === true);
    settings = null;
    const [, pDown] = await json(await call(live, `/api/claim/${tok}`));
    ck("an unreadable answer offers email alone, never a guess at phone",
      pDown.phoneLogin === false && pDown.emailLogin === true, JSON.stringify([pDown.phoneLogin, pDown.emailLogin]));
    settings = { external: { email: true, phone: false } };
    db.exec(`UPDATE wo_claim_links SET open_count = 0 WHERE token = '${tok}'`);
    ck("it shows the work order they were sent",
      page.workOrder?.trade === "roofing" && page.workOrder?.title === "Reroof the Lee house"
      && page.workOrder?.address === "12 Elm St" && page.workOrder?.valueCents === 120000,
      JSON.stringify(page.workOrder));
    ck("and who sent it", page.account?.name === "Outerhome" && /outerhome\.subsub\.work/.test(page.account?.signIn));
    ck("with the phone hint and never the whole number",
      page.phoneHint === "(•••) •••-0101" && !JSON.stringify(page).includes("555-0101"));
    ck("and nothing about the other trades on the job", !/gutters|siding/.test(JSON.stringify(page)));
    await call(live, `/api/claim/${tok}`);
    const row = db.prepare(`SELECT open_count, first_opened_at FROM wo_claim_links WHERE token = ?`).get(tok);
    ck("every open is counted, and the first one kept", row.open_count === 1 && !!row.first_opened_at, JSON.stringify(row));
    const [s404] = await json(await call(live, `/api/claim/${"0".repeat(64)}`));
    const [sbad] = await json(await call(live, `/api/claim/nope`));
    ck("an unknown token and a malformed one answer alike", s404 === 404 && sbad === 404);
  }

  console.log("\n-- a texted code, to the right phone --");
  {
    const [sm, mis] = await json(await call(live, `/api/claim/${tok}/code`, { method: "POST", body: { phone: "206-555-0102" } }));
    ck("a different mobile is refused, with the hint", sm === 409 && mis.error === "phone_mismatch" && mis.hint === "(•••) •••-0101");
    ck("and no code was sent for it", sent.otp.length === 0);
    const [sc, code] = await json(await call(live, `/api/claim/${tok}/code`, { method: "POST", body: { phone: "206 555 0101" } }));
    ck("the number on record gets a code", sc === 200 && code.ok === true, JSON.stringify(code));
    ck("sent to Supabase in E.164", sent.otp[0]?.phone === "+12065550101" && sent.otp[0]?.create_user === true,
      JSON.stringify(sent.otp[0]));
    otpReply = { status: 400, body: { msg: "Unsupported phone provider" } };
    const [su, un] = await json(await call(live, `/api/claim/${tok}/code`, { method: "POST", body: { phone: "2065550101" } }));
    ck("phone sign-in switched off is its own answer, not 'try again'", su === 501 && un.error === "phone_login_unavailable");
    otpReply = null;
    const [s5] = await json(await call(env, `/api/claim/${tok}/code`, { method: "POST", body: { phone: "2065550101" } }));
    ck("and so is no Supabase at all", s5 === 501);

    const [sb, bad] = await json(await call(live, `/api/claim/${tok}/verify`, { method: "POST", body: { phone: "2065550101", code: "999999" } }));
    ck("a wrong code is refused", sb === 400 && bad.error === "bad_code");

    // THE GATE IS SUPABASE'S VERIFIED PHONE, NOT THE BODY'S. A body naming the
    // right number over a code that verified a different phone is a forwarded
    // link with somebody else's mobile.
    verifyPhone = "14255550123";
    const [sw, wrong] = await json(await call(live, `/api/claim/${tok}/verify`, { method: "POST", body: { phone: "2065550101", code: "123456" } }));
    ck("a code that verified some other phone does not claim", sw === 409 && wrong.error === "phone_mismatch", JSON.stringify(wrong));
    ck("and wrote nothing", !db.prepare(`SELECT claimed_at FROM wo_claim_links WHERE token = ?`).get(tok).claimed_at
      && !db.prepare(`SELECT 1 FROM users WHERE auth_id = 'auth_14255550123'`).get());
    verifyPhone = "12065550101";

    const [sv, ok] = await json(await call(live, `/api/claim/${tok}/verify`, { method: "POST", body: { phone: "2065550101", code: "123456" } }));
    ck("the right phone and the right code claim it", sv === 200 && ok.ok === true && ok.attributed === true, JSON.stringify(ok));
    ck("and hand back the session Supabase made", ok.session?.access_token === "acc_tok" && ok.session?.refresh_token === "ref_tok");
    ck("with the account to land on", ok.accountId === "acc_gc" && ok.subdomain === "outerhome");
    const u = db.prepare(`SELECT * FROM users WHERE auth_id = 'auth_12065550101'`).get();
    ck("a login exists for them", !!u && u.phone === "(206)555-0101", JSON.stringify(u));
    ck("named for the company's contact, on the company's address", u?.name === "Rae Bay" && u?.email === "rae@bay.test");
    const seat = u && db.prepare(`SELECT * FROM memberships WHERE user_id = ? AND account_id = 'acc_gc'`).get(u.id);
    ck("with a contractor seat on the account that sent it", seat?.role === "contractor" && seat?.company_id === "cmp_new");
    ck("the link is spent", !!db.prepare(`SELECT claimed_at FROM wo_claim_links WHERE token = ?`).get(tok).claimed_at);
    const att = db.prepare(`SELECT * FROM sub_attributions WHERE company_id = 'cmp_new'`).get();
    ck("and the account that sent it is credited", att?.account_id === "acc_gc" && att?.work_order_id === woId
      && att?.token === tok && att?.user_id === u?.id, JSON.stringify(att));
    ck("the feed says so", !!db.prepare(`SELECT 1 FROM activity WHERE account_id='acc_gc' AND kind='sub_claimed'`).get());

    const [sa, again] = await json(await call(live, `/api/claim/${tok}/verify`, { method: "POST", body: { phone: "2065550101", code: "123456" } }));
    ck("pressing it again is the same answer and writes nothing twice",
      sa === 200 && again.ok === true && again.attributed === false
      && db.prepare(`SELECT COUNT(*) AS n FROM users WHERE auth_id = 'auth_12065550101'`).get().n === 1);
    const [, page2] = await json(await call(live, `/api/claim/${tok}`));
    ck("and the page now says it is claimed", page2.state === "claimed");
  }

  console.log("\n-- by an emailed code, with no texting at all --");
  {
    const { db: dbE, env: envE, live: liveE } = seed();
    // Somebody this address already belongs to, with no login: added from the
    // console, say. Not a seat holder, so only the email path can find them.
    dbE.exec(`INSERT INTO users(id,name,email,auth_id) VALUES ('u_rae','Rae B','rae@bay.test',NULL)`);
    sent.otp.length = 0; sent.verify.length = 0;
    const [si] = await issue(envE, "j1", "roofing", "cmp_new");
    ck("the work order goes out", si === 201 || si === 200);
    const woE = dbE.prepare(`SELECT id FROM work_orders WHERE company_id='cmp_new' AND job_id='j1'`).get()?.id;
    const tE = tokenOf(dbE, woE);
    const [sm, mis] = await json(await call(liveE, `/api/claim/${tE}/code`, { method: "POST", body: { email: "someone@else.test" } }));
    ck("a different address is refused, with the hint", sm === 409 && mis.error === "email_mismatch" && mis.hint === "r•••@bay.test",
      JSON.stringify(mis));
    ck("and no code was sent for it", sent.otp.length === 0);
    const [sb] = await json(await call(liveE, `/api/claim/${tE}/code`, { method: "POST", body: { email: "not an address" } }));
    ck("something that is not an address is a 400", sb === 400);
    const [sc, code] = await json(await call(liveE, `/api/claim/${tE}/code`, { method: "POST", body: { email: " Rae@Bay.test " } }));
    ck("the address on record gets a code", sc === 200 && code.sentTo === "r•••@bay.test", JSON.stringify(code));
    ck("asked of Supabase by email, never by phone",
      sent.otp[0]?.email === "rae@bay.test" && sent.otp[0]?.create_user === true && !("phone" in (sent.otp[0] || {})),
      JSON.stringify(sent.otp[0]));
    const [snc] = await json(await call(envE, `/api/claim/${tE}/code`, { method: "POST", body: { email: "rae@bay.test" } }));
    ck("no Supabase at all is its own answer", snc === 501);

    // THE GATE IS THE ADDRESS SUPABASE VERIFIED, not the one in the body.
    verifyEmail = "thief@else.test";
    const [sw, wrong] = await json(await call(liveE, `/api/claim/${tE}/verify`,
      { method: "POST", body: { email: "rae@bay.test", code: "123456" } }));
    ck("a code that verified some other address does not claim", sw === 409 && wrong.error === "email_mismatch", JSON.stringify(wrong));
    ck("and wrote nothing", !dbE.prepare(`SELECT claimed_at FROM wo_claim_links WHERE token = ?`).get(tE).claimed_at
      && !dbE.prepare(`SELECT 1 FROM users WHERE auth_id = 'auth_thief@else.test'`).get());
    verifyEmail = "rae@bay.test";
    ck("the verify went to Supabase as an email code",
      sent.verify.at(-1)?.type === "email" && sent.verify.at(-1)?.email === "rae@bay.test");

    const [sv, ok] = await json(await call(liveE, `/api/claim/${tE}/verify`,
      { method: "POST", body: { email: "rae@bay.test", code: "123456" } }));
    ck("the right address and code claim it", sv === 200 && ok.ok === true && ok.attributed === true, JSON.stringify(ok));
    const linked = dbE.prepare(`SELECT * FROM users WHERE id = 'u_rae'`).get();
    ck("the person already holding that address is linked rather than duplicated",
      linked?.auth_id === "auth_rae@bay.test" && ok.userId === "u_rae"
      && dbE.prepare(`SELECT COUNT(*) AS n FROM users WHERE lower(email) = 'rae@bay.test'`).get().n === 1,
      JSON.stringify([linked, ok.userId]));
    ck("and no phone is written onto them from an email sign-in", linked?.phone == null, String(linked?.phone));
    ck("with a contractor seat on the account that sent it",
      dbE.prepare(`SELECT role FROM memberships WHERE user_id='u_rae' AND account_id='acc_gc'`).get()?.role === "contractor");
    ck("and the account is credited",
      dbE.prepare(`SELECT account_id FROM sub_attributions WHERE company_id='cmp_new'`).get()?.account_id === "acc_gc");
  }

  console.log("\n-- an email claim with nobody holding the address --");
  {
    const { db: dbN, env: envN, live: liveN } = seed();
    dbN.exec(`UPDATE companies SET email = NULL WHERE id = 'cmp_nop'`);
    await issue(envN, "j1", "gutters", "cmp_nop");
    const tN = tokenOf(dbN, dbN.prepare(`SELECT id FROM work_orders WHERE company_id='cmp_nop'`).get()?.id);
    verifyEmail = "quinn@new.test";
    const [sv, v] = await json(await call(liveN, `/api/claim/${tN}/verify`,
      { method: "POST", body: { email: "quinn@new.test", code: "123456" } }));
    ck("any real address may claim a company with none on record", sv === 200 && v.attributed === true, JSON.stringify(v));
    const u = dbN.prepare(`SELECT email, phone FROM users WHERE auth_id = 'auth_quinn@new.test'`).get();
    ck("and the new login is on the address they proved", u?.email === "quinn@new.test" && u?.phone == null, JSON.stringify(u));
    verifyEmail = "rae@bay.test";
  }

  console.log("\n-- the first account to bring them in keeps the credit --");
  {
    // Cascade sends the same company a work order after Outerhome recruited
    // them. They are on SubSub now: a sign-in, never a second recruitment.
    const [s2, out2] = await issue(env, "j2", "roofing", "cmp_new", "u_pm", "acc_pm");
    const wo2 = db.prepare(`SELECT id FROM work_orders WHERE job_id='j2'`).get()?.id;
    ck("the second account's work order goes out", s2 === 201 || s2 === 200, `${s2} ${JSON.stringify(out2).slice(0, 160)}`);
    const tok2 = tokenOf(db, wo2);
    const [, p] = await json(await call(live, `/api/claim/${tok2}`));
    ck("and its link reads on SubSub already", p.state === "on_subsub", p.state);
    const [sc] = await json(await call(live, `/api/claim/${tok2}/code`, { method: "POST", body: { phone: "2065550101" } }));
    ck("no code is sent for a company already on SubSub", sc === 409);
    const [sv, v] = await json(await call(live, `/api/claim/${tok2}/verify`, { method: "POST", body: { phone: "2065550101", code: "123456" } }));
    ck("verifying there is refused rather than credited", sv === 409 && v.error === "on_subsub", JSON.stringify(v));
    ck("and the credit stays with the first account",
      db.prepare(`SELECT account_id FROM sub_attributions WHERE company_id='cmp_new'`).get()?.account_id === "acc_gc"
      && db.prepare(`SELECT COUNT(*) AS n FROM sub_attributions`).get().n === 1);
  }

  console.log("\n-- a company with a login elsewhere --");
  {
    const [s3] = await issue(env, "j1", "siding", "cmp_on");
    const wo3 = db.prepare(`SELECT id FROM work_orders WHERE company_id='cmp_on'`).get()?.id;
    ck("the work order goes out", s3 === 201 || s3 === 200);
    const tok3 = tokenOf(db, wo3);
    const [, p] = await json(await call(live, `/api/claim/${tok3}`));
    ck("reads on SubSub, because their login is on another account", p.state === "on_subsub");
    // Somebody holding a forwarded link with a different phone cannot become
    // them -- and Juan himself is not credited to anybody either.
    verifyPhone = "12065550199";
    const [sv, v] = await json(await call(live, `/api/claim/${tok3}/verify`, { method: "POST", body: { phone: "2065550199", code: "123456" } }));
    ck("verifying is refused before the code is spent", sv === 409 && v.error === "on_subsub");
    ck("and nothing is credited for them", !db.prepare(`SELECT 1 FROM sub_attributions WHERE company_id='cmp_on'`).get());
    verifyPhone = "12065550101";
  }

  console.log("\n-- no mobile on record --");
  {
    const [s4] = await issue(env, "j1", "gutters", "cmp_nop");
    const wo4 = db.prepare(`SELECT id FROM work_orders WHERE company_id='cmp_nop'`).get()?.id;
    const tok4 = tokenOf(db, wo4);
    ck("a sub nobody texted still gets the link by email",
      (s4 === 201 || s4 === 200) && sent.mail.some((m) => m.text.includes(claimUrl(tok4))));
    const [, p] = await json(await call(live, `/api/claim/${tok4}`));
    ck("and there is no hint to give", p.phoneHint === null && p.state === "claimable");
    verifyPhone = "14255550777";
    const [sv, v] = await json(await call(live, `/api/claim/${tok4}/verify`, { method: "POST", body: { phone: "4255550777", code: "123456" } }));
    ck("any real mobile may claim it", sv === 200 && v.attributed === true, JSON.stringify(v));
    const u = db.prepare(`SELECT email FROM users WHERE auth_id = 'auth_14255550777'`).get();
    ck("on the company's address when nobody holds it", u?.email === "quinn@gut.test", JSON.stringify(u));
    verifyPhone = "12065550101";
  }

  console.log("\n-- the console's funnel --");
  {
    const [st, accts] = await json(await call(live, "/api/platform/attribution", { bearer: "staff" }));
    const gc = accts?.accounts?.find((a) => a.accountId === "acc_gc");
    ck("staff read work orders sent, links opened and subs claimed, per account",
      st === 200 && gc?.sent === 3 && gc?.opened === 3 && gc?.claimed === 2, `${st} ${JSON.stringify(accts)}`);
    const pm = accts?.accounts?.find((a) => a.accountId === "acc_pm");
    ck("and the account that reached a sub already on SubSub is credited nothing",
      pm?.sent === 1 && pm?.claimed === 0, JSON.stringify(pm));
    const [s1, one] = await json(await call(live, "/api/platform/accounts/acc_gc/attribution", { bearer: "staff" }));
    ck("one account's window names the subs it brought in",
      s1 === 200 && one.subs?.length === 2 && one.subs.some((x) => x.company === "Bay Roofing" && x.woNumber),
      JSON.stringify(one));
    // Somebody with a login who is not staff -- a sub who has just claimed,
    // say -- gets nothing: this route reads across every account.
    const [sc] = await json(await call(live, "/api/platform/attribution", { bearer: "juan" }));
    ck("and a customer cannot read it", sc === 403, String(sc));
  }

  console.log("\n-- the invariant, against real rows --");
  {
    ck("a clean database reads zero", runCheck(db).m074_inv_claim_unattributed === 0);
    db.exec(`DELETE FROM sub_attributions WHERE company_id = 'cmp_nop'`);
    ck("a claimed link with nobody credited reads one", runCheck(db).m074_inv_claim_unattributed === 1);
  }

  console.log("\n-- a database without 074 still sends the work order --");
  {
    const { db: db2, env: env2 } = seed();
    db2.exec(`DROP TABLE wo_claim_links; DROP TABLE sub_attributions;`);
    sent.mail.length = 0;
    const [s5] = await issue(env2, "j1", "roofing", "cmp_new");
    ck("the work order is issued", s5 === 201 || s5 === 200, String(s5));
    ck("with the footer and no link", sent.mail[0]?.text?.includes("Sent via SubSub")
      && !sent.mail[0]?.text?.includes("/claim/"), sent.mail[0]?.text?.slice(-200));
    const [s6, m] = await json(await call(env2, `/api/claim/${"a".repeat(64)}`));
    ck("and the page names the migration", s6 === 503 && m.migration === "074_wo_claims", `${s6} ${JSON.stringify(m)}`);
  }

  console.log("\n-- the footer is not a setting --");
  {
    // Nothing reads a plan, a flag or a brand before drawing it. A Scale
    // account is white-labelled; that changes colours, never this line.
    const fns = [MAIL.match(/export function workOrderIssuedEmail[\s\S]{0,2500}?\n}/)?.[0] || "",
      MAIL.match(/export function workOrderIssuedSms[\s\S]{0,1200}?\n}/)?.[0] || ""];
    ck("both senders append it unconditionally",
      /footerText\(claimLink\)/.test(fns[0]) && /footerSms\(claimLink\)/.test(fns[1]));
    ck("and neither asks about a plan", !fns.some((f) => /plan|canBrand|hideFooter|white/i.test(f)));
    ck("no column anywhere turns it off", !/hide_footer|remove_footer|footer_off/i.test(WORKER + SCHEMA));
    // The Scale account above was sent the same footer as everybody else.
    ck("a Scale account's work order carried it", sent.mail.some((m) => m.text.includes("Sent via SubSub")));
  }
} catch (err) {
  fail++;
  console.log("FAIL  the suite threw  -- " + (err?.stack || err));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
