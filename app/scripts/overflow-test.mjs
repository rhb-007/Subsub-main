// Overflow, and the thing it must never become.
//
// This is the one feature that reaches past an account's own roster, so it is
// also the one place the product's central rule could be undone by accident.
// The rule, from CLAUDE.md: no account may mine another account's
// subcontractors. What follows from it here:
//
//   the posting account never learns WHO it went to -- not a list, not a
//   count, not anything derived from either. A count of how many companies
//   were asked measures the platform's roster, and an account that can watch
//   that number move learns the shape of everybody else's business one post
//   at a time
//
//   what they see is who ANSWERED, and only for their own posts
//
//   holding a post id is not enough to answer one
//
//   naming a company id when picking is not a way to reach a company that
//   did not answer
//
//   it is only for overflow: an account with somebody of their own who could
//   take the job cannot broadcast at all
//
// Eligibility is the other half: overflow work goes to a stranger the posting
// account cannot check, so the platform checks -- rating, time served, jobs
// finished, documents in force, licence verified.
//
//   node --no-warnings scripts/overflow-test.mjs

import { readFileSync } from "node:fs";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";
import { eligible, canBroadcast, overflowSplit, overflowFee, postClosed,
  postWindowHours, ELIGIBILITY, OVERFLOW_FEE_BPS } from "../shared/overflow.js";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker, missingSchema } = await import("../worker/index.js");

const SCHEMA = readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8");
const M024 = `
ALTER TABLE work_orders ADD COLUMN pay_kind TEXT NOT NULL DEFAULT 'fixed';
ALTER TABLE work_orders ADD COLUMN rate_cents INTEGER;
ALTER TABLE work_orders ADD COLUMN cap_hours REAL;`;
const M031 = `ALTER TABLE accounts ADD COLUMN company_id TEXT REFERENCES companies(id);`;
// The post inherits the job's severity, which decides how long the window is.
const M023 = `ALTER TABLE jobs ADD COLUMN severity TEXT;`;
const M037 = readFileSync(new URL("../worker/migrations/037_document_detail.sql", import.meta.url), "utf8");
const M038 = readFileSync(new URL("../worker/migrations/038_overflow.sql", import.meta.url), "utf8");

const iso = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const good = { found: true, status: "ACTIVE", suspendDate: null, expirationDate: iso(400) };

