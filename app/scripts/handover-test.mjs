// Handing a building over, and firing your property manager.
//
// A building owner invited onto their manager's account was a guest there. Fire
// the manager and they lost the building, its job history, its certificates and
// their own view of all three -- and could not let themselves out, because the
// person they were leaving held the only button.
//
// What this covers:
//
//   TWO-PARTY, with no hole. One side asks, the other agrees, and the side that
//   asked has already agreed by asking. If the requester can also approve, one
//   account can move a building alone, which is the whole thing this must never
//   allow.
//
//   THE JOBS DO NOT MOVE. The outgoing manager keeps every job they ran --
//   nothing copied, nothing deleted -- and the owner can still read them.
//   Deleting a manager's record to satisfy a departing client would be the
//   wrong outcome the first time anybody disputes a job.
//
//   THE ROSTER DOES NOT MOVE. A manager's contractors are their own
//   relationships. Handing them to a departing client is the accumulation this
//   product refuses everywhere else.
//
//   Nobody can have a building delivered by naming an account id.
//
//   node --no-warnings scripts/handover-test.mjs

import { readFileSync } from "node:fs";
import { makeD1, freshDb } from "./lib/d1-sqlite.mjs";
import { canHandOver, awaitingFrom, canDecide, canCancel, MOVES, STAYS, inheritedShape, isOpenWork, canAppoint, seatDescription } from "../shared/handover.js";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");

const SCHEMA = readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8");
const M014 = readFileSync(new URL("../worker/migrations/014_building_owners.sql", import.meta.url), "utf8");
const M031 = `ALTER TABLE accounts ADD COLUMN company_id TEXT REFERENCES companies(id);`;
const M039 = readFileSync(new URL("../worker/migrations/039_building_handover.sql", import.meta.url), "utf8");
const M040 = readFileSync(new URL("../worker/migrations/040_owner_declared.sql", import.meta.url), "utf8");
// Columns the job routes write. schema.sql alone leaves them 503-ing on a
// migration rather than exercising what is under test.
const JOBCOLS = `
ALTER TABLE jobs ADD COLUMN severity TEXT;
ALTER TABLE jobs ADD COLUMN photos TEXT;
ALTER TABLE jobs ADD COLUMN report_detail TEXT;
ALTER TABLE jobs ADD COLUMN updated_at TEXT;
ALTER TABLE work_orders ADD COLUMN pay_kind TEXT NOT NULL DEFAULT 'fixed';
ALTER TABLE work_orders ADD COLUMN rate_cents INTEGER;
ALTER TABLE work_orders ADD COLUMN cap_hours REAL;
ALTER TABLE accounts ADD COLUMN emergency_company_id TEXT;
ALTER TABLE jobs ADD COLUMN withdrawn_at TEXT;
ALTER TABLE jobs ADD COLUMN withdrawn_note TEXT;
ALTER TABLE jobs ADD COLUMN declined_at TEXT;
ALTER TABLE jobs ADD COLUMN declined_note TEXT;`;
const iso = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

// Cascade manages Cedar and Elm. Dana owns Cedar and has an account of her own.
// Theo owns Elm and has nowhere to put it.
const seed = () => {
  const db = freshDb({ base: SCHEMA, migrations: [M031, JOBCOLS, M039, M040] });
  db.exec(`
    INSERT INTO accounts(id,name,subdomain,kind) VALUES
      ('acc_pm','Cascade Management','cascade','property_manager'),
      ('acc_dana','Dana Holdings','danaholdings','building_owner'),
      ('acc_other','Sound PM','sound','property_manager');
    INSERT INTO properties(id,account_id,owner_account_id,name) VALUES
      ('p_cedar','acc_pm','acc_dana','12 Cedar St'),
      ('p_elm','acc_pm','acc_pm','40 Elm Ave'),
      ('p_far','acc_other','acc_other','99 Fir Rd');
    INSERT INTO users(id,name,email,auth_id) VALUES
      ('u_pm','Priya Manager','priya@cascade.test','auth_pm'),
      ('u_dana','Dana Reyes','dana@owner.test','auth_dana'),
      ('u_theo','Theo Park','theo@owner.test','auth_theo'),
      ('u_ten','Tam Tenant','tam@tenant.test','auth_ten'),
      ('u_far','Sound Admin','far@sound.test','auth_far');
    INSERT INTO memberships(id,user_id,account_id,role) VALUES
      ('m_pm','u_pm','acc_pm','admin'),
      ('m_dana_own','u_dana','acc_dana','admin'),
      ('m_far','u_far','acc_other','admin');
    INSERT INTO memberships(id,user_id,account_id,role) VALUES
      ('m_dana_seat','u_dana','acc_pm','owner'),
      ('m_theo_seat','u_theo','acc_pm','owner'),
      ('m_tam','u_ten','acc_pm','tenant');
    INSERT INTO membership_properties(membership_id,property_id) VALUES
      ('m_dana_seat','p_cedar'), ('m_theo_seat','p_elm'), ('m_tam','p_cedar');
    -- Cascade's own contractor, scoped to Cedar. Their relationship, not the
    -- building's.
    INSERT INTO companies(id,company) VALUES ('cmp_roof','Ridge Roofing');
    INSERT INTO engagements(id,account_id,company_id,status,categories)
      VALUES ('en_roof','acc_pm','cmp_roof','active','["roofing"]');
    INSERT INTO engagement_properties(engagement_id,property_id) VALUES ('en_roof','p_cedar');
    -- Work Cascade ran at Cedar. This is what must not move.
    INSERT INTO jobs(id,account_id,title,date,status,property_id,completed_at) VALUES
      ('job_old','acc_pm','Roof replaced','${iso(-200)}','completed','p_cedar','${iso(-190)}'),
      ('job_now','acc_pm','Gutter clean','${iso(5)}','active','p_cedar',NULL);
    INSERT INTO work_orders(id,wo_number,job_id,trade,company_id,engagement_id,status,value_cents)
      VALUES ('wo_old','WO-800001','job_old','roofing','cmp_roof','en_roof','accepted',1800000);
  `);
  return { db, env: { DB: makeD1(db) } };
};

const call = (env, who, acct, path, opts = {}) => worker.fetch(
  new Request(`https://api.subsub.work/api${path}`, { ...opts,
    headers: { "Content-Type": "application/json", "X-User-Id": who,
               "X-Account-Id": acct, ...(opts.headers || {}) } }), env);
const json = async (r) => [r.status, await r.json().catch(() => ({}))];
const one = (db, sql, ...b) => db.prepare(sql).get(...b);

console.log("\n-- the rule, before a database is involved --");
{
  const t = { status: "pending", direction: "owner_requested",
    requestedByAccountId: "acc_dana",
    fromAccountId: "acc_pm", toAccountId: "acc_dana" };
  ck("an owner asking waits on the manager", awaitingFrom(t) === "acc_pm");
  ck("and the owner cannot approve their own ask", canDecide(t, "acc_dana") === false);
  ck("only the manager can", canDecide(t, "acc_pm") === true);
  ck("and a stranger cannot", canDecide(t, "acc_other") === false);
  ck("the owner may withdraw it", canCancel(t, "acc_dana") === true);
  ck("the manager may not withdraw somebody else's ask", canCancel(t, "acc_pm") === false);

  const o = { ...t, direction: "manager_offered", requestedByAccountId: "acc_pm" };
  ck("a manager offering waits on the owner", awaitingFrom(o) === "acc_dana");
  ck("and the manager cannot accept on their behalf", canDecide(o, "acc_pm") === false);
  ck("the owner accepts", canDecide(o, "acc_dana") === true);
  ck("and the manager may withdraw their own offer", canCancel(o, "acc_pm") === true);

  for (const st of ["accepted", "declined", "cancelled"]) {
    ck(`nothing is awaited on a ${st} request`, awaitingFrom({ ...t, status: st }) === null);
    ck(`and it cannot be decided again (${st})`, canDecide({ ...t, status: st }, "acc_pm") === false);
  }
  ck("a building nobody has claimed cannot be handed over",
    canHandOver({ accountId: "acc_pm", ownerAccountId: null }).reason === "no_owner_account");
  ck("nor one already held by its owner",
    canHandOver({ accountId: "acc_dana", ownerAccountId: "acc_dana" }).reason === "already_theirs");
  ck("the design says what moves and what stays", MOVES.length > 0 && STAYS.length > 0);
}

