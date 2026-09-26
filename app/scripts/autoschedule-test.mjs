// Who may turn auto-schedule on.
//
// The switch existed and only one side could reach it: a subcontractor could
// enable it from their own portal, and the account paying them had no control
// anywhere -- not on the roster, not in the detail card, not in the edit form.
// The only sign of it on the hiring side was a badge reporting a decision
// somebody else had made.
//
// Putting a plain toggle there would have been the wrong fix. An
// auto-scheduled job is written to the contractor's calendar as ACCEPTED,
// with no response window and no accept/decline buttons in their portal, so
// an account that could flip it on would be able to commit somebody else's
// week without asking them. What this checks is the split that follows:
//
//   ON, for a contractor who has an account   -- refused, they must do it
//   ON, for a record with nobody behind it    -- allowed, nobody to ask
//   OFF, from either side, always             -- allowed, costs nobody
//
// The refusal has to live in the API. Hiding the toggle is a nicety; the
// server is the thing that cannot be talked out of it, so every case below
// goes through the real route with a real database under it, and the ones
// that must fail ask anyway.
//
//   node --no-warnings scripts/autoschedule-test.mjs

import { readFileSync } from "node:fs";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";
import { canSet, hasPortal, autoStateText, AUTO_DENY_TEXT } from "../shared/autoschedule.js";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");

const SCHEMA = readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8");
// 031 is the one migration this needs: a general contractor's own company row
// is the second way somebody can answer for themselves, and the column that
// links the two is added there.
const M031 = `ALTER TABLE accounts ADD COLUMN company_id TEXT REFERENCES companies(id);`;

// acc1 hires four companies, one of each shape:
//   cmp_seat  a contractor with a seat on acc1 -- can answer
//   cmp_typed a record acc1 typed in, nobody behind it -- cannot answer
//   cmp_gc    a general contractor with an account of its own -- can answer
//   cmp_on    a seat, already agreed, so the OFF direction has a subject
const seed = () => {
  const db = freshDb({ base: SCHEMA, migrations: [M031] });
  db.exec(`
    INSERT INTO accounts(id,name,subdomain,kind) VALUES
      ('acc1','Cascade Management','cascade','property_manager'),
      ('acc2','Sound PM','sound','property_manager'),
      ('acc_gc','Rainier Builders','rainier','general_contractor');
    INSERT INTO companies(id,company,contact,email,phone) VALUES
      ('cmp_seat','San Juan Exteriors','Richard Braun','rb@sanjuan.test','2065550100'),
      ('cmp_typed','Ace Gutters','Danny Ace','danny@ace.test','2065550200'),
      ('cmp_gc','Rainier Builders','Pat Rainier','pat@rainier.test','2065550300'),
      ('cmp_on','Puget Electricity','Mega Slavo','mega@puget.test','2065550400'),
      ('cmp_other','Elsewhere Roofing','Sam Else','sam@else.test','2065550500'),
      ('cmp_far','Skagit Framing','Jo Skagit','jo@skagit.test','2065550600');
    UPDATE accounts SET company_id = 'cmp_gc' WHERE id = 'acc_gc';
    INSERT INTO users(id,name,email,auth_id) VALUES
      ('u_admin','Account Admin','admin@cascade.test','auth_admin'),
      ('u_pm','Project Manager','pm@cascade.test','auth_pm'),
      ('u_sj','Richard Braun','rb@sanjuan.test','auth_sj'),
      ('u_pug','Mega Slavo','mega@puget.test','auth_pug'),
      ('u_far','Far Admin','far@sound.test','auth_far'),
      ('u_skagit','Jo Skagit','jo@skagit.test','auth_skagit');
    INSERT INTO memberships(id,user_id,account_id,role,company_id) VALUES
      ('m1','u_admin','acc1','admin',NULL),
      ('m2','u_pm','acc1','pm',NULL),
      ('m3','u_sj','acc1','contractor','cmp_seat'),
      ('m4','u_pug','acc1','contractor','cmp_on'),
      ('m5','u_far','acc2','admin',NULL),
      -- Skagit works for acc2 and has a seat there, and acc1 typed them in
      -- separately. Their seat is on somebody else's account, so it is not a
      -- way for them to answer acc1.
      ('m6','u_skagit','acc2','contractor','cmp_far');
    INSERT INTO engagements(id,account_id,company_id,status,auto_schedule) VALUES
      ('en_seat','acc1','cmp_seat','active',0),
      ('en_typed','acc1','cmp_typed','active',0),
      ('en_gc','acc1','cmp_gc','active',0),
      ('en_on','acc1','cmp_on','active',1),
      ('en_other','acc2','cmp_other','active',0),
      ('en_far','acc1','cmp_far','active',0),
      ('en_far2','acc2','cmp_far','active',0);
  `);
  return { db, env: { DB: makeD1(db) } };
};

