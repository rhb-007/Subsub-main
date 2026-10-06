// Asking your own subcontractors to price a job, before committing to any.
//
// Part of "pre-award" already existed: a work order with status 'pending' IS a
// pre-award view -- they see the job, the scope and the price, and accept or
// decline before anything is committed. What did not exist is the case where
// the account does not know the price yet and wants two or three of its own
// roofers to quote the same trade first. Work orders cannot express that:
// issuing one commits to a number, and issuing three for one trade collides on
// the live-WO index.
//
// This is overflow's shape pointed at the account's OWN ROSTER. What must hold:
//
//   IT ASKS THE ROSTER AND NOBODY ELSE. A company id in the request body is a
//   claim; the engagement is the only thing that makes it true. There is no
//   endpoint here that takes a trade and returns companies.
//
//   NOTHING TRAVELS SIDEWAYS. An invited company never learns who else was
//   asked, what they quoted, or who won. These are competing bids and one of
//   them is the price the account is about to pay.
//
//   A QUOTE REQUEST IS A KEY TO ONE JOB, not to the account's job list -- it
//   must not re-open what the /api/jobs scoping just closed.
//
//   AWARDING ISSUES THE WORK ORDER AT THE NUMBER THEY GAVE, which is the whole
//   point of having asked.
//
//   node --no-warnings scripts/quotes-test.mjs

import { readFileSync } from "node:fs";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";
import { rankQuotes, quoteSpread, quoteJobShape, validQuote, validInvitees,
  canRequestQuotes, canAward, requestState, MAX_INVITES } from "../shared/quotes.js";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");
const SCHEMA = readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8");
const M031 = `ALTER TABLE accounts ADD COLUMN company_id TEXT REFERENCES companies(id);`;
const M043 = readFileSync(new URL("../worker/migrations/043_quotes.sql", import.meta.url), "utf8");
const COLS = `
ALTER TABLE jobs ADD COLUMN withdrawn_at TEXT;
ALTER TABLE jobs ADD COLUMN withdrawn_note TEXT;
ALTER TABLE jobs ADD COLUMN updated_at TEXT;
ALTER TABLE jobs ADD COLUMN severity TEXT;
ALTER TABLE work_orders ADD COLUMN pay_kind TEXT NOT NULL DEFAULT 'fixed';
ALTER TABLE work_orders ADD COLUMN rate_cents INTEGER;
ALTER TABLE work_orders ADD COLUMN cap_hours REAL;`;

// Alder has three roofers on its roster and one electrician. Sound PM is a
// different account entirely, with a roofer of its own.
const seed = () => {
  const db = freshDb({ base: SCHEMA, migrations: [M031, COLS, M043] });
  db.exec(`
    INSERT INTO accounts(id,name,subdomain,kind) VALUES
      ('acc_a','Alder Construction','alder','general_contractor'),
      ('acc_s','Sound PM','sound','property_manager');
    INSERT INTO companies(id,company,email) VALUES
      ('cmp_bay','Bay Roofing','rae@bay.test'),
      ('cmp_pine','Pine Roofing','pip@pine.test'),
      ('cmp_oak','Oak Roofing','ola@oak.test'),
      ('cmp_volt','Volt Electric','val@volt.test'),
      ('cmp_far','Far Roofing','fay@far.test');
    INSERT INTO users(id,name,email) VALUES
      ('u_boss','Pat Boss','pat@alder.test'),
      ('u_bay','Rae Bay','rae@bay.test'),
      ('u_pine','Pip Pine','pip@pine.test'),
      ('u_oak','Ola Oak','ola@oak.test'),
      ('u_far','Fay Far','fay@far.test');
    INSERT INTO memberships(id,user_id,account_id,role,company_id) VALUES
      ('m0','u_boss','acc_a','admin',NULL),
      ('m1','u_bay','acc_a','contractor','cmp_bay'),
      ('m2','u_pine','acc_a','contractor','cmp_pine'),
      ('m3','u_oak','acc_a','contractor','cmp_oak'),
      ('m4','u_far','acc_s','contractor','cmp_far');
    INSERT INTO engagements(id,account_id,company_id,status,categories) VALUES
      ('en_bay','acc_a','cmp_bay','active','["roofing"]'),
      ('en_pine','acc_a','cmp_pine','active','["roofing"]'),
      ('en_oak','acc_a','cmp_oak','active','["roofing"]'),
      ('en_volt','acc_a','cmp_volt','active','["electrical"]'),
      ('en_far','acc_s','cmp_far','active','["roofing"]');
    INSERT INTO jobs(id,account_id,title,address,date,status,trades,scope) VALUES
      ('j_mill','acc_a','Re-roof the mill','12 Mill Lane','2026-11-02','active',
       '["roofing","electrical"]','Strip and re-cover, 400sqm');`);
  return { db, env: { DB: makeD1(db) } };
};

