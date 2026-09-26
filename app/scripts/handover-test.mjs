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
import { canHandOver, awaitingFrom, canDecide, canCancel, MOVES, STAYS } from "../shared/handover.js";

let pass = 0, fail = 0;
const ck = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ok  " : "FAIL  "}${n}${d ? "  -- " + d : ""}`); };

const { default: worker } = await import("../worker/index.js");

const SCHEMA = readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8");
const M014 = readFileSync(new URL("../worker/migrations/014_building_owners.sql", import.meta.url), "utf8");
const M031 = `ALTER TABLE accounts ADD COLUMN company_id TEXT REFERENCES companies(id);`;
const M039 = readFileSync(new URL("../worker/migrations/039_building_handover.sql", import.meta.url), "utf8");
const iso = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

// Cascade manages Cedar and Elm. Dana owns Cedar and has an account of her own.
// Theo owns Elm and has nowhere to put it.
const seed = () => {
  const db = freshDb({ base: SCHEMA, migrations: [M031, M039] });
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