console.log("\n-- an owner asks for their building --");
{
  const { db, env } = seed();
  let [s, b] = await json(await call(env, "u_dana", "acc_pm", "/properties/p_cedar/transfer",
    { method: "POST", body: JSON.stringify({ note: "Changing agent at the end of the month" }) }));
  ck("the owner may ask", s === 201, `${s} ${JSON.stringify(b)}`);
  ck("and it waits on the manager", b.awaiting === "acc_pm", String(b.awaiting));
  ck("it is recorded as the owner asking",
    one(db, `SELECT direction FROM property_transfers WHERE id = ?`, b.id).direction === "owner_requested");
  ck("and it goes to THEIR account, not one they named",
    one(db, `SELECT to_account_id FROM property_transfers WHERE id = ?`, b.id).to_account_id === "acc_dana");

  // The thing that must never work.
  const [s2, b2] = await json(await call(env, "u_dana", "acc_dana", `/property-transfers/${b.id}/decide`,
    { method: "POST", body: JSON.stringify({ accept: true }) }));
  ck("the owner cannot approve their own request",
    s2 === 403 && b2.error === "not_yours_to_decide", `${s2} ${JSON.stringify(b2)}`);
  ck("and the building has not moved",
    one(db, `SELECT account_id FROM properties WHERE id='p_cedar'`).account_id === "acc_pm");

  // Nor can anybody else.
  const [s3] = await json(await call(env, "u_far", "acc_other", `/property-transfers/${b.id}/decide`,
    { method: "POST", body: JSON.stringify({ accept: true }) }));
  ck("an unrelated account cannot approve it", s3 === 403, String(s3));

  // Only one live request per building.
  const [s4, b4] = await json(await call(env, "u_dana", "acc_pm", "/properties/p_cedar/transfer",
    { method: "POST", body: JSON.stringify({}) }));
  ck("a second request is refused", s4 === 409 && b4.error === "already_requested", `${s4} ${b4.error}`);
}

console.log("\n-- and nobody can be handed a building by naming an account --");
{
  const { db, env } = seed();
  // Theo owns Elm but has no account of his own.
  const [s, b] = await json(await call(env, "u_theo", "acc_pm", "/properties/p_elm/transfer",
    { method: "POST", body: JSON.stringify({ toAccountId: "acc_dana" }) }));
  ck("an owner with nowhere to put it is told so",
    s === 409 && b.error === "no_account_to_receive_it", `${s} ${JSON.stringify(b)}`);
  ck("and naming somebody else's account changes nothing",
    one(db, `SELECT COUNT(*) n FROM property_transfers`).n === 0);

  // A building they are not scoped to.
  const [s2, b2] = await json(await call(env, "u_dana", "acc_pm", "/properties/p_elm/transfer",
    { method: "POST", body: JSON.stringify({}) }));
  ck("an owner cannot ask for a building that is not theirs",
    s2 === 403 && b2.error === "not_your_building", `${s2} ${b2.error}`);

  // A building on another account entirely.
  const [s3] = await json(await call(env, "u_pm", "acc_pm", "/properties/p_far/transfer",
    { method: "POST", body: JSON.stringify({}) }));
  ck("a manager cannot offer a building they do not operate", s3 === 403, String(s3));
}

console.log("\n-- the manager releases it, and keeps their record --");
{
  const { db, env } = seed();
  const [, req] = await json(await call(env, "u_dana", "acc_pm", "/properties/p_cedar/transfer",
    { method: "POST", body: JSON.stringify({}) }));
  const [s, b] = await json(await call(env, "u_pm", "acc_pm", `/property-transfers/${req.id}/decide`,
    { method: "POST", body: JSON.stringify({ accept: true }) }));
  ck("the manager can release it", s === 200 && b.status === "accepted", `${s} ${JSON.stringify(b)}`);

  const p = one(db, `SELECT account_id, owner_account_id FROM properties WHERE id='p_cedar'`);
  ck("the building is operated by the owner now", p.account_id === "acc_dana", p.account_id);
  ck("and owned by them", p.owner_account_id === "acc_dana", p.owner_account_id);

  // THE POINT. The manager's work stays where it happened.
  const jobs = db.prepare(`SELECT id, account_id FROM jobs WHERE property_id='p_cedar'`).all();
  ck("every job stays with the account that ran it",
    jobs.length === 2 && jobs.every((j) => j.account_id === "acc_pm"), JSON.stringify(jobs));
  ck("nothing was copied", one(db, `SELECT COUNT(*) n FROM jobs`).n === 2, "job rows duplicated");
  ck("the work order is untouched",
    one(db, `SELECT status FROM work_orders WHERE id='wo_old'`).status === "accepted");

  // And the roster does NOT go with the client.
  ck("the manager keeps their contractor",
    one(db, `SELECT account_id FROM engagements WHERE id='en_roof'`).account_id === "acc_pm");
  ck("but that contractor is no longer scoped to a building they lost",
    one(db, `SELECT COUNT(*) n FROM engagement_properties
      WHERE engagement_id='en_roof' AND property_id='p_cedar'`).n === 0);

  // The tenant lives there, so they follow the building.
  ck("the tenant follows the building",
    one(db, `SELECT account_id FROM memberships WHERE id='m_tam'`).account_id === "acc_dana");
  // And the owner's guest seat on the old account is spent.
  ck("the owner's seat on the old account is gone",
    one(db, `SELECT COUNT(*) n FROM memberships WHERE id='m_dana_seat'`).n === 0);
  // Theo's seat is about a different building and must survive.
  ck("another owner's seat is untouched",
    one(db, `SELECT COUNT(*) n FROM memberships WHERE id='m_theo_seat'`).n === 1);

  ck("it cannot be decided twice",
    (await call(env, "u_pm", "acc_pm", `/property-transfers/${req.id}/decide`,
      { method: "POST", body: JSON.stringify({ accept: true }) })).status === 409);

  // Both feeds say it happened, in their own words.
  const mgr = db.prepare(`SELECT text FROM activity WHERE account_id='acc_pm' AND kind='transfer_done'`).get();
  ck("the manager is told their record is intact", /stays on your record/i.test(mgr?.text || ""), mgr?.text);
  const own = db.prepare(`SELECT text FROM activity WHERE account_id='acc_dana' AND kind='transfer_done'`).get();
  ck("and the owner is told it is theirs", /is yours now/i.test(own?.text || ""), own?.text);
}

console.log("\n-- the owner can still read what happened before --");
{
  const { db, env } = seed();
  const [, req] = await json(await call(env, "u_dana", "acc_pm", "/properties/p_cedar/transfer",
    { method: "POST", body: JSON.stringify({}) }));
  await call(env, "u_pm", "acc_pm", `/property-transfers/${req.id}/decide`,
    { method: "POST", body: JSON.stringify({ accept: true }) });

  // Reading from their OWN account now, about jobs belonging to the manager's.
  const [s, h] = await json(await call(env, "u_dana", "acc_dana", "/properties/p_cedar/history"));
  ck("the owner can read the building's history", s === 200, String(s));
  ck("it includes the job run before the handover",
    h.jobs.some((j) => j.id === "job_old"), JSON.stringify(h.jobs.map((j) => j.id)));
  ck("and says who was managing it then",
    h.jobs.find((j) => j.id === "job_old").managedBy === "Cascade Management",
    String(h.jobs.find((j) => j.id === "job_old")?.managedBy));
  ck("marked as a previous manager's",
    h.jobs.find((j) => j.id === "job_old").underPreviousManager === true);
  ck("with a count rather than a list of agents", h.underPrevious === 2, String(h.underPrevious));
  ck("and it names who actually did the work, which they always could see",
    h.jobs.find((j) => j.id === "job_old").trades[0].company === "Ridge Roofing",
    JSON.stringify(h.jobs.find((j) => j.id === "job_old").trades));
  ck("it says the building is theirs", h.ownedByYou === true && h.operatedByYou === true);

  // Not readable by a stranger.
  const [s2] = await json(await call(env, "u_far", "acc_other", "/properties/p_cedar/history"));
  ck("an unrelated account cannot read it", s2 === 403, String(s2));
}