const call = (env, who, acct, path, method = "GET", body) => worker.fetch(
  new Request(`https://api.subsub.work/api${path}`, {
    method,
    headers: { "Content-Type": "application/json", "X-User-Id": who, "X-Account-Id": acct },
    ...(method === "POST" ? { body: JSON.stringify(body || {}) } : {}),
  }), env);
const json = async (r) => [r.status, await r.json().catch(() => ({}))];
const one = (db, sql, ...b) => db.prepare(sql).get(...b);

console.log("\n-- the rules, before a database is involved --");
{
  ck("a contractor cannot ask", canRequestQuotes({}, { role: "contractor" }).ok === false);
  ck("an admin can", canRequestQuotes({}, { role: "admin" }).ok === true);
  ck("nor on a job somebody else runs",
    canRequestQuotes({ readOnly: true }, { role: "admin" }).reason === "not_your_job");
  ck("nor on an unapproved request",
    canRequestQuotes({ requestedBy: "u", approvedAt: null }, { role: "admin" }).reason === "not_approved");
  ck("nor on a trade already issued",
    canRequestQuotes({}, { role: "admin", liveWorkOrder: true }).reason === "already_issued");
  ck("and not twice at once",
    canRequestQuotes({}, { role: "admin", hasOpenRequest: true }).reason === "already_asking");

  ck("a price is required", validQuote({}).reason === "price_required");
  ck("zero is not a price", validQuote({ priceCents: 0 }).reason === "invalid_price");
  ck("nor a fraction of a cent", validQuote({ priceCents: 10.5 }).reason === "invalid_price");
  ck("a real one passes", validQuote({ priceCents: 450000 }).priceCents === 450000);

  const subs = [{ id: "a", categories: ["roofing"] }, { id: "b", categories: ["electrical"] }];
  ck("only the roster may be asked",
    validInvitees(["a", "stranger"], subs, "roofing").companyIds.join(",") === "a");
  ck("and only for the trade", validInvitees(["b"], subs, "roofing").reason === "nobody_to_ask");
  ck("asking nobody is refused", validInvitees([], subs, "roofing").reason === "nobody_to_ask");
  ck("and this is not a broadcast",
    validInvitees(Array.from({ length: MAX_INVITES + 1 }, (_, i) => `c${i}`),
      Array.from({ length: MAX_INVITES + 1 }, (_, i) => ({ id: `c${i}`, categories: ["roofing"] })),
      "roofing").reason === "too_many");

  const ranked = rankQuotes([
    { status: "quoted", priceCents: 500, canStart: "2026-11-10" },
    { status: "passed" },
    { status: "quoted", priceCents: 300, canStart: "2026-12-01" },
    { status: "quoted", priceCents: 300, canStart: "2026-11-05" },
  ]);
  ck("cheapest first", ranked[0].priceCents === 300);
  ck("then soonest on a tie", ranked[0].canStart === "2026-11-05", ranked[0].canStart);
  ck("and a pass sorts out of the way, not away",
    ranked.length === 4 && ranked[3].status === "passed");
  ck("one quote is a price, not a comparison",
    quoteSpread([{ status: "quoted", priceCents: 300 }]) === null);
  ck("two is a spread", quoteSpread([
    { status: "quoted", priceCents: 300 }, { status: "quoted", priceCents: 500 },
  ]).spread === 200);
  ck("awarding needs a quote",
    canAward({ id: "r", status: "open" }, { requestId: "r", status: "invited" }).reason === "no_quote");
  ck("and an open request",
    canAward({ id: "r", status: "awarded" }, { requestId: "r", status: "quoted" }).reason === "closed");
}