// No SUPABASE_* in env, so the Worker's own header fallback identifies the
// caller. The membership lookup is real either way, which is the part that
// decides the side.
const call = (env, who, accountId, path, opts = {}) => worker.fetch(
  new Request(`https://api.subsub.work/api${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", "X-User-Id": who,
               "X-Account-Id": accountId, ...(opts.headers || {}) },
  }), env);

const setAuto = (env, who, accountId, companyId, on) =>
  call(env, who, accountId, `/subs/${companyId}`,
    { method: "PATCH", body: JSON.stringify({ autoSchedule: on }) });

const json = async (r) => [r.status, await r.json().catch(() => ({}))];
const flag = (db, id) => db.prepare(`SELECT auto_schedule a FROM engagements WHERE id = ?`).get(id).a;

console.log("\n-- the rule, before any of it reaches a database --");
{
  ck("nobody may be committed by the side paying them",
    canSet({ side: "hiring", on: true, portal: true }).reason === "contractor_consent_required");
  ck("a record with nobody behind it is the account's own to schedule",
    canSet({ side: "hiring", on: true, portal: false }).ok === true);
  ck("the contractor may always agree", canSet({ side: "contractor", on: true, portal: true }).ok === true);
  ck("off is nobody's to withhold, hiring side",
    canSet({ side: "hiring", on: false, portal: true }).ok === true);
  ck("off is nobody's to withhold, contractor side",
    canSet({ side: "contractor", on: false, portal: true }).ok === true);
  ck("an unrecognised side decides nothing",
    canSet({ side: "owner", on: true, portal: false }).ok === false);
  ck("a seat is enough to be able to answer", hasPortal({ hasSeat: true }) === true);
  ck("so is an account of one's own", hasPortal({ ownsAccount: true }) === true);
  ck("and neither means nobody is there", hasPortal({}) === false);
  ck("every refusal has something to show a person",
    Object.keys(AUTO_DENY_TEXT).every((k) => AUTO_DENY_TEXT[k].length > 20));
  // The two sides describe one switch, so the sentences must differ -- the
  // contractor is told what they are agreeing to, the account what it got.
  ck("the two sides are not handed the same sentence",
    autoStateText({ on: true, portal: true, side: "hiring" })
      !== autoStateText({ on: true, portal: true, side: "contractor" }));
  ck("off, with nobody behind the record, warns that nothing will answer",
    /nobody is there/i.test(autoStateText({ on: false, portal: false, side: "hiring" })),
    autoStateText({ on: false, portal: false, side: "hiring" }));
}

console.log("\n-- the account may not turn it on for somebody who could have answered --");
{
  const { db, env } = seed();
  let [s, b] = await json(await setAuto(env, "u_admin", "acc1", "cmp_seat", true));
  ck("an admin is refused for a contractor with a seat",
    s === 409 && b.error === "contractor_consent_required", `${s} ${JSON.stringify(b)}`);
  ck("and the refusal carries something to read", (b.detail || "").length > 20, b.detail);
  ck("nothing was written", flag(db, "en_seat") === 0, String(flag(db, "en_seat")));

  [s, b] = await json(await setAuto(env, "u_pm", "acc1", "cmp_seat", true));
  ck("a project manager is refused the same way", s === 409, `${s} ${b.error}`);
  ck("still nothing written", flag(db, "en_seat") === 0);

  // A general contractor is hireable and answers through their own account,
  // not through a seat on this one. Reaching only for memberships would have
  // let this one through.
  [s, b] = await json(await setAuto(env, "u_admin", "acc1", "cmp_gc", true));
  ck("a general contractor with their own account is protected too",
    s === 409 && b.error === "contractor_consent_required", `${s} ${JSON.stringify(b)}`);
  ck("and nothing was written for them either", flag(db, "en_gc") === 0);
}

console.log("\n-- but a record nobody is behind is the account's own to set --");
{
  const { db, env } = seed();
  const [s] = await json(await setAuto(env, "u_admin", "acc1", "cmp_typed", true));
  ck("an admin may schedule a typed-in record directly", s === 200, String(s));
  ck("and it is on", flag(db, "en_typed") === 1, String(flag(db, "en_typed")));
  const [s2] = await json(await setAuto(env, "u_pm", "acc1", "cmp_typed", false));
  ck("and may take it back off", s2 === 200 && flag(db, "en_typed") === 0);
}

console.log("\n-- a seat on somebody else's account is not a way to answer this one --");
{
  // Skagit has a SubSub login, through a seat on acc2. That seat cannot
  // reach acc1's engagement -- PATCH needs a membership on acc1, and they
  // have none -- so if acc1's gate counted it, the flag would be settable by
  // nobody at all and the feature would be dead for this row. The scope on
  // the seat count is what prevents that deadlock.
  const { db, env } = seed();
  const [s] = await json(await setAuto(env, "u_admin", "acc1", "cmp_far", true));
  ck("acc1 may still set it, because nobody can answer acc1", s === 200, String(s));
  ck("and it is on", flag(db, "en_far") === 1, String(flag(db, "en_far")));
  ck("their own seat's account is a separate row and did not move",
    flag(db, "en_far2") === 0, String(flag(db, "en_far2")));
  // And the account they DO have a seat on is still gated.
  const [s2, b2] = await json(await setAuto(env, "u_far", "acc2", "cmp_far", true));
  ck("acc2, where they do have a seat, is refused",
    s2 === 409 && b2.error === "contractor_consent_required", `${s2} ${b2.error}`);
  ck("and the roster agrees on both sides",
    (await json(await call(env, "u_admin", "acc1", "/subs")))[1]
      .find((r) => r.id === "cmp_far").hasPortal === false
    && (await json(await call(env, "u_far", "acc2", "/subs")))[1]
      .find((r) => r.id === "cmp_far").hasPortal === true);
}

console.log("\n-- the contractor themselves may agree --");
{
  const { db, env } = seed();
  const [s] = await json(await setAuto(env, "u_sj", "acc1", "cmp_seat", true));
  ck("from their own seat, it is allowed", s === 200, String(s));
  ck("and it is on", flag(db, "en_seat") === 1, String(flag(db, "en_seat")));
  // Which is the point of the whole split: the same write the account was
  // refused succeeds when the person it binds is the one asking.
  ck("so the account's refusal was about who asked, not about the value",
    flag(db, "en_seat") === 1);
}

console.log("\n-- and off is always allowed, from either side --");
{
  const { db, env } = seed();
  ck("the account may switch off a contractor who had agreed",
    (await setAuto(env, "u_admin", "acc1", "cmp_on", false)).status === 200);
  ck("and it is off", flag(db, "en_on") === 0, String(flag(db, "en_on")));

  const { db: db2, env: env2 } = seed();
  ck("and so may the contractor",
    (await setAuto(env2, "u_pug", "acc1", "cmp_on", false)).status === 200);
  ck("and it is off", flag(db2, "en_on") === 0);
}

console.log("\n-- the gate does not become a way to reach another account --");
{
  const { db, env } = seed();
  let [s] = await json(await setAuto(env, "u_far", "acc1", "cmp_typed", true));
  ck("somebody from another account has no seat here", s === 403, String(s));
  ck("and wrote nothing", flag(db, "en_typed") === 0);
  // Their own account's engagement is a different row and must not move
  // because a request named this company.
  [s] = await json(await setAuto(env, "u_admin", "acc1", "cmp_other", true));
  ck("a company this account has not engaged is not found", s === 404, String(s));
  ck("and the other account's engagement is untouched", flag(db, "en_other") === 0);
  // A contractor seat is pinned to its own company.
  [s] = await json(await setAuto(env, "u_sj", "acc1", "cmp_typed", true));
  ck("a contractor cannot set it for a different company", s === 403, String(s));
  ck("and wrote nothing", flag(db, "en_typed") === 0);
}

console.log("\n-- the roster tells the browser the same fact the route enforces --");
{
  const { env } = seed();
  const [s, rows] = await json(await call(env, "u_admin", "acc1", "/subs"));
  ck("the roster loads", s === 200 && Array.isArray(rows), `${s}`);
  const by = Object.fromEntries((rows || []).map((r) => [r.id, r]));
  ck("a contractor with a seat is marked reachable", by.cmp_seat?.hasPortal === true,
    String(by.cmp_seat?.hasPortal));
  ck("so is a general contractor with their own account", by.cmp_gc?.hasPortal === true,
    String(by.cmp_gc?.hasPortal));
  ck("a typed-in record is not", by.cmp_typed?.hasPortal === false,
    String(by.cmp_typed?.hasPortal));
  ck("and it is a boolean, not a count of who they are",
    typeof by.cmp_seat?.hasPortal === "boolean", typeof by.cmp_seat?.hasPortal);
  // Reachability answers one question and must not carry the people with it.
  const blob = JSON.stringify(rows);
  ck("no seat holder's name rode along with it", !/Richard Braun/.test(blob.replace(/"contact":"[^"]*"/g, "")),
    "a name leaked outside the company's own contact field");
  ck("and the other account's company is not in the roster", !by.cmp_other);
}

console.log("\n-- asking is the hiring side's only move, and it is honest about that --");
{
  const { env } = seed();
  // No RESEND_API_KEY, so the preview reports delivery as unconfigured rather
  // than pretending. The text is what matters here.
  const [s, p] = await json(await call(env, "u_admin", "acc1",
    "/notify/auto-schedule/preview?companyId=cmp_seat&note=" + encodeURIComponent("Cedar Park Tuesdays")));
  ck("the preview builds", s === 200 && !!p.text, `${s} ${JSON.stringify(p).slice(0, 120)}`);
  ck("it goes to them", p.to === "rb@sanjuan.test", String(p.to));
  ck("it says the jobs arrive already accepted", /already\s+accepted/i.test(p.text));
  ck("it says they lose the accept step", /will not get an accept or decline/i.test(p.text));
  ck("it says the account cannot do it for them", /cannot turn this on for you/i.test(p.text));
  ck("it says doing nothing is an answer", /do nothing/i.test(p.text));
  ck("it says it is only for this account", /applies only to/i.test(p.text));
  ck("it carries the note", /Cedar Park Tuesdays/.test(p.text));
  ck("it reports that delivery is not configured", p.configured === false, String(p.configured));

  // Already on: there is nothing to ask for.
  const [s2, b2] = await json(await call(env, "u_admin", "acc1", "/notify/auto-schedule",
    { method: "POST", body: JSON.stringify({ companyId: "cmp_on" }) }));
  ck("asking somebody who already agreed is refused",
    s2 === 409 && b2.error === "already_on", `${s2} ${JSON.stringify(b2)}`);

  // Not ours to ask.
  const [s3] = await json(await call(env, "u_admin", "acc1", "/notify/auto-schedule",
    { method: "POST", body: JSON.stringify({ companyId: "cmp_other" }) }));
  ck("asking a company this account has not engaged is refused", s3 === 404, String(s3));

  // A contractor is not the side that asks.
  const [s4] = await json(await call(env, "u_sj", "acc1", "/notify/auto-schedule",
    { method: "POST", body: JSON.stringify({ companyId: "cmp_seat" }) }));
  ck("and a contractor cannot send it", s4 === 403, String(s4));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