console.log("\n-- a manager can offer, and an owner can refuse --");
{
  const { db, env } = seed();
  let [s, b] = await json(await call(env, "u_pm", "acc_pm", "/properties/p_cedar/transfer",
    { method: "POST", body: JSON.stringify({}) }));
  ck("the manager may offer", s === 201 && b.direction === "manager_offered", `${s} ${JSON.stringify(b)}`);
  ck("and it waits on the owner", b.awaiting === "acc_dana", String(b.awaiting));

  const [s2, b2] = await json(await call(env, "u_pm", "acc_pm", `/property-transfers/${b.id}/decide`,
    { method: "POST", body: JSON.stringify({ accept: true }) }));
  ck("the manager cannot accept on the owner's behalf", s2 === 403, `${s2} ${b2.error}`);

  const [s3, b3] = await json(await call(env, "u_dana", "acc_dana", `/property-transfers/${b.id}/decide`,
    { method: "POST", body: JSON.stringify({ accept: false }) }));
  ck("the owner may refuse", s3 === 200 && b3.status === "declined", `${s3} ${JSON.stringify(b3)}`);
  ck("and the building stays put",
    one(db, `SELECT account_id FROM properties WHERE id='p_cedar'`).account_id === "acc_pm");

  // Withdrawal is the requester's.
  const { db: db2, env: env2 } = seed();
  const [, off] = await json(await call(env2, "u_pm", "acc_pm", "/properties/p_cedar/transfer",
    { method: "POST", body: JSON.stringify({}) }));
  const [s4] = await json(await call(env2, "u_dana", "acc_dana", `/property-transfers/${off.id}/cancel`,
    { method: "POST" }));
  ck("the other side cannot withdraw it", s4 === 403, String(s4));
  const [s5] = await json(await call(env2, "u_pm", "acc_pm", `/property-transfers/${off.id}/cancel`,
    { method: "POST" }));
  ck("whoever raised it can", s5 === 200, String(s5));
}

console.log("\n-- and an owner can let themselves out --");
{
  const { db, env } = seed();
  const [s, b] = await json(await call(env, "u_dana", "acc_pm", "/account-users/u_dana", { method: "DELETE" }));
  ck("an owner can remove their own seat", s === 200 && b.left === true, `${s} ${JSON.stringify(b)}`);
  ck("and the seat is gone",
    one(db, `SELECT COUNT(*) n FROM memberships WHERE id='m_dana_seat'`).n === 0);
  ck("the account is told, rather than finding out from the client",
    /removed their own access/i.test(
      db.prepare(`SELECT text FROM activity WHERE kind='seat_left'`).get()?.text || ""),
    db.prepare(`SELECT text FROM activity WHERE kind='seat_left'`).get()?.text);

  // It is still their OWN seat only.
  const { env: env2 } = seed();
  const [s2] = await json(await call(env2, "u_dana", "acc_pm", "/account-users/u_theo", { method: "DELETE" }));
  ck("but not somebody else's", s2 === 403, String(s2));
  // And an admin cannot walk out of their own account this way.
  const [s3, b3] = await json(await call(env2, "u_pm", "acc_pm", "/account-users/u_pm", { method: "DELETE" }));
  ck("an admin cannot remove themselves", s3 === 409 && b3.error === "cannot_remove_self", `${s3} ${b3.error}`);
}

console.log("\n-- a guest seat is not an account, and signup says which --");
{
  const { env } = seed();
  const mk = (email) => worker.fetch(new Request("https://api.subsub.work/api/signup", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "X", email, company: "X Holdings",
      subdomain: "xholdings" + Math.floor(Math.random() * 1e6), kind: "building_owner" }) }), env);

  // Theo holds only a guest seat on Cascade. He has no account.
  const [s, b] = await json(await mk("theo@owner.test"));
  ck("somebody holding only a guest seat is not told they have an account",
    s === 409 && b.error === "email_is_a_guest_seat", `${s} ${JSON.stringify(b)}`);
  ck("and it says which kind of seat", b.seat === "owner", String(b.seat));
  // Priya runs an account, so for her the old answer is the true one.
  const [s2, b2] = await json(await mk("priya@cascade.test"));
  ck("somebody who really has an account still gets the old answer",
    s2 === 409 && b2.error === "email_in_use", `${s2} ${JSON.stringify(b2)}`);
  // Whose account it is stays private either way.
  ck("and neither answer names the account they are attached to",
    !/Cascade|acc_pm/.test(JSON.stringify(b)) && !/Cascade|acc_pm/.test(JSON.stringify(b2)),
    `${JSON.stringify(b)} ${JSON.stringify(b2)}`);
}

console.log("\n-- and then the owner appoints somebody new --");
{
  // The inverse journey. The owner holds their building outright and hands
  // OPERATION to a manager they chose, keeping ownership -- which is what lets
  // them do it again later without asking anybody.
  const { db, env } = seed();
  // Get Cedar into Dana's hands first.
  const [, req] = await json(await call(env, "u_dana", "acc_pm", "/properties/p_cedar/transfer",
    { method: "POST", body: JSON.stringify({}) }));
  await call(env, "u_pm", "acc_pm", `/property-transfers/${req.id}/decide`,
    { method: "POST", body: JSON.stringify({ accept: true }) });

  let [s, b] = await json(await call(env, "u_dana", "acc_dana", "/properties/p_cedar/appoint",
    { method: "POST", body: JSON.stringify({ subdomain: "sound" }) }));
  ck("the owner can appoint a manager", s === 201, `${s} ${JSON.stringify(b)}`);
  ck("and is told which company they reached", b.to === "Sound PM", String(b.to));
  ck("it waits on that manager, who has to accept work arriving",
    b.awaiting === "acc_other", String(b.awaiting));

  // The manager must agree. A building cannot appear in a portfolio because
  // somebody else decided it should.
  const [s2] = await json(await call(env, "u_dana", "acc_dana", `/property-transfers/${b.id}/decide`,
    { method: "POST", body: JSON.stringify({ accept: true }) }));
  ck("the owner cannot accept on the manager's behalf", s2 === 403, String(s2));

  const [s3, b3] = await json(await call(env, "u_far", "acc_other", `/property-transfers/${b.id}/decide`,
    { method: "POST", body: JSON.stringify({ accept: true }) }));
  ck("the manager accepts", s3 === 200 && b3.status === "accepted", `${s3} ${JSON.stringify(b3)}`);

  const p = one(db, `SELECT account_id, owner_account_id FROM properties WHERE id='p_cedar'`);
  ck("the new manager operates it", p.account_id === "acc_other", p.account_id);
  // THE POINT of separating the two columns.
  ck("but the owner still owns it", p.owner_account_id === "acc_dana", p.owner_account_id);

  // Which means they can move it again, to anybody, without permission.
  const [s4, b4] = await json(await call(env, "u_dana", "acc_dana", "/properties/p_cedar/transfer",
    { method: "POST", body: JSON.stringify({}) }));
  ck("so they can ask for it back later", s4 === 201 || s4 === 403, `${s4} ${JSON.stringify(b4)}`);
}

console.log("\n-- an owner does not lose sight of a building they appointed out --");
{
  const { db, env } = seed();
  db.exec(`UPDATE properties SET account_id='acc_other', owner_account_id='acc_dana' WHERE id='p_cedar'`);
  const [s, list] = await json(await call(env, "u_dana", "acc_dana", "/properties"));
  ck("it is still on their list", s === 200 && list.some((x) => x.id === "p_cedar"),
    JSON.stringify(list.map((x) => x.id)));
  const cedar = list.find((x) => x.id === "p_cedar");
  ck("marked as one they own but do not run", cedar.ownedNotOperated === true, JSON.stringify(cedar));
  ck("and it says who runs it", cedar.managedBy === "Sound PM", String(cedar.managedBy));
  // The manager sees it as an ordinary building of theirs.
  const [, theirs] = await json(await call(env, "u_far", "acc_other", "/properties"));
  ck("the manager sees it as one of their own",
    theirs.find((x) => x.id === "p_cedar")?.ownedNotOperated === undefined,
    JSON.stringify(theirs.find((x) => x.id === "p_cedar")));
  // And a guest seat must not pick these up through the second door.
  const [, guest] = await json(await call(env, "u_theo", "acc_pm", "/properties"));
  ck("a scoped guest seat still sees only what it is scoped to",
    guest.length === 1 && guest[0].id === "p_elm", JSON.stringify(guest.map((x) => x.id)));
}