console.log("\n-- asking the roster, and nobody else --");
{
  const { db, env } = seed();
  const [bad] = await json(await call(env, "u_boss", "acc_a", "/jobs/j_mill/quote-requests",
    "POST", { trade: "roofing", companyIds: ["cmp_far"] }));
  ck("a company on somebody else's roster cannot be asked", bad === 400, String(bad));
  const [wrong] = await json(await call(env, "u_boss", "acc_a", "/jobs/j_mill/quote-requests",
    "POST", { trade: "roofing", companyIds: ["cmp_volt"] }));
  ck("nor one who does not do the trade", wrong === 400, String(wrong));

  const [s, made] = await json(await call(env, "u_boss", "acc_a", "/jobs/j_mill/quote-requests",
    "POST", { trade: "roofing", scope: "Strip and re-cover, 400sqm",
      companyIds: ["cmp_bay", "cmp_pine", "cmp_oak", "cmp_far"] }));
  ck("three of our own are asked", s === 201 && made.asked === 3, `${s} ${JSON.stringify(made)}`);
  ck("the stranger is silently not among them",
    one(db, `SELECT COUNT(*) AS n FROM quote_invites WHERE request_id = ?`, made.id).n === 3);
  ck("and no invite exists for them",
    !one(db, `SELECT 1 AS yes FROM quote_invites WHERE company_id='cmp_far'`));

  const [again] = await json(await call(env, "u_boss", "acc_a", "/jobs/j_mill/quote-requests",
    "POST", { trade: "roofing", companyIds: ["cmp_bay"] }));
  ck("the same trade cannot be asked twice at once", again === 409, String(again));

  const [nope] = await json(await call(env, "u_bay", "acc_a", "/jobs/j_mill/quote-requests",
    "POST", { trade: "roofing", companyIds: ["cmp_bay"] }));
  ck("and a contractor cannot ask at all", nope === 403, String(nope));
}