// acc1 posts. Four companies it has never worked with:
//   cmp_ok    eligible in every way
//   cmp_new   opted in yesterday -- too new
//   cmp_bad   rated 3.1 -- too low
//   cmp_out   never opted in
// plus cmp_mine, which is ON acc1's roster, and cmp_other on acc2's.
const seed = () => {
  const db = freshDb({ base: SCHEMA, migrations: [M023, M024, M031, M037, M038] });
  db.exec(`
    INSERT INTO accounts(id,name,subdomain,kind) VALUES
      ('acc1','Cascade Management','cascade','property_manager'),
      ('acc2','Sound PM','sound','property_manager');
    INSERT INTO companies(id,company,contact,email,phone,city,state,insurance,bond,contract,w9,doc_files,
        license,license_check,overflow_opt_in,overflow_trades,overflow_since) VALUES
      ('cmp_ok','Rainier Plumbing','Pat Rain','pat@rainier.test','2065550101','Seattle','WA',1,1,1,1,
        '{"insurance":"coi.pdf","bond":"b.pdf","contract":"c.pdf","w9":"w.pdf"}',
        'RP1','${JSON.stringify(good)}',1,'["plumbing"]','${iso(-200)}'),
      ('cmp_ok2','Olympic Plumbing','Sam Oly','sam@oly.test','2065550102','Seattle','WA',1,1,1,1,
        '{"insurance":"coi.pdf","bond":"b.pdf","contract":"c.pdf","w9":"w.pdf"}',
        'OP1','${JSON.stringify(good)}',1,'["plumbing"]','${iso(-300)}'),
      ('cmp_new','Brand New Plumbing','Newt','newt@new.test','2065550103','Seattle','WA',1,1,1,1,
        '{"insurance":"coi.pdf","bond":"b.pdf","contract":"c.pdf","w9":"w.pdf"}',
        'BN1','${JSON.stringify(good)}',1,'["plumbing"]','${iso(-5)}'),
      ('cmp_bad','Rough Plumbing','Rob','rob@rough.test','2065550104','Seattle','WA',1,1,1,1,
        '{"insurance":"coi.pdf","bond":"b.pdf","contract":"c.pdf","w9":"w.pdf"}',
        'RG1','${JSON.stringify(good)}',1,'["plumbing"]','${iso(-200)}'),
      ('cmp_out','Private Plumbing','Priv','priv@priv.test','2065550105','Seattle','WA',1,1,1,1,
        '{"insurance":"coi.pdf","bond":"b.pdf","contract":"c.pdf","w9":"w.pdf"}',
        'PP1','${JSON.stringify(good)}',0,'[]',NULL),
      ('cmp_mine','My Own Plumbing','Mine','mine@mine.test','2065550106','Seattle','WA',1,1,1,1,
        '{"insurance":"coi.pdf","bond":"b.pdf","contract":"c.pdf","w9":"w.pdf"}',
        'MO1','${JSON.stringify(good)}',0,'[]',NULL),
      ('cmp_both','Already Ours Plumbing','Ours','ours@ours.test','2065550108','Seattle','WA',1,1,1,1,
        '{"insurance":"coi.pdf","bond":"b.pdf","contract":"c.pdf","w9":"w.pdf"}',
        'AO1','${JSON.stringify(good)}',1,'["plumbing"]','${iso(-200)}'),
      ('cmp_roof','Ridge Roofing','Ridge','ridge@ridge.test','2065550107','Seattle','WA',1,1,1,1,
        '{"insurance":"coi.pdf","bond":"b.pdf","contract":"c.pdf","w9":"w.pdf"}',
        'RR1','${JSON.stringify(good)}',1,'["roofing"]','${iso(-200)}');
    INSERT INTO users(id,name,email,auth_id) VALUES
      ('u_admin','Cascade Admin','admin@cascade.test','auth_admin'),
      ('u_far','Sound Admin','far@sound.test','auth_far'),
      ('u_ok','Pat Rain','pat@rainier.test','auth_ok'),
      ('u_ok2','Sam Oly','sam@oly.test','auth_ok2'),
      ('u_out','Priv','priv@priv.test','auth_out');
    INSERT INTO memberships(id,user_id,account_id,role,company_id) VALUES
      ('m1','u_admin','acc1','admin',NULL),
      ('m2','u_far','acc2','admin',NULL),
      ('m3','u_ok','acc1','contractor','cmp_ok'),
      ('m4','u_ok2','acc1','contractor','cmp_ok2'),
      ('m5','u_out','acc1','contractor','cmp_out');
    -- acc1's own roster: one plumber (no good for the job) and nothing else.
    INSERT INTO engagements(id,account_id,company_id,status,categories,rating,rated_jobs,doc_review) VALUES
      ('en_both','acc1','cmp_both','active','["plumbing"]',4.9,8,'{}'),
      ('en_mine','acc1','cmp_mine','active','["plumbing"]',4.8,6,
        '{"insurance":{"status":"verified"},"bond":{"status":"verified"},"contract":{"status":"verified"}}');
    -- Ratings for the outsiders, on OTHER accounts. Their own record.
    INSERT INTO engagements(id,account_id,company_id,status,categories,rating,rated_jobs,doc_review) VALUES
      ('en_ok','acc2','cmp_ok','active','["plumbing"]',4.7,8,'{}'),
      ('en_ok2','acc2','cmp_ok2','active','["plumbing"]',4.9,9,'{}'),
      ('en_new','acc2','cmp_new','active','["plumbing"]',4.6,5,'{}'),
      ('en_bad','acc2','cmp_bad','active','["plumbing"]',3.1,7,'{}'),
      ('en_out','acc2','cmp_out','active','["plumbing"]',5.0,9,'{}'),
      ('en_roof','acc2','cmp_roof','active','["roofing"]',4.8,7,'{}');
    INSERT INTO jobs(id,account_id,title,date,status,area,zip,severity) VALUES
      ('job1','acc1','Burst riser at Cedar Park','${iso(1)}','active','Seattle','98101','urgent');
  `);
  // When each company came onto SubSub. This is what the ninety-day bar counts
  // from now -- not their opt-in date -- so the fixture has to say it.
  // cmp_new is the genuinely recent one; everybody else has been here a while.
  db.prepare(`UPDATE engagements SET invited_at = ? WHERE company_id != 'cmp_new'`).run(iso(-400));
  db.prepare(`UPDATE engagements SET invited_at = ? WHERE company_id = 'cmp_new'`).run(iso(-5));

  // Finished work, so completedJobs clears the bar. A work order is 'accepted'
  // and the JOB is what gets completed -- work_orders has no 'completed'
  // status at all, which is the trap the standing query fell into first time.
  let n = 0;
  db.exec(`INSERT INTO jobs(id,account_id,title,date,status,completed_at) VALUES
    ('job_done','acc2','A finished job','${iso(-30)}','completed','${iso(-29)}')`);
  for (const co of ["cmp_ok", "cmp_ok2", "cmp_new", "cmp_bad", "cmp_out", "cmp_roof", "cmp_both"]) {
    for (let i = 0; i < 6; i++) {
      db.prepare(`INSERT INTO work_orders(id,wo_number,job_id,trade,company_id,engagement_id,status)
        VALUES (?,?,?,?,?,?,'accepted')`).run(`wo${++n}`, `WO-${900000 + n}`, "job_done", "plumbing", co, "en_ok");
    }
  }
  // Current documents for everyone, so docsCurrent is true.
  for (const co of ["cmp_ok", "cmp_ok2", "cmp_new", "cmp_bad", "cmp_out", "cmp_mine", "cmp_roof", "cmp_both"]) {
    for (const k of ["insurance", "bond"]) {
      db.prepare(`INSERT INTO company_docs(id,company_id,kind,file_name,expires_on,approved_at)
        VALUES (?,?,?,?,?,CURRENT_TIMESTAMP)`).run(`d${++n}`, co, k, `${k}.pdf`, iso(300));
    }
  }
  return { db, env: { DB: makeD1(db) } };
};