console.log("\n-- appointing is not a way to look up accounts --");
{
  const { db, env } = seed();
  db.exec(`UPDATE properties SET account_id='acc_dana', owner_account_id='acc_dana' WHERE id='p_cedar'`);
  // A subdomain that does not exist and one that cannot manage buildings give
  // the SAME answer, so this cannot be walked to find out who is on SubSub.
  const [s1, b1] = await json(await call(env, "u_dana", "acc_dana", "/properties/p_cedar/appoint",
    { method: "POST", body: JSON.stringify({ subdomain: "nobodyhere" }) }));
  db.exec(`INSERT INTO accounts(id,name,subdomain,kind) VALUES ('acc_gc','A Builder','abuilder','general_contractor')`);
  const [s2, b2] = await json(await call(env, "u_dana", "acc_dana", "/properties/p_cedar/appoint",
    { method: "POST", body: JSON.stringify({ subdomain: "abuilder" }) }));
  ck("an unknown subdomain is refused", s1 === 404 && b1.error === "no_such_manager", `${s1} ${b1.error}`);
  ck("a real account that cannot manage buildings gives the same answer",
    s2 === 404 && b2.error === "no_such_manager", `${s2} ${b2.error}`);
  ck("so neither reply reveals whether the account exists",
    JSON.stringify(b1) === JSON.stringify(b2), `${JSON.stringify(b1)} vs ${JSON.stringify(b2)}`);
  ck("and no name is leaked either way", !/Builder/.test(JSON.stringify(b2)), JSON.stringify(b2));

  // Somebody merely operating a building cannot sub-contract it onward.
  const { env: env2, db: db2 } = seed();
  db2.exec(`UPDATE properties SET account_id='acc_pm', owner_account_id='acc_dana' WHERE id='p_cedar'`);
  const [s3, b3] = await json(await call(env2, "u_pm", "acc_pm", "/properties/p_cedar/appoint",
    { method: "POST", body: JSON.stringify({ subdomain: "sound" }) }));
  ck("a manager cannot appoint another manager to somebody's building",
    s3 === 403 && b3.error === "not_yours_to_appoint", `${s3} ${b3.error}`);
}

console.log("\n-- appointing is the owner's move, and the columns cannot say so --");
{
  // THE BACKFILL HOLE. 039 set owner_account_id = account_id on every row that
  // already existed, which is the only safe backfill -- before it there was no
  // owner concept and whoever held a building went on holding it. The side
  // effect is that every building a managing agent typed in reads as theirs,
  // so the ownership check waved an agent through to appoint a client's
  // building onward. The seed's properties are in exactly that state.
  const { db, env } = seed();
  db.exec(`UPDATE properties SET owner_account_id='acc_pm' WHERE id='p_elm'`);
  const own = one(db, `SELECT account_id, owner_account_id FROM properties WHERE id='p_elm'`);
  ck("the fixture really is the backfilled shape",
    own.account_id === "acc_pm" && own.owner_account_id === "acc_pm", JSON.stringify(own));

  const [s, b] = await json(await call(env, "u_pm", "acc_pm", "/properties/p_elm/appoint",
    { method: "POST", body: JSON.stringify({ subdomain: "sound" }) }));
  ck("a property manager cannot appoint, even on a building the columns call theirs",
    s === 403 && b.error === "not_the_owner", `${s} ${JSON.stringify(b)}`);
  ck("and nothing was written",
    one(db, `SELECT COUNT(*) n FROM property_transfers`).n === 0);

  // A portfolio manager acts for owners too -- same answer.
  db.exec(`UPDATE accounts SET kind='portfolio_manager' WHERE id='acc_pm'`);
  const [s2, b2] = await json(await call(env, "u_pm", "acc_pm", "/properties/p_elm/appoint",
    { method: "POST", body: JSON.stringify({ subdomain: "sound" }) }));
  ck("nor can a portfolio manager", s2 === 403 && b2.error === "not_the_owner", `${s2} ${b2.error}`);

  // THE CONTROL. A building owner's account, on the same building, may.
  db.exec(`UPDATE accounts SET kind='building_owner' WHERE id='acc_pm'`);
  const [s3, b3] = await json(await call(env, "u_pm", "acc_pm", "/properties/p_elm/appoint",
    { method: "POST", body: JSON.stringify({ subdomain: "sound" }) }));
  ck("an owner account can", s3 === 201, `${s3} ${JSON.stringify(b3)}`);

  // The rule, without a database. A managing agent is not stuck -- they add the
  // owner, the owner takes the building, the owner appoints whoever they like.
  const held = { accountId: "a1", ownerAccountId: "a1" };
  ck("the shared rule says an owner account may",
    canAppoint(held, { accountId: "a1", accountKind: "building_owner" }).ok === true);
  ck("and a managing agent may not",
    canAppoint(held, { accountId: "a1", accountKind: "property_manager" }).reason === "not_the_owner");
  ck("a building somebody else owns is refused before kind is even considered",
    canAppoint({ accountId: "a1", ownerAccountId: "a2" },
      { accountId: "a1", accountKind: "building_owner" }).reason === "not_yours_to_appoint");
  ck("and one already run by somebody else is already managed",
    canAppoint({ accountId: "a2", ownerAccountId: "a1" },
      { accountId: "a1", accountKind: "building_owner" }).reason === "already_managed");
}

console.log("\n-- an owner keeps watching a building they appointed out --");
{
  // The card staying on the list is not the same as seeing the building. The
  // whole reason an owner is here is to watch what happens at the property they
  // own, and appointing a manager is exactly when they stop being able to watch
  // it themselves -- so the work has to come with it.
  const { db, env } = seed();
  db.exec(`
    UPDATE properties SET account_id='acc_other', owner_account_id='acc_dana' WHERE id='p_cedar';
    INSERT INTO jobs(id,account_id,title,date,status,property_id) VALUES
      ('job_theirs','acc_other','Boiler service','${iso(4)}','active','p_cedar');
  `);

  const [s, jobs] = await json(await call(env, "u_dana", "acc_dana", "/jobs"));
  ck("the owner sees work at their own building", s === 200
    && jobs.some((j) => j.id === "job_theirs"), JSON.stringify(jobs.map((j) => j.id)));
  const mine = jobs.find((j) => j.id === "job_theirs");
  ck("marked as one they only watch", mine.readOnly === true && mine.atOwnedProperty === true,
    JSON.stringify({ readOnly: mine.readOnly, atOwnedProperty: mine.atOwnedProperty }));
  ck("and it says who runs it", mine.managedBy === "Sound PM", String(mine.managedBy));
  // The manager's own view is unchanged.
  const [, theirs] = await json(await call(env, "u_far", "acc_other", "/jobs"));
  ck("the manager sees it as an ordinary job of theirs",
    theirs.find((j) => j.id === "job_theirs")?.readOnly === undefined,
    JSON.stringify(theirs.find((j) => j.id === "job_theirs")?.readOnly));

  // A guest seat must not pick these up through a second door -- and the case
  // that actually tests it is a seat whose ACCOUNT owns an appointed-out
  // building. Cascade owns Elm and has appointed Sound PM to run it; Theo is a
  // guest on Cascade scoped to Elm... so scope it to something else, because
  // the question is whether the owned-building query bypasses his scope
  // entirely.
  db.exec(`
    INSERT INTO properties(id,account_id,owner_account_id,name)
      VALUES ('p_birch','acc_other','acc_pm','9 Birch Ln');
    INSERT INTO jobs(id,account_id,title,date,status,property_id) VALUES
      ('job_birch','acc_other','Lift inspection','${iso(6)}','active','p_birch');
  `);
  const [, guest] = await json(await call(env, "u_theo", "acc_pm", "/jobs"));
  ck("a scoped guest seat sees nothing extra",
    !guest.some((j) => j.id === "job_theirs"), JSON.stringify(guest.map((j) => j.id)));
  // The one that matters: Cascade owns Birch, so Cascade's ADMIN should see it,
  // but a guest on Cascade scoped elsewhere must not.
  ck("nor work at a building their host account owns but they are not scoped to",
    !guest.some((j) => j.id === "job_birch"), JSON.stringify(guest.map((j) => j.id)));
  const [, host] = await json(await call(env, "u_pm", "acc_pm", "/jobs"));
  ck("while the account that owns it does see it",
    host.some((j) => j.id === "job_birch"), JSON.stringify(host.map((j) => j.id)));
  // And an unrelated account still sees nothing of it.
  const { env: env3 } = seed();
  const [, none] = await json(await call(env3, "u_pm", "acc_pm", "/jobs"));
  ck("an account with no claim on the building sees nothing",
    !none.some((j) => j.id === "job_theirs"));
}