console.log("\n-- several items, sent together and priced one by one --");
{
  // Reported as "it sent one separate quote request for each one plus one
  // together". A move-out with a floor and a wall is one conversation, so the
  // ask is one press -- but each item is still its own request, because each
  // is awarded on its own and may go to different people at different prices.
  const { db, env } = seed();
  // Bay does both here, which is the company the report was about.
  db.exec(`UPDATE engagements SET categories = '["roofing","electrical"]' WHERE id = 'en_bay';`);
  const [s, made] = await json(await call(env, "u_boss", "acc_a", "/jobs/j_mill/quote-requests",
    "POST", { items: [
      { trade: "roofing", scope: "Ridge flashing lifted" },
      { trade: "electrical", scope: "Loft light dead" },
      { trade: "roofing", scope: "a duplicate line is one item, not two" },
    ], companyIds: ["cmp_bay", "cmp_pine", "cmp_volt"] }));
  ck("one press makes a request per item", s === 201 && made.requests?.length === 2,
    `${s} ${JSON.stringify(made)}`);
  ck("naming each trade", made.requests?.map((r) => r.trade).join(",") === "roofing,electrical",
    JSON.stringify(made.requests));
  ck("and counting people, not invites", made.asked === 3, String(made.asked));
  const rows = db.prepare(`SELECT qr.trade, qr.scope, qi.company_id FROM quote_requests qr
    JOIN quote_invites qi ON qi.request_id = qr.id ORDER BY qr.trade, qi.company_id`).all();
  const who = (t) => rows.filter((r) => r.trade === t).map((r) => r.company_id).join(",");
  ck("each company is asked only about what it does",
    who("roofing") === "cmp_bay,cmp_pine" && who("electrical") === "cmp_bay,cmp_volt",
    JSON.stringify(rows));
  ck("each item carries its own scope, not the whole job's",
    rows.find((r) => r.trade === "electrical")?.scope === "Loft light dead"
    && rows.find((r) => r.trade === "roofing")?.scope === "Ridge flashing lifted",
    JSON.stringify(rows));

  // What the company doing both sees: two invites on ONE job, which is what
  // the portal draws as one card with a price per item.
  const [, mine] = await json(await call(env, "u_bay", "acc_a", "/my-quotes"));
  ck("the company doing both holds one invite per item",
    mine.length === 2 && new Set(mine.map((q) => q.job.id)).size === 1,
    JSON.stringify(mine.map((q) => [q.trade, q.job.id])));
  ck("and each is narrowed to its own trade",
    mine.every((q) => q.job.trades.length === 1 && q.job.trades[0] === q.trade));
  // Answered individually: a price on one and a pass on the other.
  const inv = (t) => mine.find((q) => q.trade === t).inviteId;
  const [a1] = await json(await call(env, "u_bay", "acc_a", `/quotes/${inv("roofing")}`,
    "POST", { priceCents: 210000 }));
  const [a2] = await json(await call(env, "u_bay", "acc_a", `/quotes/${inv("electrical")}`,
    "POST", { pass: true }));
  ck("and each is answered on its own", a1 === 200 && a2 === 200, `${a1} ${a2}`);
  const after = db.prepare(`SELECT qr.trade, qi.status, qi.price_cents FROM quote_invites qi
    JOIN quote_requests qr ON qr.id = qi.request_id WHERE qi.company_id = 'cmp_bay'
    ORDER BY qr.trade`).all();
  ck("a price on one item does not answer the other",
    after[0].trade === "electrical" && after[0].status === "passed"
    && after[1].trade === "roofing" && after[1].price_cents === 210000,
    JSON.stringify(after));
}

console.log("\n-- a batch is checked whole before any of it is written --");
{
  // An item nobody picked can price would go to nobody. Refused BY NAME, and
  // nothing else in the batch is written -- or the other item goes out alone
  // and the second press is refused as already asking.
  const { db, env } = seed();
  const [s, body] = await json(await call(env, "u_boss", "acc_a", "/jobs/j_mill/quote-requests",
    "POST", { items: [{ trade: "roofing" }, { trade: "electrical" }],
      companyIds: ["cmp_bay", "cmp_pine"] }));
  ck("an item nobody picked covers is refused", s === 400 && body.error === "nobody_to_ask",
    `${s} ${JSON.stringify(body)}`);
  ck("naming the item", body.trade === "electrical", String(body.trade));
  ck("and nothing at all is written",
    one(db, `SELECT COUNT(*) AS n FROM quote_requests`).n === 0);

  const [s2, b2] = await json(await call(env, "u_boss", "acc_a", "/jobs/j_mill/quote-requests",
    "POST", { items: [{ trade: "roofing" }, { trade: "plumbing" }], companyIds: ["cmp_bay"] }));
  ck("an item that is not on the job is refused by name",
    s2 === 400 && b2.error === "not_a_trade_on_this_job" && b2.trade === "plumbing",
    `${s2} ${JSON.stringify(b2)}`);

  // One item already out: the batch is refused naming it, and the other
  // item is not sent on its own.
  await json(await call(env, "u_boss", "acc_a", "/jobs/j_mill/quote-requests",
    "POST", { trade: "roofing", companyIds: ["cmp_bay"] }));
  const [s3, b3] = await json(await call(env, "u_boss", "acc_a", "/jobs/j_mill/quote-requests",
    "POST", { items: [{ trade: "electrical" }, { trade: "roofing" }],
      companyIds: ["cmp_bay", "cmp_volt"] }));
  ck("an item already out refuses the batch by name",
    s3 === 409 && b3.error === "already_asking" && b3.trade === "roofing",
    `${s3} ${JSON.stringify(b3)}`);
  ck("and the other item was not sent alone",
    one(db, `SELECT COUNT(*) AS n FROM quote_requests WHERE trade = 'electrical'`).n === 0);
}