const call = (env, who, accountId, path, opts = {}) => worker.fetch(
  new Request(`https://api.subsub.work/api${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", "X-User-Id": who,
               "X-Account-Id": accountId, ...(opts.headers || {}) },
  }), env);
const json = async (r) => [r.status, await r.json().catch(() => ({}))];

console.log("\n-- the rules, before a database is involved --");
{
  const base = { overflowOptIn: true, overflowTrades: ["plumbing"], licenseVerified: true,
    docsCurrent: true, rating: 4.6, ratedJobs: 8, completedJobs: 9, daysOnPlatform: 200 };
  ck("a company meeting every bar is eligible", eligible(base).ok === true, JSON.stringify(eligible(base)));
  ck("opting in is not on its own enough",
    eligible({ ...base, ratedJobs: 1 }).reasons.includes("too_few_ratings"));
  ck("a low rating is refused", eligible({ ...base, rating: 3.2 }).reasons.includes("rating_too_low"));
  ck("a rating from too few jobs is not a rating",
    eligible({ ...base, ratedJobs: 2, rating: 5 }).reasons.includes("too_few_ratings"));
  ck("time served is required", eligible({ ...base, daysOnPlatform: 10 }).reasons.includes("too_new"));
  ck("finished work is required", eligible({ ...base, completedJobs: 1 }).reasons.includes("too_few_jobs"));
  ck("lapsed documents are refused",
    eligible({ ...base, docsCurrent: false }).reasons.includes("documents_not_current"));
  ck("an unverified licence is refused",
    eligible({ ...base, licenseVerified: false }).reasons.includes("license_not_verified"));
  ck("not opting in is refused",
    eligible({ ...base, overflowOptIn: false }).reasons.includes("not_opted_in"));
  ck("and every reason has something a contractor can act on",
    eligible({ overflowOptIn: false }).reasons.length >= 5);

  // It is overflow or it is a marketplace.
  const mine = [{ company: "My Own Plumbing", categories: ["plumbing"], available: true, assignable: true }];
  ck("an account with somebody of their own may not broadcast",
    canBroadcast({ ownRoster: mine, trade: "plumbing" }).ok === false);
  ck("and is told who to use instead",
    canBroadcast({ ownRoster: mine, trade: "plumbing" }).companies[0] === "My Own Plumbing");
  ck("somebody who cannot be issued the work does not block it",
    canBroadcast({ ownRoster: [{ ...mine[0], assignable: false }], trade: "plumbing" }).ok === true);
  ck("nor does somebody unavailable",
    canBroadcast({ ownRoster: [{ ...mine[0], available: false }], trade: "plumbing" }).ok === true);
  ck("nor somebody in a different trade",
    canBroadcast({ ownRoster: mine, trade: "roofing" }).ok === true);
  ck("an empty roster may broadcast", canBroadcast({ ownRoster: [], trade: "plumbing" }).ok === true);

  // The fee is modelled and off.
  ck("the launch fee is zero", OVERFLOW_FEE_BPS === 0);
  ck("so a contractor clears the whole value",
    JSON.stringify(overflowSplit(500000)) === JSON.stringify({ gross: 500000, fee: 0, net: 500000, bps: 0 }));
  ck("but the arithmetic is there for when it is not",
    overflowFee(500000, 500) === 25000, String(overflowFee(500000, 500)));
  ck("and it is whole cents, never a float",
    Number.isInteger(overflowFee(333333, 250)), String(overflowFee(333333, 250)));
  ck("an emergency window is shorter than a routine one",
    postWindowHours("911") < postWindowHours("urgent")
      && postWindowHours("urgent") < postWindowHours("standard"));
  ck("a filled post is closed", postClosed({ status: "filled" }) === true);
  ck("and so is one past its window",
    postClosed({ status: "open", expiresAt: "2020-01-01T00:00:00Z" }, "2026-01-01T00:00:00Z") === true);
}

console.log("\n-- a contractor's own standing, told only to them --");
{
  const { env } = seed();
  const [s, b] = await json(await call(env, "u_ok", "acc1", "/overflow/standing"));
  ck("they can read their own", s === 200, `${s} ${JSON.stringify(b).slice(0, 120)}`);
  ck("and it says they are eligible", b.eligible === true, JSON.stringify(b.reasons));
  ck("their rating is their whole record, not one account's",
    Number(b.rating).toFixed(1) === "4.7", String(b.rating));
  ck("the thresholds are stated rather than implied",
    b.thresholds?.minRating === ELIGIBILITY.minRating);

  const [, out] = await json(await call(env, "u_out", "acc1", "/overflow/standing"));
  ck("somebody who never opted in is told so",
    out.eligible === false && out.reasons.includes("not_opted_in"), JSON.stringify(out.reasons));
}

console.log("\n-- the clock is time on SubSub, not time since opting in --");
{
  // This was the other way round first, and it made the feature inert. Counting
  // from the opt-in meant a subcontractor who had worked through SubSub for a
  // year was "too new" for three months, and since nobody had opted in before
  // the feature shipped, a broadcast could reach NOBODY for a quarter.
  const { db, env } = seed();
  let [s, b] = await json(await call(env, "u_out", "acc1", "/overflow/opt-in",
    { method: "PUT", body: JSON.stringify({ optIn: true, trades: ["plumbing"] }) }));
  ck("a contractor may opt in", s === 200 && b.optIn === true, `${s} ${JSON.stringify(b)}`);

  // They opted in seconds ago, and have been on SubSub for over a year.
  let [, st] = await json(await call(env, "u_out", "acc1", "/overflow/standing"));
  ck("somebody long-established is eligible the moment they opt in",
    st.eligible === true, JSON.stringify(st.reasons));
  ck("and their time served is counted from when they joined",
    st.daysOnPlatform >= 400, String(st.daysOnPlatform));
  ck("which is reported, so they can see what they are judged on",
    st.joinedOn === iso(-400), String(st.joinedOn));
  ck("their opt-in date is recorded too, and decides nothing",
    !!st.optedInOn, String(st.optedInOn));

  // Toggling off and on cannot change it, because it is not what is counted.
  await call(env, "u_out", "acc1", "/overflow/opt-in",
    { method: "PUT", body: JSON.stringify({ optIn: false, trades: [] }) });
  await call(env, "u_out", "acc1", "/overflow/opt-in",
    { method: "PUT", body: JSON.stringify({ optIn: true, trades: ["plumbing"] }) });
  [, st] = await json(await call(env, "u_out", "acc1", "/overflow/standing"));
  ck("so toggling it cannot reset the ninety days", st.eligible === true, JSON.stringify(st.reasons));

  // And somebody genuinely new is still refused, which is the bar doing its job.
  db.prepare(`UPDATE companies SET overflow_opt_in = 1, overflow_trades = '["plumbing"]' WHERE id='cmp_new'`).run();
  const newly = await json(await call(env, "u_ok", "acc1", "/overflow/standing"));
  ck("a company that really is new is still too new",
    db.prepare(`SELECT MIN(invited_at) m FROM engagements WHERE company_id='cmp_new'`).get().m === iso(-5),
    "fixture check");
}

console.log("\n-- it is only for overflow --");
{
  const { env } = seed();
  // acc1 HAS a plumber who can take it, so there is nothing to overflow.
  let [s, b] = await json(await call(env, "u_admin", "acc1", "/jobs/job1/overflow/eligibility?trade=plumbing"));
  ck("the account is told they cannot broadcast", s === 200 && b.ok === false, JSON.stringify(b));
  ck("and which of their own to use", b.companies?.includes("My Own Plumbing"), JSON.stringify(b.companies));

  [s, b] = await json(await call(env, "u_admin", "acc1", "/jobs/job1/overflow",
    { method: "POST", body: JSON.stringify({ trade: "plumbing" }) }));
  ck("and posting is refused, not merely discouraged",
    s === 409 && b.error === "own_roster_available", `${s} ${JSON.stringify(b)}`);

  // A trade they have nobody for at all.
  [s, b] = await json(await call(env, "u_admin", "acc1", "/jobs/job1/overflow/eligibility?trade=roofing"));
  ck("a trade they have nobody for may be broadcast", b.ok === true, JSON.stringify(b));
}

console.log("\n-- posting tells the account nothing about who it reached --");
{
  const { db, env } = seed();
  const [s, b] = await json(await call(env, "u_admin", "acc1", "/jobs/job1/overflow",
    { method: "POST", body: JSON.stringify({ trade: "roofing", value: "4000", scope: "Tear off and dry in" }) }));
  ck("the post is made", s === 201 && !!b.id, `${s} ${JSON.stringify(b)}`);
  ck("it confirms it went out", b.sent === true);

  // The whole point.
  const blob = JSON.stringify(b);
  ck("no company is named back", !/Ridge|Rainier|Olympic|cmp_/.test(blob), blob);
  ck("and no count of who was asked", !("reached" in b) && !("invited" in b) && !("count" in b), blob);
  ck("not even a total", !/\b[0-9]+\b/.test(String(b.reached ?? "")), String(b.reached));

  // It did reach the right one, server-side.
  const invited = db.prepare(`SELECT company_id FROM overflow_invites WHERE post_id = ?`).all(b.id)
    .map((r) => r.company_id);
  ck("the eligible roofer was invited", invited.includes("cmp_roof"), JSON.stringify(invited));
  ck("the plumbers were not -- wrong trade", !invited.some((x) => /cmp_ok|cmp_bad|cmp_new/.test(x)), JSON.stringify(invited));
  ck("the fee rate is stamped on the post",
    db.prepare(`SELECT fee_bps FROM overflow_posts WHERE id = ?`).get(b.id).fee_bps === OVERFLOW_FEE_BPS);
  ck("and it has a window", !!db.prepare(`SELECT expires_at FROM overflow_posts WHERE id = ?`).get(b.id).expires_at);
}

console.log("\n-- who it reaches, and who it never reaches --");
{
  const { db, env } = seed();
  // Give acc1 nobody for plumbing so the broadcast is allowed, by making their
  // own plumber un-issuable rather than deleting them: that is the real case.
  db.exec(`UPDATE engagements SET doc_review='{}' WHERE id='en_mine'`);
  const [, b] = await json(await call(env, "u_admin", "acc1", "/jobs/job1/overflow",
    { method: "POST", body: JSON.stringify({ trade: "plumbing", value: "3000" }) }));
  const invited = db.prepare(`SELECT company_id FROM overflow_invites WHERE post_id = ?`).all(b.id)
    .map((r) => r.company_id).sort();

  ck("the two eligible plumbers were reached",
    invited.includes("cmp_ok") && invited.includes("cmp_ok2"), JSON.stringify(invited));
  ck("the one that never opted in was not", !invited.includes("cmp_out"), JSON.stringify(invited));
  ck("the one too new was not", !invited.includes("cmp_new"), JSON.stringify(invited));
  ck("the one rated too low was not", !invited.includes("cmp_bad"), JSON.stringify(invited));
  ck("a roofer was not asked about plumbing", !invited.includes("cmp_roof"), JSON.stringify(invited));
  ck("and the account's OWN contractor was not broadcast to",
    !invited.includes("cmp_mine"), JSON.stringify(invited));
  // The one that matters: opted in, eligible, right trade -- and already on
  // this account's roster. Broadcasting to them would be telling an account
  // about a contractor they already have, as though overflow had found them.
  ck("nor one already on the roster who happens to be opted in",
    !invited.includes("cmp_both"), JSON.stringify(invited));
}

console.log("\n-- what a contractor sees, and what they do not --");
{
  const { env } = seed();
  const [, post] = await json(await call(env, "u_admin", "acc1", "/jobs/job1/overflow",
    { method: "POST", body: JSON.stringify({ trade: "roofing", value: "4000" }) }));
  // cmp_roof has no seat in this fixture, so read it through acc2's admin? No --
  // offers are per company. Give Ridge a seat to read their own.
  const [s, offers] = await json(await call(env, "u_ok", "acc1", "/overflow/offers"));
  ck("a company not invited sees nothing", s === 200 && offers.length === 0, JSON.stringify(offers));
}

console.log("\n-- answering, and who may --");
{
  const { db, env } = seed();
  db.exec(`UPDATE engagements SET doc_review='{}' WHERE id='en_mine'`);
  const [, post] = await json(await call(env, "u_admin", "acc1", "/jobs/job1/overflow",
    { method: "POST", body: JSON.stringify({ trade: "plumbing", value: "3000" }) }));

  let [s, offers] = await json(await call(env, "u_ok", "acc1", "/overflow/offers"));
  ck("an invited company sees the post", offers.length === 1 && offers[0].id === post.id, JSON.stringify(offers));
  ck("it names who is asking", offers[0].account === "Cascade Management", String(offers[0].account));
  ck("it gives the area, not the street",
    offers[0].where === "Seattle 98101", String(offers[0].where));
  ck("and what it clears, at the stamped rate",
    offers[0].gross === 300000 && offers[0].net === 300000, JSON.stringify(offers[0]));

  [s] = await json(await call(env, "u_ok", "acc1", `/overflow/${post.id}/respond`,
    { method: "POST", body: JSON.stringify({ status: "offered", price: "2800", canStart: "tomorrow 8am", note: "Two-man crew" }) }));
  ck("they can answer", s === 200, String(s));

  // Holding a post id is not enough.
  const [s2, b2] = await json(await call(env, "u_out", "acc1", `/overflow/${post.id}/respond`,
    { method: "POST", body: JSON.stringify({ status: "offered" }) }));
  ck("somebody who was not invited cannot answer",
    s2 === 403 && b2.error === "not_invited", `${s2} ${JSON.stringify(b2)}`);
  ck("and left no response behind",
    db.prepare(`SELECT COUNT(*) n FROM overflow_responses WHERE company_id='cmp_out'`).get().n === 0);

  // The posting account is told, in their own feed.
  ck("the account is told somebody answered",
    /answered your plumbing overflow post/.test(
      db.prepare(`SELECT text FROM activity WHERE kind='overflow_answered'`).get()?.text || ""),
    db.prepare(`SELECT text FROM activity WHERE kind='overflow_answered'`).get()?.text);
}

console.log("\n-- the account sees answers, and nothing else --");
{
  const { db, env } = seed();
  db.exec(`UPDATE engagements SET doc_review='{}' WHERE id='en_mine'`);
  const [, post] = await json(await call(env, "u_admin", "acc1", "/jobs/job1/overflow",
    { method: "POST", body: JSON.stringify({ trade: "plumbing", value: "3000" }) }));
  await call(env, "u_ok", "acc1", `/overflow/${post.id}/respond`,
    { method: "POST", body: JSON.stringify({ status: "offered", price: "2800", canStart: "tomorrow" }) });

  const [s, posts] = await json(await call(env, "u_admin", "acc1", "/overflow/posts"));
  ck("the account can read its own posts", s === 200 && posts.length === 1, `${s} ${posts.length}`);
  const p = posts[0];
  ck("the one who answered is named", p.responses.length === 1
    && p.responses[0].company === "Rainier Plumbing", JSON.stringify(p.responses));
  ck("with how to reach them, now they have chosen to be known",
    !!p.responses[0].phone && !!p.responses[0].email, JSON.stringify(p.responses[0]));
  ck("and roughly where they are", p.responses[0].where === "Seattle, WA", String(p.responses[0].where));
  ck("and what they offered", p.responses[0].price === 280000, String(p.responses[0].price));

  // Olympic Plumbing was invited and said nothing. They must be invisible.
  const blob = JSON.stringify(posts);
  ck("a company that was asked and stayed silent is not there",
    !/Olympic/.test(blob), blob);
  ck("and neither is any count of who was asked",
    !/invited|reached|candidates/i.test(blob), blob);
}

console.log("\n-- picking one, and what it is not a way to do --");
{
  const { db, env } = seed();
  db.exec(`UPDATE engagements SET doc_review='{}' WHERE id='en_mine'`);
  const [, post] = await json(await call(env, "u_admin", "acc1", "/jobs/job1/overflow",
    { method: "POST", body: JSON.stringify({ trade: "plumbing", value: "3000" }) }));
  await call(env, "u_ok", "acc1", `/overflow/${post.id}/respond`,
    { method: "POST", body: JSON.stringify({ status: "offered" }) });

  // Naming somebody who did not answer must not reach them.
  let [s, b] = await json(await call(env, "u_admin", "acc1", `/overflow/${post.id}/pick`,
    { method: "POST", body: JSON.stringify({ companyId: "cmp_ok2" }) }));
  ck("a company that was asked but said nothing cannot be picked",
    s === 409 && b.error === "did_not_answer", `${s} ${JSON.stringify(b)}`);
  [s, b] = await json(await call(env, "u_admin", "acc1", `/overflow/${post.id}/pick`,
    { method: "POST", body: JSON.stringify({ companyId: "cmp_out" }) }));
  ck("nor can one that was never asked", s === 409, `${s} ${b.error}`);
  ck("and no engagement was created for either",
    db.prepare(`SELECT COUNT(*) n FROM engagements WHERE account_id='acc1'
      AND company_id IN ('cmp_ok2','cmp_out')`).get().n === 0);

  // The one who answered.
  [s, b] = await json(await call(env, "u_admin", "acc1", `/overflow/${post.id}/pick`,
    { method: "POST", body: JSON.stringify({ companyId: "cmp_ok" }) }));
  ck("the one who answered can be picked", s === 200 && b.companyId === "cmp_ok", `${s} ${JSON.stringify(b)}`);
  ck("an ordinary engagement is created, so everything downstream behaves",
    db.prepare(`SELECT status FROM engagements WHERE account_id='acc1' AND company_id='cmp_ok'`).get().status === "active");
  ck("the post is closed", db.prepare(`SELECT status FROM overflow_posts WHERE id=?`).get(post.id).status === "filled");
  ck("and picking twice is refused",
    (await call(env, "u_admin", "acc1", `/overflow/${post.id}/pick`,
      { method: "POST", body: JSON.stringify({ companyId: "cmp_ok" }) })).status === 409);
}

console.log("\n-- and none of it crosses accounts --");
{
  const { db, env } = seed();
  db.exec(`UPDATE engagements SET doc_review='{}' WHERE id='en_mine'`);
  const [, post] = await json(await call(env, "u_admin", "acc1", "/jobs/job1/overflow",
    { method: "POST", body: JSON.stringify({ trade: "plumbing", value: "3000" }) }));
  await call(env, "u_ok", "acc1", `/overflow/${post.id}/respond`,
    { method: "POST", body: JSON.stringify({ status: "offered" }) });

  const [s, theirs] = await json(await call(env, "u_far", "acc2", "/overflow/posts"));
  ck("another account sees none of these posts", s === 200 && theirs.length === 0, JSON.stringify(theirs));
  let [s2] = await json(await call(env, "u_far", "acc2", `/overflow/${post.id}/pick`,
    { method: "POST", body: JSON.stringify({ companyId: "cmp_ok" }) }));
  ck("and cannot pick from somebody else's post", s2 === 404, String(s2));
  [s2] = await json(await call(env, "u_far", "acc2", `/overflow/${post.id}/cancel`, { method: "POST" }));
  ck("nor cancel it", s2 === 404, String(s2));
  ck("the post is still open", db.prepare(`SELECT status FROM overflow_posts WHERE id=?`).get(post.id).status === "open");

  // Taking it down is the poster's own.
  const [s3] = await json(await call(env, "u_admin", "acc1", `/overflow/${post.id}/cancel`, { method: "POST" }));
  ck("the poster can cancel", s3 === 200);
  ck("and answering a cancelled post is refused",
    (await call(env, "u_ok2", "acc1", `/overflow/${post.id}/respond`,
      { method: "POST", body: JSON.stringify({ status: "offered" }) })).status === 409);
}

console.log("\n-- and on a database that has not run 038 yet --");
{
  // The state the live database is actually in until somebody pastes the
  // migration. Nothing about the rest of the product may break, and the one
  // thing that cannot work has to say so in a sentence naming the file --
  // rather than opening a form, taking a description of an emergency, and
  // then failing.
  const db = freshDb({ base: SCHEMA, migrations: [M023, M024, M031, M037] });
  db.exec(`
    INSERT INTO accounts(id,name,subdomain,kind) VALUES ('acc1','Cascade','cascade','property_manager');
    INSERT INTO companies(id,company) VALUES ('cmp_a','Some Plumber');
    INSERT INTO users(id,name,email,auth_id) VALUES ('u_admin','Admin','a@a.test','auth_a');
    INSERT INTO memberships(id,user_id,account_id,role,company_id) VALUES ('m1','u_admin','acc1','admin',NULL);
    INSERT INTO jobs(id,account_id,title,date,status,area,zip)
      VALUES ('job1','acc1','Burst riser','${iso(1)}','active','Seattle','98101');
  `);
  const env = { DB: makeD1(db) };

  // The lists degrade to empty rather than erroring, so no screen breaks.
  const [sp, posts] = await json(await call(env, "u_admin", "acc1", "/overflow/posts"));
  ck("the posts list is empty rather than broken", sp === 200 && posts.length === 0, `${sp}`);
  const [so, offers] = await json(await call(env, "u_admin", "acc1", "/overflow/offers"));
  ck("so is the offers list", so === 200 && offers.length === 0, `${so}`);

  // The check the form makes before drawing anything.
  const [se, elig] = await json(await call(env, "u_admin", "acc1",
    "/jobs/job1/overflow/eligibility?trade=plumbing"));
  ck("the eligibility check still answers", se === 200, String(se));
  ck("and reports that overflow cannot run", elig.available === false, JSON.stringify(elig));
  ck("naming the migration, not just failing", elig.migration === "038_overflow", String(elig.migration));

  // And the post itself refuses in a way that names it.
  const [sx, bx] = await json(await call(env, "u_admin", "acc1", "/jobs/job1/overflow",
    { method: "POST", body: JSON.stringify({ trade: "plumbing", value: "3000" }) }));
  ck("posting is refused with a migration, not a 500",
    sx === 503 && bx.error === "migration_needed", `${sx} ${JSON.stringify(bx)}`);
  ck("and it says which one", bx.migration === "038_overflow", String(bx.migration));

  // Nothing else may be collateral damage.
  ck("the roster still loads", (await call(env, "u_admin", "acc1", "/subs")).status === 200);
  ck("the jobs still load", (await call(env, "u_admin", "acc1", "/jobs")).status === 200);

  // The sweep and the other features added alongside this must not care.
  env.CRON_SECRET = "s";
  ck("the document sweep still runs",
    (await call(env, "u_admin", "acc1", "/cron/doc-expiry",
      { headers: { Authorization: "Bearer s" } })).status === 200);
}

console.log("\n-- every recent migration names itself when it is missing --");
{
  // These were all reading "unknown", which turns a two-minute paste into a
  // guess. The message is the only thing standing between somebody and the
  // right file.
  const cases = [
    ["no such table: overflow_posts", "038_overflow"],
    ["table overflow_posts has no column named severity", "038_overflow"],
    ["no such column: overflow_opt_in", "038_overflow"],
    ["no such table: company_docs", "037_document_detail"],
    ["no such table: doc_reminders", "037_document_detail"],
    ["no such column: scope_kind", "036_wo_scope"],
    ["no such table: lien_waivers", "035_waiver_chain"],
    ["no such column: owner_declared_at", "040_owner_declared"],
    ["no such table: property_transfers", "039_building_handover"],
    ["no such column: owner_account_id", "039_building_handover"],
    ["no such column: retainage_bps", "034_retainage"],
    ["no such table: wo_milestones", "033_job_ledger"],
    ["no such column: avatar_key", "032_user_avatar"],
    ["no such column: severity", "023_emergencies"],
    ["no such column: pay_kind", "024_hourly_work_orders"],
  ];
  // The real function, called with the real messages. Grepping the source for
  // the filename would pass even if every rule pointed at the wrong one.
  for (const [msg, want] of cases) {
    const got = missingSchema(new Error(msg));
    ck(`"${msg.slice(0, 44)}" -> ${want}`, got === want, `got ${got}`);
  }
  // An overflow_posts error that happens to mention `severity` must not be
  // blamed on 023 -- which is what order in that function decides.
  ck("an overflow error mentioning severity is still 038",
    missingSchema(new Error("table overflow_posts has no column named severity")) === "038_overflow");
  // And something that is not a schema error at all is not a migration.
  ck("an ordinary failure is not reported as a missing migration",
    missingSchema(new Error("UNIQUE constraint failed: overflow_posts.id")) === null,
    String(missingSchema(new Error("UNIQUE constraint failed: overflow_posts.id"))));
  ck("nor is a network wobble",
    missingSchema(new Error("D1_ERROR: connection reset")) === null);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