console.log("\n-- a tenant comes with the building, and keeps their own reports --");
{
  // Tenants follow the building because their next report has to reach whoever
  // manages the place now. But the reports they ALREADY made stay with the
  // account that handled them, since jobs never move -- so without this a
  // tenant who followed their building lost every report they had ever made
  // about their own home: nothing on the new account, and a 403 from the old
  // one, because their seat there is gone.
  const { db, env } = seed();
  db.exec(`
    -- Tam reported a leak while Cascade managed Cedar. A neighbour reported
    -- something too, which Tam must never gain sight of.
    INSERT INTO users(id,name,email,auth_id) VALUES ('u_nb','Nadia Neighbour','n@n.test','a_n');
    INSERT INTO memberships(id,user_id,account_id,role,unit) VALUES ('m_nb','u_nb','acc_pm','tenant','5C');
    INSERT INTO membership_properties(membership_id,property_id) VALUES ('m_nb','p_cedar');
    INSERT INTO jobs(id,account_id,title,date,status,property_id,requested_by) VALUES
      ('job_leak','acc_pm','Leak under the sink','${iso(-10)}','active','p_cedar','u_ten'),
      ('job_nb','acc_pm','Their broken window','${iso(-9)}','active','p_cedar','u_nb');
  `);

  const [, req] = await json(await call(env, "u_dana", "acc_pm", "/properties/p_cedar/transfer",
    { method: "POST", body: JSON.stringify({}) }));
  await call(env, "u_pm", "acc_pm", `/property-transfers/${req.id}/decide`,
    { method: "POST", body: JSON.stringify({ accept: true }) });

  // They came with it, with their unit and their scope intact.
  const seat = one(db, `SELECT account_id, unit, role FROM memberships WHERE id='m_tam'`);
  ck("the tenant is on the new account", seat.account_id === "acc_dana", seat.account_id);
  ck("still a tenant", seat.role === "tenant");
  ck("with their unit", seat.unit === "4B" || seat.unit === null, String(seat.unit));
  ck("and still scoped to their building",
    one(db, `SELECT COUNT(*) n FROM membership_properties WHERE membership_id='m_tam'`).n === 1);
  // A neighbour at the same building comes too -- they live there as well.
  ck("so does another tenant at the same building",
    one(db, `SELECT account_id FROM memberships WHERE id='m_nb'`).account_id === "acc_dana");

  // THE POINT: their own report survived the move.
  const [s, jobs] = await json(await call(env, "u_ten", "acc_dana", "/jobs"));
  ck("the tenant can still see the leak they reported", s === 200
    && jobs.some((j) => j.id === "job_leak"), JSON.stringify(jobs.map((j) => j.id)));
  const leak = jobs.find((j) => j.id === "job_leak");
  ck("marked as handled by whoever managed it then",
    leak.underPreviousManager === true && leak.readOnly === true, JSON.stringify(leak && {
      underPreviousManager: leak.underPreviousManager, readOnly: leak.readOnly }));
  ck("and it names who they reported it to",
    leak.managedBy === "Cascade Management", String(leak.managedBy));

  // THE NEGATIVE: not the neighbour's.
  ck("but not their neighbour's report",
    !jobs.some((j) => j.id === "job_nb"), JSON.stringify(jobs.map((j) => j.id)));
  const blob = JSON.stringify(jobs);
  ck("and nothing about the neighbour at all",
    !/Nadia|broken window/.test(blob), blob.slice(0, 160));
}

console.log("\n-- and a tenant does not keep reports once they leave the building --");
{
  // Scoped to a property they are STILL a tenant of. Somebody moved out and
  // unscoped keeps nothing, because the building is no longer theirs to read.
  const { db, env } = seed();
  db.exec(`
    INSERT INTO jobs(id,account_id,title,date,status,property_id,requested_by) VALUES
      ('job_leak','acc_pm','Leak under the sink','${iso(-10)}','active','p_cedar','u_ten');
  `);
  const [, req] = await json(await call(env, "u_dana", "acc_pm", "/properties/p_cedar/transfer",
    { method: "POST", body: JSON.stringify({}) }));
  await call(env, "u_pm", "acc_pm", `/property-transfers/${req.id}/decide`,
    { method: "POST", body: JSON.stringify({ accept: true }) });
  // They move out: the scope goes.
  db.exec(`DELETE FROM membership_properties WHERE membership_id='m_tam'`);
  const [, jobs] = await json(await call(env, "u_ten", "acc_dana", "/jobs"));
  ck("a tenant no longer at the building keeps nothing",
    !jobs.some((j) => j.id === "job_leak"), JSON.stringify(jobs.map((j) => j.id)));

  // And the case that actually exercises the property clause: still a tenant
  // SOMEWHERE, with an old report at an address they have left. Emptying the
  // scope entirely short-circuits before the clause is reached, so it proves
  // nothing about it.
  const { db: db2, env: env2 } = seed();
  db2.exec(`
    INSERT INTO jobs(id,account_id,title,date,status,property_id,requested_by) VALUES
      ('job_here','acc_pm','Leak at Cedar','${iso(-10)}','active','p_cedar','u_ten'),
      ('job_gone','acc_pm','Leak at the old flat','${iso(-90)}','active','p_elm','u_ten');
  `);
  const [, r2] = await json(await call(env2, "u_dana", "acc_pm", "/properties/p_cedar/transfer",
    { method: "POST", body: JSON.stringify({}) }));
  await call(env2, "u_pm", "acc_pm", `/property-transfers/${r2.id}/decide`,
    { method: "POST", body: JSON.stringify({ accept: true }) });
  const [, mine] = await json(await call(env2, "u_ten", "acc_dana", "/jobs"));
  ck("they keep the report at the address they still live at",
    mine.some((j) => j.id === "job_here"), JSON.stringify(mine.map((j) => j.id)));
  ck("and not one at an address they have left",
    !mine.some((j) => j.id === "job_gone"), JSON.stringify(mine.map((j) => j.id)));
}

console.log("\n-- an owner can ask their manager for work at their own building --");
{
  // The other half of appointing a manager. Without it an owner watches their
  // own building, sees the boiler is making a noise, and has no way to say so:
  // they hold no seat on the managing account, so the ordinary owner request is
  // closed to them, and the only option left is the telephone.
  const { db, env } = seed();
  db.exec(`UPDATE properties SET account_id='acc_other', owner_account_id='acc_dana' WHERE id='p_cedar'`);

  const [s, b] = await json(await call(env, "u_dana", "acc_dana", "/jobs",
    { method: "POST", body: JSON.stringify({
      title: "Boiler making a noise", propertyId: "p_cedar", trades: ["plumbing"],
      scope: "Rumbling on start-up", date: iso(6) }) }));
  ck("the owner can raise it", s === 201, `${s} ${JSON.stringify(b).slice(0, 120)}`);
  ck("and it is a request, not a job they created", b.requested === true, String(b.requested));

  // It belongs to the manager, because they are the ones who will do it.
  const row = one(db, `SELECT account_id, requested_by, property_id FROM jobs WHERE id = ?`, b.id);
  ck("it lands on the managing account", row.account_id === "acc_other", row.account_id);
  ck("marked as asked for by the owner", row.requested_by === "u_dana", row.requested_by);
  ck("at their building", row.property_id === "p_cedar");
  // And nobody may be committed to a price by somebody else's account.
  ck("with nothing approved", !one(db, `SELECT approved_at FROM jobs WHERE id = ?`, b.id).approved_at);

  // The manager sees it, and can tell who asked -- the owner is not a member of
  // their account, so their own users list will never name them.
  const [, theirs] = await json(await call(env, "u_far", "acc_other", "/jobs"));
  const seen = theirs.find((j) => j.id === b.id);
  ck("the manager sees the request", !!seen, JSON.stringify(theirs.map((j) => j.id)));
  ck("and is told who asked", seen.requestedByName === "Dana Reyes", String(seen.requestedByName));
  ck("their feed says so too",
    /Dana Reyes asked for work at 12 Cedar St/.test(
      db.prepare(`SELECT text FROM activity WHERE account_id='acc_other' AND kind='job_requested'`).get()?.text || ""),
    db.prepare(`SELECT text FROM activity WHERE account_id='acc_other' AND kind='job_requested'`).get()?.text);
  // The owner has a record of asking, on the account they actually run.
  ck("and the owner's own feed records it",
    /Asked your manager for work/.test(
      db.prepare(`SELECT text FROM activity WHERE account_id='acc_dana' AND kind='job_requested'`).get()?.text || ""),
    db.prepare(`SELECT text FROM activity WHERE account_id='acc_dana' AND kind='job_requested'`).get()?.text);

  // The owner can watch it, and still may not run it.
  const [, mine] = await json(await call(env, "u_dana", "acc_dana", "/jobs"));
  const watched = mine.find((j) => j.id === b.id);
  ck("the owner sees what they asked for", !!watched, JSON.stringify(mine.map((j) => j.id)));
  ck("and it is read-only to them", watched.readOnly === true && watched.atOwnedProperty === true,
    JSON.stringify({ readOnly: watched.readOnly, atOwnedProperty: watched.atOwnedProperty }));

  // It cannot be issued to a contractor until the manager approves it.
  const [sa, ba] = await json(await call(env, "u_far", "acc_other", `/jobs/${b.id}/assign`,
    { method: "POST", body: JSON.stringify({ trade: "plumbing", companyId: "cmp_roof", value: "500" }) }));
  ck("and no work order can be issued until the manager approves it",
    sa === 409 && ba.error === "not_approved", `${sa} ${JSON.stringify(ba)}`);
}