console.log("\n-- what somebody asked to quote can see --");
{
  const { env } = seed();
  await json(await call(env, "u_boss", "acc_a", "/jobs/j_mill/quote-requests", "POST",
    { trade: "roofing", scope: "Strip and re-cover, 400sqm",
      companyIds: ["cmp_bay", "cmp_pine", "cmp_oak"] }));

  const [s, mine] = await json(await call(env, "u_bay", "acc_a", "/my-quotes"));
  ck("they are told they were asked", s === 200 && mine.length === 1, `${s} ${mine.length}`);
  const q = mine[0];
  ck("naming the account", q.accountName === "Alder Construction", q.accountName);
  ck("the trade", q.trade === "roofing");
  ck("where the work is", q.job.address === "12 Mill Lane", q.job.address);
  ck("and what they are pricing", q.job.scope === "Strip and re-cover, 400sqm", q.job.scope);

  // The load-bearing redactions.
  const flat = JSON.stringify(mine);
  ck("not who else was asked", !flat.includes("Pine") && !flat.includes("cmp_pine")
    && !flat.includes("Oak") && !flat.includes("cmp_oak"));
  ck("not that anybody else was asked at all",
    !("asked" in q) && !("invites" in q) && !("others" in q));
  ck("the other trade on the job is not theirs to see",
    q.job.trades.join(",") === "roofing", JSON.stringify(q.job.trades));
  ck("assignments is empty, not absent",
    q.job.assignments && Object.keys(q.job.assignments).length === 0);
  ck("and it is read-only", q.job.readOnly === true);

  // A quote request is a key to ONE job, never to the list.
  const [, jobs] = await json(await call(env, "u_bay", "acc_a", "/jobs"));
  ck("being asked to quote does not open the account's job list",
    jobs.length === 0, `${jobs.length}`);
}

console.log("\n-- answering, and comparing --");
{
  const { db, env } = seed();
  const [, made] = await json(await call(env, "u_boss", "acc_a", "/jobs/j_mill/quote-requests",
    "POST", { trade: "roofing", companyIds: ["cmp_bay", "cmp_pine", "cmp_oak"] }));
  const inviteOf = (cmp) => one(db,
    `SELECT id FROM quote_invites WHERE request_id = ? AND company_id = ?`, made.id, cmp).id;

  const [q1] = await json(await call(env, "u_bay", "acc_a", `/quotes/${inviteOf("cmp_bay")}`,
    "POST", { priceCents: 480000, canStart: "2026-11-05" }));
  ck("a quote is accepted", q1 === 200, String(q1));
  const [q2] = await json(await call(env, "u_pine", "acc_a", `/quotes/${inviteOf("cmp_pine")}`,
    "POST", { priceCents: 412500, canStart: "2026-11-12" }));
  ck("and a second", q2 === 200);
  const [q3] = await json(await call(env, "u_oak", "acc_a", `/quotes/${inviteOf("cmp_oak")}`,
    "POST", { pass: true, note: "Booked solid until January." }));
  ck("and a pass is an answer too", q3 === 200);

  // Nobody may answer for anybody else.
  const [theft] = await json(await call(env, "u_bay", "acc_a", `/quotes/${inviteOf("cmp_pine")}`,
    "POST", { priceCents: 999999 }));
  ck("an invite id from elsewhere answers not_found", theft === 404, String(theft));
  ck("and Pine's quote is untouched",
    one(db, `SELECT price_cents FROM quote_invites WHERE company_id='cmp_pine'`).price_cents === 412500);

  // The account sees the comparison it asked for.
  const [s, reqs] = await json(await call(env, "u_boss", "acc_a", "/jobs/j_mill/quote-requests"));
  ck("the account gets its comparison", s === 200 && reqs.length === 1);
  const r = reqs[0];
  ck("with everyone it asked on it", r.invites.length === 3);
  ck("cheapest first", r.invites[0].company === "Pine Roofing", r.invites[0].company);
  ck("named, because it chose them", r.invites.every((i) => !!i.company));
  ck("and the pass is still shown", r.invites.some((i) => i.status === "passed"));
  ck("the state reads as quotes in", r.state === "quotes_in", r.state);

  // And still nothing sideways.
  const [, bayView] = await json(await call(env, "u_bay", "acc_a", "/my-quotes"));
  const flat = JSON.stringify(bayView);
  ck("Bay does not learn Pine undercut them",
    !flat.includes("412500") && !flat.includes("Pine"), flat.slice(0, 120));
  ck("nor that anybody passed", !flat.includes("Booked solid"));
  ck("only their own number comes back", bayView[0].priceCents === 480000);
}