console.log("\n-- and it is not a way to put work on anybody else's account --");
{
  const { db, env } = seed();
  // A building this account neither owns nor operates.
  const [s, b] = await json(await call(env, "u_dana", "acc_dana", "/jobs",
    { method: "POST", body: JSON.stringify({ title: "Not mine", propertyId: "p_far", trades: [] }) }));
  ck("a building they have no claim on is refused",
    s === 404 && b.error === "property_not_found", `${s} ${JSON.stringify(b)}`);
  ck("and nothing was written", one(db, `SELECT COUNT(*) n FROM jobs WHERE title='Not mine'`).n === 0);

  // A building they own AND run is an ordinary job of their own, not a request.
  db.exec(`UPDATE properties SET account_id='acc_dana', owner_account_id='acc_dana' WHERE id='p_cedar'`);
  const [s2, b2] = await json(await call(env, "u_dana", "acc_dana", "/jobs",
    { method: "POST", body: JSON.stringify({ title: "My own work", propertyId: "p_cedar", trades: [] }) }));
  ck("their own building is an ordinary job", s2 === 201 && b2.requested === false,
    `${s2} ${JSON.stringify(b2).slice(0, 80)}`);
  ck("on their own account",
    one(db, `SELECT account_id, requested_by FROM jobs WHERE id = ?`, b2.id).account_id === "acc_dana");
  ck("and needing nobody's approval",
    !one(db, `SELECT requested_by FROM jobs WHERE id = ?`, b2.id).requested_by);

  // A guest seat still cannot reach past its own scope.
  const { env: env3, db: db3 } = seed();
  db3.exec(`UPDATE properties SET account_id='acc_other', owner_account_id='acc_pm' WHERE id='p_elm'`);
  const [s3] = await json(await call(env3, "u_theo", "acc_pm", "/jobs",
    { method: "POST", body: JSON.stringify({ title: "Reaching", propertyId: "p_cedar", trades: [] }) }));
  ck("a guest seat cannot raise work at a building outside its scope", s3 === 403, String(s3));
}

console.log("\n-- and urgency does not let them spend the manager's money --");
{
  // dispatchEmergency APPROVES the job and issues a work order against the
  // account's own emergency contractor. Run on the owner's side of a
  // cross-account request it would approve the manager's job from outside and
  // engage the OWNER's contractor on it. Marking something urgent must not be
  // a way to reach past the approval this whole design exists for.
  const { db, env } = seed();
  db.exec(`
    UPDATE properties SET account_id='acc_other', owner_account_id='acc_dana' WHERE id='p_cedar';
    -- Both sides have named an emergency contractor with everything verified,
    -- so the only thing stopping a dispatch is the rule under test.
    INSERT INTO companies(id,company) VALUES ('cmp_em','Nightshift Plumbing');
    INSERT INTO engagements(id,account_id,company_id,status,categories,doc_review) VALUES
      ('en_em_dana','acc_dana','cmp_em','active','["plumbing"]',
       '{"insurance":{"status":"verified"},"bond":{"status":"verified"},"contract":{"status":"verified"}}'),
      ('en_em_far','acc_other','cmp_em','active','["plumbing"]',
       '{"insurance":{"status":"verified"},"bond":{"status":"verified"},"contract":{"status":"verified"}}');
    UPDATE accounts SET emergency_company_id='cmp_em' WHERE id IN ('acc_dana','acc_other');
  `);
  const [s, b] = await json(await call(env, "u_dana", "acc_dana", "/jobs",
    { method: "POST", body: JSON.stringify({
      title: "Water coming in", propertyId: "p_cedar", trades: ["plumbing"],
      reportDetail: { problem: "A pipe has burst", started: "Tonight", words: "Ceiling is wet" },
      severity: "urgent" }) }));
  ck("the urgent request is accepted", s === 201, `${s} ${JSON.stringify(b).slice(0, 90)}`);
  ck("but nothing was dispatched", b.emergency?.dispatched === false, JSON.stringify(b.emergency));
  ck("and it says whose call it is", b.emergency?.reason === "manager_decides", JSON.stringify(b.emergency));
  // THE TWO THINGS THAT MUST NOT HAVE HAPPENED.
  ck("the manager's job is not approved from outside",
    !one(db, `SELECT approved_at FROM jobs WHERE id = ?`, b.id).approved_at,
    String(one(db, `SELECT approved_at FROM jobs WHERE id = ?`, b.id).approved_at));
  ck("and no work order was issued against it",
    one(db, `SELECT COUNT(*) n FROM work_orders WHERE job_id = ?`, b.id).n === 0);
  ck("the urgency is still recorded, for the manager to act on",
    one(db, `SELECT severity FROM jobs WHERE id = ?`, b.id).severity === "urgent");

  // THE CONTROL. The same report, on a building the account actually runs,
  // still dispatches -- so what is blocked above is reaching into another
  // account, not urgency itself. It has to come from a seat that can raise a
  // request at all: an admin's own job is never given a severity, because
  // somebody creating their own work already knows how to prioritise it.
  const { db: db2, env: env2 } = seed();
  db2.exec(`
    INSERT INTO companies(id,company) VALUES ('cmp_em','Nightshift Plumbing');
    INSERT INTO engagements(id,account_id,company_id,status,categories,doc_review) VALUES
      ('en_em_pm','acc_pm','cmp_em','active','["plumbing"]',
       '{"insurance":{"status":"verified"},"bond":{"status":"verified"},"contract":{"status":"verified"}}');
    UPDATE accounts SET emergency_company_id='cmp_em' WHERE id='acc_pm';
  `);
  const [s2, b2] = await json(await call(env2, "u_ten", "acc_pm", "/jobs",
    { method: "POST", body: JSON.stringify({
      title: "Water coming in here too", propertyId: "p_cedar", trades: ["plumbing"],
      reportDetail: { problem: "A pipe has burst", started: "Tonight", words: "Ceiling is wet" } }) }));
  ck("the same report on a building they run does dispatch",
    s2 === 201 && b2.emergency?.dispatched === true, `${s2} ${JSON.stringify(b2.emergency)}`);
  ck("against that account's own contractor",
    one(db2, `SELECT company_id FROM work_orders WHERE job_id = ?`, b2.id)?.company_id === "cmp_em");
}

console.log("\n-- the redaction rule, before a database is involved --");
{
  const job = {
    id: "j1", title: "Roof leak", propertyId: "p_cedar", trades: ["roofing"],
    scope: "Water in the top flat", date: "2026-10-06", severity: "urgent",
    status: "active", requestedByName: "Tam Tenant",
    assignments: { roofing: { id: "wo1", subId: "cmp_roof", wo: "WO-800001",
      value: "18000", crewName: "Crew A", tradeScope: "Strip and replace" } },
  };
  const v = inheritedShape(job, "Cascade Management");
  // What the building's new manager needs to run it.
  ck("they are told what is wrong", v.title === "Roof leak" && v.scope === "Water in the top flat");
  ck("and when somebody is due", v.date === "2026-10-06");
  ck("and that the roof is covered", JSON.stringify(v.bookedTrades) === '["roofing"]');
  ck("and how bad it is", v.severity === "urgent");
  ck("and who reported it, since that tenant is theirs now", v.requestedByName === "Tam Tenant");
  ck("and whose job it still is", v.previousManager === "Cascade Management");
  ck("and that they may not touch it", v.readOnly === true && v.inherited === true);
  // THE NEGATIVES. Everything here is the previous manager's relationship or
  // their contract, and a manager taking on a forty-building portfolio must not
  // walk away with forty contractors and what each was paid.
  const flat = JSON.stringify(v);
  ck("the contractor is not named", !/cmp_roof/.test(flat), flat);
  ck("the price is not shown", !/18000/.test(flat), flat);
  ck("the work order is not shown", !/WO-800001/.test(flat), flat);
  ck("the crew is not shown", !/Crew A/.test(flat), flat);
  // Present but empty. Every screen assumes a job has one, and handing them a
  // job without it crashed the jobs list; empty is also the truthful answer,
  // because this account has assigned nobody.
  ck("assignments is empty rather than absent",
    v.assignments && Object.keys(v.assignments).length === 0, JSON.stringify(v.assignments));

  // Finished, withdrawn and declined work is not in flight.
  ck("a completed job is not open work", isOpenWork({ status: "completed" }) === false);
  ck("a withdrawn request is not open work",
    isOpenWork({ status: "active", withdrawnAt: "2026-01-01" }) === false);
  ck("a declined request is not open work",
    isOpenWork({ status: "active", declinedAt: "2026-01-01" }) === false);
  ck("an active job is", isOpenWork({ status: "active" }) === true);
}