console.log("\n-- awarding issues the work order at the number they gave --");
{
  const { db, env } = seed();
  const [, made] = await json(await call(env, "u_boss", "acc_a", "/jobs/j_mill/quote-requests",
    "POST", { trade: "roofing", scope: "Strip and re-cover, 400sqm",
      companyIds: ["cmp_bay", "cmp_pine"] }));
  const inviteOf = (cmp) => one(db,
    `SELECT id FROM quote_invites WHERE request_id = ? AND company_id = ?`, made.id, cmp).id;
  await json(await call(env, "u_bay", "acc_a", `/quotes/${inviteOf("cmp_bay")}`, "POST",
    { priceCents: 480000, canStart: "2026-11-05" }));
  await json(await call(env, "u_pine", "acc_a", `/quotes/${inviteOf("cmp_pine")}`, "POST",
    { priceCents: 412500, canStart: "2026-11-12" }));

  const [bad] = await json(await call(env, "u_boss", "acc_a",
    `/quote-requests/${made.id}/award`, "POST", { companyId: "cmp_oak" }));
  ck("awarding to somebody who was not asked is refused", bad === 404, String(bad));

  const [s, won] = await json(await call(env, "u_boss", "acc_a",
    `/quote-requests/${made.id}/award`, "POST", { companyId: "cmp_pine" }));
  ck("awarding works", s === 200, `${s} ${JSON.stringify(won)}`);
  const wo = one(db, `SELECT * FROM work_orders WHERE id = ?`, won.woId);
  ck("a work order is issued", !!wo);
  ck("to the company that won it", wo.company_id === "cmp_pine");
  ck("for the trade asked about", wo.trade === "roofing");
  // The whole point of having asked.
  ck("at the price THEY gave", wo.value_cents === 412500, String(wo.value_cents));
  ck("carrying the scope everyone priced",
    wo.trade_scope === "Strip and re-cover, 400sqm", wo.trade_scope);
  ck("and it is pending, not booked behind their back", wo.status === "pending");

  ck("the request closes", one(db, `SELECT status FROM quote_requests WHERE id = ?`, made.id)
    .status === "awarded");
  ck("joined to what came of it",
    one(db, `SELECT awarded_wo_id FROM quote_requests WHERE id = ?`, made.id).awarded_wo_id === won.woId);
  const [twice] = await json(await call(env, "u_boss", "acc_a",
    `/quote-requests/${made.id}/award`, "POST", { companyId: "cmp_bay" }));
  ck("and cannot be awarded again", twice === 409, String(twice));

  // What each side is told afterwards.
  const [, pineView] = await json(await call(env, "u_pine", "acc_a", "/my-quotes"));
  ck("the winner is told they won", pineView[0].wonIt === true);
  const [, bayView] = await json(await call(env, "u_bay", "acc_a", "/my-quotes"));
  ck("the other is told they did not", bayView[0].wonIt === false);
  ck("but never who did, nor for how much",
    !JSON.stringify(bayView).includes("Pine") && !JSON.stringify(bayView).includes("412500"),
    JSON.stringify(bayView).slice(0, 140));

  // And the awarded work order behaves like any other.
  const [, pineJobs] = await json(await call(env, "u_pine", "acc_a", "/jobs"));
  ck("the winner now sees the job in their list", pineJobs.length === 1);
  const [, bayJobs] = await json(await call(env, "u_bay", "acc_a", "/jobs"));
  ck("and the one who lost still does not", bayJobs.length === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