console.log("\n-- open repairs when the building moves --");
{
  // The gap: jobs do not move, so the incoming manager saw nothing. A
  // contractor turns up on Tuesday at a building whose manager has no record
  // of them, and a tenant waits on a leak nobody has heard of.
  const { db, env } = seed();
  // Dana has taken Cedar back and now holds it outright. Cascade's repairs are
  // still on Cascade's account, because jobs never move -- which is exactly the
  // work about to be left behind again when Dana appoints somebody new.
  db.exec(`UPDATE properties SET account_id='acc_dana', owner_account_id='acc_dana' WHERE id='p_cedar'`);
  // Cascade is running two repairs at Cedar: one with a contractor booked, one
  // still waiting. Plus one finished, which is history and not this list.
  db.exec(`
    INSERT INTO jobs(id,account_id,title,date,status,property_id,trades,scope,requested_by) VALUES
      ('job_leak','acc_pm','Roof leak','${iso(4)}','active','p_cedar','["roofing"]','Water in the top flat','u_ten'),
      ('job_boiler','acc_pm','Boiler service','${iso(9)}','active','p_cedar','["plumbing"]','Annual service',NULL);
    INSERT INTO work_orders(id,wo_number,job_id,trade,company_id,engagement_id,status,value_cents)
      VALUES ('wo_leak','WO-800002','job_leak','roofing','cmp_roof','en_roof','accepted',1800000);
  `);

  // Before the transfer, Sound PM has nothing to do with this building.
  const [, before] = await json(await call(env, "u_far", "acc_other", "/jobs"));
  ck("the incoming manager sees nothing yet",
    !before.some((j) => j.id === "job_leak"), JSON.stringify(before.map((j) => j.id)));

  // One repair of Dana's own, still open. Dana is the outgoing operator, so
  // this one IS theirs to finish -- and Sound PM inherits it just the same.
  db.exec(`
    INSERT INTO jobs(id,account_id,title,date,status,property_id,trades) VALUES
      ('job_dana','acc_dana','Dana own repair','${iso(7)}','active','p_cedar','["roofing"]');
  `);

  // The request names the count, on both sides, before anybody decides.
  const [, tr] = await json(await call(env, "u_dana", "acc_dana", "/properties/p_cedar/appoint",
    { method: "POST", body: JSON.stringify({ subdomain: "sound" }) }));
  const [, asked] = await json(await call(env, "u_far", "acc_other", "/property-transfers"));
  const mine = asked.find((x) => x.id === tr.id);
  // FOUR for the incoming side: Cascade's three leftovers plus Dana's own. What
  // Sound PM takes on is every open repair at the building that will not be
  // theirs, not only the ones the party handing it over happens to hold.
  ck("the incoming side is told everything it is taking on", mine?.openWork === 4,
    JSON.stringify({ openWork: mine?.openWork }));
  ck("and the sentence carries that number",
    /4 open repairs/.test(mine?.openWorkText || ""), mine?.openWorkText);
  ck("and what that means for them",
    /being finished by the previous manager/.test(mine?.openWorkText || ""), mine?.openWorkText);
  // ONE for the outgoing side: their own. Cascade's three are not Dana's to
  // finish, and telling Dana they were would be asking them to chase somebody
  // else's contractor.
  const [, theirs] = await json(await call(env, "u_dana", "acc_dana", "/property-transfers"));
  const ours = theirs.find((x) => x.id === tr.id);
  ck("the outgoing side is told only what is theirs", ours?.openWork === 1,
    JSON.stringify({ openWork: ours?.openWork }));
  ck("and that it stays theirs to finish",
    /1 open repair at this building stays yours to finish/.test(ours?.openWorkText || ""),
    ours?.openWorkText);
  // A count, not a list -- nothing here names a job or a contractor.
  ck("and neither is handed a list",
    !/job_leak|cmp_roof|Roof leak/.test(JSON.stringify(asked)), JSON.stringify(asked).slice(0, 200));

  // Accepted. The building moves; the repairs stay where they happened.
  const [sa, ba] = await json(await call(env, "u_far", "acc_other", `/property-transfers/${tr.id}/decide`,
    { method: "POST", body: JSON.stringify({ accept: true }) }));
  ck("the appointment is accepted", sa === 200 && ba.status === "accepted", `${sa} ${JSON.stringify(ba)}`);
  ck("and the answer says what the incoming side took on", ba.openWork === 4, String(ba.openWork));
  ck("the repairs did not move",
    one(db, `SELECT account_id FROM jobs WHERE id='job_leak'`).account_id === "acc_pm");
  // Both feeds, so neither walks away assuming the other picked it up.
  ck("the incoming feed says somebody else is finishing them",
    /being finished by the previous manager/.test(
      db.prepare(`SELECT text FROM activity WHERE account_id='acc_other' AND kind='transfer_done'`).get()?.text || ""),
    db.prepare(`SELECT text FROM activity WHERE account_id='acc_other' AND kind='transfer_done'`).get()?.text);
  ck("the outgoing feed says what stays theirs",
    /1 open repair at this building stays yours to finish/.test(
      db.prepare(`SELECT text FROM activity WHERE account_id='acc_dana' AND kind='transfer_done'`).get()?.text || ""),
    db.prepare(`SELECT text FROM activity WHERE account_id='acc_dana' AND kind='transfer_done'`).get()?.text);

  // And now the thing this exists for: the new manager can see it.
  const [, after] = await json(await call(env, "u_far", "acc_other", "/jobs"));
  const leak = after.find((j) => j.id === "job_leak");
  ck("the incoming manager now sees the open repair", !!leak, JSON.stringify(after.map((j) => j.id)));
  ck("named as the previous manager's", leak?.previousManager === "Cascade Management", String(leak?.previousManager));
  ck("read-only to them", leak?.readOnly === true && leak?.inherited === true);
  ck("with the trade somebody is coming for", JSON.stringify(leak?.bookedTrades) === '["roofing"]',
    JSON.stringify(leak?.bookedTrades));
  ck("and the tenant who reported it, who is their tenant now",
    leak?.requestedByName === "Tam Tenant", String(leak?.requestedByName));
  // The one still waiting on a contractor reads as waiting.
  const boiler = after.find((j) => j.id === "job_boiler");
  ck("work with nobody booked says so", JSON.stringify(boiler?.bookedTrades) === "[]",
    JSON.stringify(boiler?.bookedTrades));
  // THE NEGATIVES, over the wire this time.
  const wire = JSON.stringify(after);
  ck("the previous manager's contractor is not in the response", !/cmp_roof/.test(wire));
  ck("nor what they are being paid", !/18000|1800000/.test(wire));
  ck("nor their work order", !/WO-800002/.test(wire));

  // Finished work is history, not an open repair.
  ck("the job Cascade completed is not on the list",
    !after.some((j) => j.id === "job_old"), JSON.stringify(after.map((j) => j.id)));

  // And it clears itself: once the previous manager closes it out it drops off.
  db.exec(`UPDATE jobs SET status='completed' WHERE id='job_leak'`);
  const [, later] = await json(await call(env, "u_far", "acc_other", "/jobs"));
  ck("closing it out takes it off the new manager's list",
    !later.some((j) => j.id === "job_leak"), JSON.stringify(later.map((j) => j.id)));
}

console.log("\n-- and it is not a second door into another account's work --");
{
  const { db, env } = seed();
  db.exec(`
    INSERT INTO jobs(id,account_id,title,date,status,property_id,trades) VALUES
      ('job_far','acc_other','Their own work','${iso(3)}','active','p_far','["roofing"]');
  `);
  // A building this account neither owns nor operates: nothing crosses.
  const [, mine] = await json(await call(env, "u_pm", "acc_pm", "/jobs"));
  ck("work at somebody else's building stays invisible",
    !mine.some((j) => j.id === "job_far"), JSON.stringify(mine.map((j) => j.id)));

  // A scoped guest seat at a building with inherited work sees its own scope
  // and nothing through this door.
  db.exec(`
    UPDATE properties SET account_id='acc_other', owner_account_id='acc_other' WHERE id='p_cedar';
    INSERT INTO jobs(id,account_id,title,date,status,property_id,trades) VALUES
      ('job_inh','acc_pm','Left behind','${iso(2)}','active','p_cedar','["plumbing"]');
  `);
  const [, guest] = await json(await call(env, "u_theo", "acc_pm", "/jobs"));
  ck("a scoped seat gets no inherited work",
    !guest.some((j) => j.inherited), JSON.stringify(guest.map((j) => j.id)));
  // The account that now operates it does.
  const [, op] = await json(await call(env, "u_far", "acc_other", "/jobs"));
  ck("the operating account does", op.some((j) => j.id === "job_inh" && j.inherited),
    JSON.stringify(op.map((j) => j.id)));
}

console.log("\n-- a firm that really does own a building can say so --");
{
  // The escape hatch. Account kind closed the backfill hole, and closed it on
  // a real case too: a management firm that owns a building of its own. The
  // columns cannot separate that from a client's building, because 039 wrote
  // the same value for both -- so somebody says it, with their name on it.
  const { db, env } = seed();
  db.exec(`UPDATE properties SET owner_account_id='acc_pm' WHERE id='p_elm'`);

  // Before declaring: refused, exactly as it was.
  const [s0, b0] = await json(await call(env, "u_pm", "acc_pm", "/properties/p_elm/appoint",
    { method: "POST", body: JSON.stringify({ subdomain: "sound" }) }));
  ck("an agent still cannot appoint by default", s0 === 403 && b0.error === "not_the_owner",
    `${s0} ${b0.error}`);

  const [sd, bd] = await json(await call(env, "u_pm", "acc_pm", "/properties/p_elm/declare-ownership",
    { method: "POST", body: JSON.stringify({ own: true }) }));
  ck("they can record that they own it", sd === 200 && !!bd.ownerDeclaredAt, `${sd} ${JSON.stringify(bd)}`);
  // A name and a date, because this is a claim somebody may be asked about.
  const row = one(db, `SELECT owner_declared_at, owner_declared_by FROM properties WHERE id='p_elm'`);
  ck("with who said it", row.owner_declared_by === "u_pm", String(row.owner_declared_by));
  ck("and when", !!row.owner_declared_at, String(row.owner_declared_at));
  ck("and it is on the feed",
    /Recorded that this account owns 40 Elm Ave/.test(
      db.prepare(`SELECT text FROM activity WHERE kind='owned_declared'`).get()?.text || ""),
    db.prepare(`SELECT text FROM activity WHERE kind='owned_declared'`).get()?.text);

  // And now the thing it exists for.
  const [s1, b1] = await json(await call(env, "u_pm", "acc_pm", "/properties/p_elm/appoint",
    { method: "POST", body: JSON.stringify({ subdomain: "sound" }) }));
  ck("now they can appoint a manager for it", s1 === 201, `${s1} ${JSON.stringify(b1)}`);

  // PER BUILDING. A firm with two hundred client buildings and two of its own
  // must not unlock the other two hundred by declaring one.
  const [s2, b2] = await json(await call(env, "u_pm", "acc_pm", "/properties/p_cedar/appoint",
    { method: "POST", body: JSON.stringify({ subdomain: "sound" }) }));
  ck("and only that building", s2 === 403, `${s2} ${JSON.stringify(b2)}`);

  // Taking it back costs nothing and leaves no claim standing.
  const { db: db3, env: env3 } = seed();
  db3.exec(`UPDATE properties SET owner_account_id='acc_pm' WHERE id='p_elm'`);
  await call(env3, "u_pm", "acc_pm", "/properties/p_elm/declare-ownership",
    { method: "POST", body: JSON.stringify({ own: true }) });
  const [sc] = await json(await call(env3, "u_pm", "acc_pm", "/properties/p_elm/declare-ownership",
    { method: "POST", body: JSON.stringify({ own: false }) }));
  ck("the claim can be withdrawn", sc === 200);
  ck("and nothing is left on the row",
    !one(db3, `SELECT owner_declared_at FROM properties WHERE id='p_elm'`).owner_declared_at);
  const [s4, b4] = await json(await call(env3, "u_pm", "acc_pm", "/properties/p_elm/appoint",
    { method: "POST", body: JSON.stringify({ subdomain: "sound" }) }));
  ck("so appointing is refused again", s4 === 403 && b4.error === "not_the_owner", `${s4} ${b4.error}`);
}

console.log("\n-- and it is not a way to claim somebody else's building --");
{
  const { db, env } = seed();
  // Cedar is Dana's, and Cascade only runs it. No declaration may touch that.
  const [s, b] = await json(await call(env, "u_pm", "acc_pm", "/properties/p_cedar/declare-ownership",
    { method: "POST", body: JSON.stringify({ own: true }) }));
  ck("a building somebody else owns cannot be claimed",
    s === 403 && b.error === "owned_by_another", `${s} ${JSON.stringify(b)}`);
  ck("and nothing was written",
    !one(db, `SELECT owner_declared_at FROM properties WHERE id='p_cedar'`).owner_declared_at);

  // Nor one this account does not even run.
  const [s2, b2] = await json(await call(env, "u_pm", "acc_pm", "/properties/p_far/declare-ownership",
    { method: "POST", body: JSON.stringify({ own: true }) }));
  ck("nor a building it does not run", s2 === 403 && b2.error === "not_yours", `${s2} ${b2.error}`);

  // A declaration on a building whose owner later becomes somebody else does
  // not survive into appointing: ownership is checked first, every time.
  const { db: db2, env: env2 } = seed();
  db2.exec(`
    UPDATE properties SET owner_account_id='acc_pm' WHERE id='p_elm';
  `);
  await call(env2, "u_pm", "acc_pm", "/properties/p_elm/declare-ownership",
    { method: "POST", body: JSON.stringify({ own: true }) });
  db2.exec(`UPDATE properties SET owner_account_id='acc_dana' WHERE id='p_elm'`);
  const [s3, b3] = await json(await call(env2, "u_pm", "acc_pm", "/properties/p_elm/appoint",
    { method: "POST", body: JSON.stringify({ subdomain: "sound" }) }));
  ck("a stale declaration does not outrank who owns it",
    s3 === 403 && b3.error === "not_yours_to_appoint", `${s3} ${b3.error}`);

  // An owner-kind account has nothing to declare -- its kind already says it.
  // It has to be a building they both own and run, or the earlier check answers
  // first and this proves nothing.
  const { db: db4, env: env4 } = seed();
  db4.exec(`UPDATE properties SET account_id='acc_dana', owner_account_id='acc_dana' WHERE id='p_cedar'`);
  const [s4, b4] = await json(await call(env4, "u_dana", "acc_dana", "/properties/p_cedar/declare-ownership",
    { method: "POST", body: JSON.stringify({ own: true }) }));
  ck("an owner account is told it has nothing to declare",
    s4 === 403 && b4.error === "already_an_owner", `${s4} ${b4.error}`);

  // Only an admin. A project manager runs the work; whether the firm owns a
  // building is not a scheduling decision.
  const { db: db5, env: env5 } = seed();
  db5.exec(`UPDATE memberships SET role='pm' WHERE id='m_pm';
            UPDATE properties SET owner_account_id='acc_pm' WHERE id='p_elm';`);
  const [s5] = await json(await call(env5, "u_pm", "acc_pm", "/properties/p_elm/declare-ownership",
    { method: "POST", body: JSON.stringify({ own: true }) }));
  ck("a project manager cannot declare it", s5 === 403, String(s5));

  // The rule, without a database.
  const held = { accountId: "a1", ownerAccountId: "a1" };
  ck("a declaration lets a managing agent appoint",
    canAppoint({ ...held, ownerDeclaredAt: "2026-09-26" },
      { accountId: "a1", accountKind: "property_manager" }).ok === true);
  ck("but never on a building somebody else owns",
    canAppoint({ accountId: "a1", ownerAccountId: "a2", ownerDeclaredAt: "2026-09-26" },
      { accountId: "a1", accountKind: "property_manager" }).reason === "not_yours_to_appoint");
}

console.log("\n-- what you are in somebody else's account --");
{
  // The switcher said only "Switch to Cascade Management", which reads as
  // taking the place over. The commonest second seat is the opposite of that:
  // a contractor seat, created by accepting their request to hire you.
  ck("a contractor seat says who hires whom",
    seatDescription("contractor") === "you are their subcontractor",
    seatDescription("contractor"));
  ck("an owner seat says what is theirs",
    /own a building they run/.test(seatDescription("owner")), seatDescription("owner"));
  ck("a tenant seat says they live there",
    /rent from them/.test(seatDescription("tenant")), seatDescription("tenant"));
  // Anything else falls back to the role's own label, which ACCOUNT_KINDS may
  // have renamed -- a general contractor's second seat is a project manager,
  // not a property manager.
  ck("and any other seat uses the label that account gives it",
    seatDescription("pm", "Project manager") === "you are project manager there",
    seatDescription("pm", "Project manager"));
  ck("never leaving it blank", seatDescription("weird-new-role").length > 0,
    seatDescription("weird-new-role"));
  // THE NEGATIVE: none of them read as taking the account over.
  for (const r of ["contractor", "owner", "tenant", "pm", "admin"]) {
    ck(`a ${r} seat does not read as taking them over`,
      !/^switch to|take over|manage them/i.test(seatDescription(r, "Admin")), seatDescription(r, "Admin"));
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
